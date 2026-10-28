import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../dist/", import.meta.url);
const types = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
export async function serveStatic(req, res, directory = root) {
  if (!["GET", "HEAD"].includes(req.method)) return false;
  const pathname = req.url.split("?")[0];
  // Only build output is served: no repository, dotfiles or path traversal.
  if (
    pathname !== "/" &&
    pathname !== "/index.html" &&
    !/^\/assets\/[\w.-]+$/.test(pathname)
  )
    return false;
  const file = pathname === "/" ? "index.html" : pathname.slice(1);
  try {
    const content = await readFile(fileURLToPath(new URL(file, directory)));
    const extension = file.slice(file.lastIndexOf("."));
    res.writeHead(200, {
      "Content-Type":
        file === "index.html"
          ? "text/html; charset=utf-8"
          : types[extension] || "application/octet-stream",
      "Content-Length": content.length,
      "Cache-Control":
        file === "index.html"
          ? "no-cache"
          : "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("未找到构建文件，请先运行 npm run build。");
  }
  return true;
}
