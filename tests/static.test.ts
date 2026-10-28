import { beforeAll, afterAll, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
// @ts-expect-error server is deliberately plain Node ESM
import { serveStatic } from "../server/static.mjs";
let server: Server, directory: string, base: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "tally-static-"));
  await mkdir(join(directory, "assets"));
  await writeFile(
    join(directory, "index.html"),
    "<!doctype html><h1>对表</h1>",
  );
  await writeFile(
    join(directory, "assets", "index-abc.js"),
    "export default 1",
  );
  await writeFile(join(directory, ".env"), "not-public");
  server = createServer(async (req, res) => {
    if (!(await serveStatic(req, res, pathToFileURL(directory + "/")))) {
      res.writeHead(404);
      res.end();
    }
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  // Only the exact mkdtemp-owned directory is removed.
  if (directory) await rm(directory, { recursive: true, force: true });
});
it("提供首页、缓存构建资源、HEAD 和缺失文件响应", async () => {
  const home = await fetch(base + "/");
  expect(await home.text()).toContain("对表");
  expect(home.headers.get("content-security-policy")).toContain(
    "frame-ancestors 'none'",
  );
  const asset = await fetch(base + "/assets/index-abc.js");
  expect(asset.headers.get("content-type")).toBe("text/javascript");
  expect(asset.headers.get("cache-control")).toContain("immutable");
  expect(await (await fetch(base + "/", { method: "HEAD" })).text()).toBe("");
  expect((await fetch(base + "/assets/missing.js")).status).toBe(404);
});
it("不提供密钥、源代码、编码穿越和非静态方法", async () => {
  for (const path of [
    "/.env",
    "/server/index.mjs",
    "/assets/%2e%2e%2f.env",
    "/assets/a\\..\\.env",
    "/api/status",
  ])
    expect((await fetch(base + path)).status).toBe(404);
  expect((await fetch(base + "/", { method: "POST" })).status).toBe(404);
});
