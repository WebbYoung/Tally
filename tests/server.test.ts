import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

let mock: Server,
  api: ChildProcess,
  base = "",
  output: unknown,
  seen: any;
const plan = {
  metric: "attendanceRate",
  groupBy: "channel",
  order: "desc",
  title: "各渠道到场率",
};
async function post(
  path: string,
  input: unknown,
  origin = "http://127.0.0.1:5173",
) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(input),
  });
  return { status: response.status, body: await response.json() };
}
beforeAll(async () => {
  mock = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    seen = JSON.parse(raw);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    arguments:
                      typeof output === "string"
                        ? output
                        : JSON.stringify(output),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  });
  mock.listen(0, "127.0.0.1");
  await once(mock, "listening");
  // PORT=0 asks the OS for an unused port; the API prints the actual bound port.
  api = spawn(process.execPath, ["server/index.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: "0",
      AI_BASE_URL: `http://127.0.0.1:${(mock.address() as AddressInfo).port}`,
      AI_API_KEY: "test-only-placeholder",
      AI_MODEL: "mock-model",
    },
    windowsHide: true,
  });
  base = await new Promise<string>((resolve, reject) => {
    let text = "";
    const timer = setTimeout(
      () => reject(new Error("API did not start")),
      10000,
    );
    api.once("error", reject);
    api.stdout!.on("data", (chunk) => {
      text += chunk;
      const match = text.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
  });
});
afterAll(async () => {
  if (api) {
    api.kill();
    await once(api, "exit");
  }
  if (mock) await new Promise<void>((resolve) => mock.close(() => resolve()));
});
describe("AI 网关（模拟模型，无外部调用）", () => {
  it("仅暴露模型状态，不暴露凭据", async () => {
    const r = await fetch(base + "/api/status");
    const data = await r.json();
    expect(data).toEqual({ available: true, model: "mock-model" });
  });
  it("合法计划返回参数，发送内容只有问题与字段", async () => {
    output = { action: "plan", reason: "", plan };
    const r = await post("/api/plan", {
      question: "各渠道到场率是多少",
      fields: ["id", "channel"],
    });
    expect(r.status).toBe(200);
    expect(r.body.plan).toEqual(plan);
    expect(JSON.parse(seen.messages[1].content)).toEqual({
      question: "各渠道到场率是多少",
      availableFields: ["id", "channel"],
    });
    expect(seen.messages[1].content).not.toContain("test-only-placeholder");
  });
  it("模型拒答保留原因与分类，不产生假计划", async () => {
    output = {
      action: "unsupported",
      reason: "这需要预算与成本数据，当前工具不支持收益计算。",
      plan: null,
    };
    const r = await post("/api/plan", {
      question: "活动赚了多少钱",
      fields: ["id"],
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("unsupported");
    expect(r.body.plan).toBeUndefined();
  });
  it("缺少字段在服务端二次拦截", async () => {
    output = { action: "plan", reason: "", plan };
    const r = await post("/api/plan", {
      question: "渠道到场率",
      fields: ["id"],
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("missing_data");
  });
  it("拒绝 SQL、畸形 JSON 与因果问题", async () => {
    output = {
      action: "plan",
      reason: "",
      plan: { ...plan, metric: "sql", query: "drop table" },
    };
    expect(
      (await post("/api/plan", { question: "test", fields: [] })).status,
    ).toBe(422);
    output = "bad JSON";
    expect(
      (await post("/api/plan", { question: "test", fields: [] })).status,
    ).toBe(502);
    expect(
      (await post("/api/plan", { question: "为什么到场率最高", fields: [] }))
        .body.error,
    ).toContain("因果");
  });
  it("允许省略未知字段的映射，但拦截虚构表头", async () => {
    output = { id: "学号" };
    expect(
      (await post("/api/mapping", { headers: ["学号", "备注"] })).body.mapping,
    ).toEqual({ id: "学号" });
    output = { id: "不存在" };
    expect((await post("/api/mapping", { headers: ["学号"] })).status).toBe(
      502,
    );
  });
  it("拒绝跨站和多余原始数据字段", async () => {
    expect(
      (
        await post(
          "/api/plan",
          { question: "test", fields: [] },
          "https://untrusted.example",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post("/api/plan", {
          question: "test",
          fields: [],
          rows: [{ id: "private" }],
        })
      ).status,
    ).toBe(422);
  });
});
