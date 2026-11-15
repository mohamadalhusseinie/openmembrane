import { readFile } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { RouteResponse } from "./router.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const require = createRequire(import.meta.url);
const THREE_BUILD_DIR = dirname(require.resolve("three"));
const THREE_PACKAGE_DIR = dirname(THREE_BUILD_DIR);
const VENDOR_ASSETS: Record<string, string> = {
  "/vendor/three.module.js": join(THREE_BUILD_DIR, "three.module.js"),
  "/vendor/three.core.js": join(THREE_BUILD_DIR, "three.core.js"),
  "/vendor/OrbitControls.js": join(THREE_PACKAGE_DIR, "examples", "jsm", "controls", "OrbitControls.js"),
};

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
  const vendorFile = VENDOR_ASSETS[pathname];
  if (vendorFile) {
    try {
      return {
        status: 200,
        body: await readFile(vendorFile),
        headers: { "Content-Type": "application/javascript; charset=utf-8" },
      };
    } catch {
      return {
        status: 500,
        body: { error: "Could not load the locally installed 3D graph renderer." },
      };
    }
  }

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
