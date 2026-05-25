import type { IncomingMessage, ServerResponse } from "node:http";

export interface RouteParams {
  [key: string]: string;
}

export interface RouteContext {
  params: RouteParams;
  query: URLSearchParams;
  body: unknown;
  req: IncomingMessage;
  res: ServerResponse;
}

export interface RouteResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type RouteHandler = (ctx: RouteContext) => RouteResponse | Promise<RouteResponse>;

interface RouteEntry {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

export interface RouteMatch {
  handler: RouteHandler;
  params: RouteParams;
}

export class Router {
  private readonly routes: RouteEntry[] = [];

  get(path: string, handler: RouteHandler): void {
    this.routes.push({ method: "GET", segments: path.split("/").filter(Boolean), handler });
  }

  post(path: string, handler: RouteHandler): void {
    this.routes.push({ method: "POST", segments: path.split("/").filter(Boolean), handler });
  }

  match(method: string, pathname: string): RouteMatch | undefined {
    const pathSegments = pathname.split("/").filter(Boolean);

    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== pathSegments.length) continue;

      const params: RouteParams = {};
      let matched = true;

      for (let i = 0; i < route.segments.length; i++) {
        const routeSeg = route.segments[i]!;
        const pathSeg = pathSegments[i]!;

        if (routeSeg.startsWith(":")) {
          params[routeSeg.slice(1)] = pathSeg;
        } else if (routeSeg !== pathSeg) {
          matched = false;
          break;
        }
      }

      if (matched) {
        return { handler: route.handler, params };
      }
    }

    return undefined;
  }
}
