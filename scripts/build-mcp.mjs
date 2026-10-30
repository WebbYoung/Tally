/**
 * 把 MCP 服务打成单文件：`mcp/dist/server.mjs`。
 *
 * 为什么不直接 `node mcp/server.ts`：项目源码内部的 import 不带扩展名
 * （交给打包器解析），Node 的类型剥离做不到这件事。打一次包，运行时就只剩
 * 一个 `.mjs` + node_modules 里的 SDK。
 */
import { build } from "esbuild";

export async function buildMcp() {
  await build({
    entryPoints: ["mcp/server.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: "mcp/dist/server.mjs",
    /* SDK / zod 留在 node_modules，其余源码全部打进来 */
    packages: "external",
    logLevel: "warning",
  });
  return "mcp/dist/server.mjs";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await buildMcp();
  console.log(`built ${out}`);
}
