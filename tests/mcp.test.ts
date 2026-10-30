/**
 * MCP 服务的端到端测试：真的起一个子进程、走 stdio JSON-RPC。
 *
 * 只测协议层没用——要证明的是「外部 agent 通过 MCP 拿到的数字，和 UI 里点出来的一致」。
 * 所以断言直接钉死演示数据的已知值（到场率 180/300 = 60%，社团推送 65/75）。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoProject } from "../src/domain/demo";
import { serializeBackup } from "../src/domain/backup";
import { identityFingerprint, reconcile } from "../src/domain/engine";
import { ENGINE_VERSION } from "../src/domain/types";

const ROOT = new URL("..", import.meta.url).pathname;
let client: Client;
let backupPath: string;
let workdir: string;

async function makeBackup() {
  const project = await demoProject();
  const snapshot = {
    id: "snap-test",
    createdAt: "2026-10-20T10:00:00.000Z",
    label: "测试版本",
    project,
    result: reconcile(project),
    fingerprint: await identityFingerprint(project),
    engineVersion: ENGINE_VERSION,
  };
  workdir = mkdtempSync(join(tmpdir(), "tally-mcp-"));
  backupPath = join(workdir, "backup.json");
  writeFileSync(
    backupPath,
    await serializeBackup({
      project,
      snapshots: [snapshot],
      activeId: snapshot.id,
      analyses: [],
    }),
  );
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text: string }[])[0].text;
  return { data: JSON.parse(text), isError: Boolean(res.isError) };
}

beforeAll(async () => {
  execFileSync(process.execPath, ["scripts/build-mcp.mjs"], { cwd: ROOT });
  await makeBackup();
  client = new Client({ name: "vitest", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["mcp/dist/server.mjs"],
      cwd: ROOT,
    }),
  );
}, 60_000);

afterAll(async () => {
  await client?.close();
});

describe("MCP 协议", () => {
  it("暴露确定性工具，且都标注只读", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "check_claim",
      "compute_metric",
      "describe_dataset",
      "group_by",
      "list_fields",
      "open_backup",
      "preflight",
      "search_policy",
    ]);
    for (const t of tools) {
      expect(t.inputSchema, `${t.name} 缺 inputSchema`).toBeTruthy();
      expect(t.annotations?.readOnlyHint, `${t.name} 未声明只读`).toBe(true);
      expect(t.annotations?.destructiveHint).toBe(false);
    }
  });

  it("未打开数据时给出可操作的提示，而不是静默返回空", async () => {
    const { data, isError } = await call("compute_metric", { metric: "attendanceRate" });
    expect(isError).toBe(true);
    expect(data.error).toContain("open_backup");
  });

  it("检索口径库不依赖项目数据", async () => {
    const { data, isError } = await call("search_policy", { query: "重复签到", k: 2 });
    expect(isError).toBe(false);
    expect(data.hits.length).toBeGreaterThan(0);
    expect(data.hits[0].id).toMatch(/^KB-/);
  });
});

describe("MCP 计算结果与 UI 一致", () => {
  it("载入备份后给出源文件概况", async () => {
    const { data, isError } = await call("open_backup", { path: backupPath });
    expect(isError).toBe(false);
    expect(data.activity).toBe("秋日技术分享会");
    expect(data.sources).toHaveLength(3);
    expect(data.sources[0].rows).toBe(300);
  });

  it("到场率是 180/300 而不是模型估算", async () => {
    const { data } = await call("compute_metric", { metric: "attendanceRate" });
    expect(data.value).toBe(60);
    expect(data.numerator).toBe(180);
    expect(data.denominator).toBe(300);
    expect(data.evidenceCount).toBe(180);
  });

  it("按渠道分组复现四个分组的分子分母", async () => {
    const { data } = await call("group_by", {
      metric: "attendanceRate",
      groupBy: "channel",
      order: "desc",
      title: "各渠道到场率",
    });
    const rows = data.rows.map((r: { name: string; numerator: number; denominator: number }) => [
      r.name,
      r.numerator,
      r.denominator,
    ]);
    expect(rows).toEqual([
      ["社团推送", 65, 75],
      ["班级群", 50, 75],
      ["校园海报", 40, 75],
      ["朋友推荐", 25, 75],
    ]);
  });

  it("描述数据集包含字段与版本数", async () => {
    const { data } = await call("describe_dataset");
    expect(data.ready).toBe(true);
    expect(data.snapshots).toHaveLength(1);
    expect(data.sources[0].headers).toContain("学号");
  });

  it("拒绝不存在的备份路径", async () => {
    const { data, isError } = await call("open_backup", { path: "/nope/missing.json" });
    expect(isError).toBe(true);
    expect(data.error).toContain("读不到文件");
  });
});
