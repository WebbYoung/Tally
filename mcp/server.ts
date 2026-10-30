#!/usr/bin/env node
/**
 * Tally MCP 服务（stdio）。
 *
 * 定位：把「确定性计算层」暴露给任意 MCP 客户端（Claude Desktop、Cursor、IDE agent…）。
 *
 * 边界（这一点是这个服务存在的理由）：
 * - 这里**不调用任何模型**。所有工具都是`engine.ts` 里的确定性计算，同样的输入永远得到同样的输出。
 * - 模型可以在客户端对话里编数字，但拿不到这里的证据链；这里的每个数字都带分子/分母/原始行号。
 * - 因此 MCP 客户端里说的每个数，都可以回到这里核验。
 *
 * 用法：`npm run mcp`（先 `npm run mcp:build`），在客户端配置里指向 `mcp/dist/server.mjs`。
 * 数据来源：App 里「工作空间与备份 → 导出备份」得到的 JSON 文件，路径传给 `open_backup`。
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { callTool, toolsForMcp, type ToolContext } from "../src/domain/tools.ts";
import { parseBackup } from "../src/domain/backup.ts";
import { reconcile } from "../src/domain/engine.ts";
import type { Snapshot } from "../src/domain/types.ts";

const NAME = "tally";
const VERSION = "0.3.0";

/** 进程内只持有一份打开的项目：MCP 是无状态的单客户端会话，多项目会带来歧义。 */
let ctx: ToolContext | null = null;
let loadedPath = "";
let loadedSnapshots: Snapshot[] = [];

const OPEN_TOOL = {
  name: "open_backup",
  title: "打开 Tally 备份",
  description:
    "载入 Tally 导出的备份 JSON（App：工作空间与备份 → 导出备份）。之后其他工具都作用在这份数据上。只读，不修改原文件。",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "备份 JSON 的绝对或相对路径" } },
    required: ["path"],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

const EXTRA = [
  {
    name: "describe_dataset",
    title: "描述当前数据集",
    description:
      "返回已打开项目的概况：活动名、数据源、行数、可用字段、已确认版本数。不了解手上有什么数据时先调它。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: OPEN_TOOL.annotations,
  },
];

/** 指标太多带证据，先只给读得懂的部分；要证据用 compute_metric。 */
function summarize(metrics: Record<string, { label: string; value: number | null; unit: string }>) {
  return Object.fromEntries(
    Object.entries(metrics).map(([key, m]) => [
      key,
      { label: m.label, value: m.value, unit: m.unit },
    ]),
  );
}

function toolList() {
  return [...toolsForMcp(), OPEN_TOOL, ...EXTRA];
}

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    isError: false,
  };
}

function bad(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

function requireCtx() {
  if (!ctx) return "尚未打开数据。请先用 open_backup 载入 Tally 备份 JSON。";
  return null;
}

async function openBackup(input: Record<string, unknown>) {
  const path = String(input.path ?? "").trim();
  if (!path) return bad("缺少 path 参数。");
  const absolute = resolve(path);
  let raw: string;
  try {
    raw = await readFile(absolute, "utf8");
  } catch {
    return bad(`读不到文件：${absolute}`);
  }
  if (raw.length > 32 * 1024 * 1024) return bad("备份文件过大（上限 32 MB）。");
  let state;
  try {
    state = await parseBackup(raw);
  } catch (e) {
    return bad(`备份校验失败：${e instanceof Error ? e.message : "格式不符"}`);
  }
  const project = state.project;
  const result = reconcile(project);
  ctx = { project, result, snapshot: undefined };
  loadedPath = absolute;
  loadedSnapshots = state.snapshots ?? [];
  return ok({
    opened: absolute,
    activity: project.name,
    date: project.date,
    demo: project.demo,
    sources: project.sources.map((s) => ({
      name: s.name,
      role: s.role,
      rows: s.rows.length,
      confirmed: s.confirmed,
    })),
    ready: result.ready,
    warnings: result.warnings.slice(0, 5),
    snapshots: loadedSnapshots.length,
    metrics: summarize(result.metrics),
  });
}

function describe() {
  if (!ctx) return bad(requireCtx()!);
  const project = ctx.project;
  const result = ctx.result ?? reconcile(project);
  return ok({
    path: loadedPath,
    activity: project.name,
    date: project.date,
    policy: project.policy,
    sources: project.sources.map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      rows: s.rows.length,
      headers: s.headers,
      mapping: s.mapping,
      confirmed: s.confirmed,
    })),
    ready: result.ready,
    totalRows: result.totalRows,
    warnings: result.warnings,
    issues: result.issues.slice(0, 20),
    metrics: summarize(result.metrics),
    snapshots: loadedSnapshots.map((s) => ({
      id: s.id,
      label: s.label,
      createdAt: s.createdAt,
    })),
  });
}

function callToolResult(name: string, input: Record<string, unknown>) {
  const blocked = requireCtx();
  /* search_policy 不依赖项目数据，允许在未打开时先查口径。 */
  if (blocked && name !== "search_policy") return bad(blocked);
  if (name === "search_policy") {
    const hit = callTool(name, input, { project: ctx?.project as never, result: ctx?.result });
    return hit.ok ? ok(hit.data) : bad(hit.error ?? "检索失败。");
  }
  const outcome = callTool(name, input, ctx!);
  return outcome.ok ? ok(outcome.data) : bad(outcome.error ?? "工具执行失败。");
}

const server = new Server({ name: NAME, version: VERSION }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList() }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const input = (args ?? {}) as Record<string, unknown>;
  try {
    if (name === "open_backup") return await openBackup(input);
    if (name === "describe_dataset") return describe();
    return callToolResult(name, input);
  } catch (e) {
    return bad(e instanceof Error ? e.message : "未知错误。");
  }
});

await server.connect(new StdioServerTransport());
console.error(`[tally-mcp] ready · ${toolList().length} tools · 无模型调用，全部为确定性计算`);
