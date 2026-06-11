import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { RouteResponse } from "./router.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export async function serveStatic(pathname: string): Promise<RouteResponse> {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  // Prevent directory traversal
  if (safePath.includes("..")) {
    return { status: 403, body: { error: "Forbidden" } };
  }

  const filePath = join(PUBLIC_DIR, safePath);
  try {
    const content = await readFile(filePath);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    return {
      status: 200,
      body: content,
      headers: { "Content-Type": contentType },
    };
  } catch {
    return { status: 404, body: { error: "Not found" } };
  }
}
