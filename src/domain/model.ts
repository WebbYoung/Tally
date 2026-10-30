import type { JsonSchema } from "./tools";

/**
 * 模型通道抽象。
 *
 * 不放 `import.meta.env`：配置由调用方注入，因此浏览器、Node 服务端、测试三方
 * 可以共用同一个实现，也让 Agent 编排可以脱网单测。
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface CompleteRequest {
  messages: ChatMessage[];
  /** 只给一个工具时强制调用它（结构化输出的替代方案） */
  tool?: ToolSpec;
  temperature?: number;
  signal?: AbortSignal;
}

export interface ModelReply {
  /** 模型的文本内容（可能为空） */
  content: string;
  /** 工具调用名与参数（仅当调用方给了 tool） */
  toolName?: string;
  toolArgs?: unknown;
  usage?: { prompt: number; completion: number };
  latencyMs: number;
}

export class ModelError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "ModelError";
    this.code = code;
  }
}

export interface ModelOptions {
  /** 模型服务根地址；留空表示走本机 `/api/proxy` 代理 */
  base: string;
  /** 直连时的密钥；走代理时留空（密钥只在服务端进程里） */
  apiKey: string;
  model: string;
  /** 便于测试注入 */
  fetchImpl?: typeof fetch;
}

/**
 * OpenAI 兼容的 `/chat/completions` 客户端。
 *
 * 两种部署共用它：
 * - `base` + `apiKey` 都给了 → 浏览器直连（静态站、构建时注入密钥）
 * - `base` 留空 → 打到本机 `/api/proxy`，密钥由服务端保管并注入
 */
export class OpenAICompatModel {
  readonly model: string;
  private readonly base: string;
  private readonly apiKey: string;
  private readonly call: typeof fetch;

  constructor(options: ModelOptions) {
    this.base = options.base.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
    /*
     * 必须包一层：直接把 `fetch` 存进字段，`this.call(...)` 会把实例当作
     * receiver 传给 fetch，浏览器抛 `Illegal invocation`。
     */
    this.call = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  get viaProxy() {
    return !this.base;
  }

  async complete(request: CompleteRequest): Promise<ModelReply> {
    const started = Date.now();
    const tool = request.tool;
    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages,
      temperature: request.temperature ?? 0,
      thinking: { type: "disabled" },
    };
    if (tool) {
      body.tools = [{ type: "function", function: tool }];
      body.tool_choice = { type: "function", function: { name: tool.name } };
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = "Bearer " + this.apiKey;
    const response = await this.call(this.base ? this.base + "/chat/completions" : "/api/proxy", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: request.signal,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new ModelError(
          "云端密钥无效或已失效，请更换 VITE_AI_API_KEY 后重新发布。",
          "auth",
        );
      if (response.status === 429)
        throw new ModelError("云端模型额度已用尽或被限速，请稍后重试或使用预设分析。", "rate");
      const detail = await response.text().catch(() => "");
      throw new ModelError(
        `模型服务不可用（HTTP ${response.status}）${detail ? "：" + detail.slice(0, 120) : ""}`,
        "http",
      );
    }
    const data = (await response.json()) as {
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: { function?: { name?: string; arguments?: string } }[];
        };
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const message = data.choices?.[0]?.message;
    const call = message?.tool_calls?.[0]?.function;
    let toolArgs: unknown;
    if (call?.arguments) {
      try {
        toolArgs = JSON.parse(call.arguments);
      } catch {
        throw new ModelError("模型输出格式无效。", "parse");
      }
    }
    const latencyMs = Date.now() - started;
    if (!call && !message?.content)
      throw new ModelError("模型服务返回空响应。", "empty");
    return {
      content: message?.content ?? "",
      toolName: call?.name,
      toolArgs,
      usage: {
        prompt: data.usage?.prompt_tokens ?? 0,
        completion: data.usage?.completion_tokens ?? 0,
      },
      latencyMs,
    };
  }
}

export interface ModelClient {
  readonly model: string;
  complete(request: CompleteRequest): Promise<ModelReply>;
}
