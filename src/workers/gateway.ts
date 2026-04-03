/**
 * Worker 1 — API Gateway
 * kinetex + native fetch · Bearer Auth · Retry · Structured Logging
 * Concurrency + rate limiting · Interceptors · Lifecycle hooks
 *
 * Routes hit real public APIs to exercise every kinetex feature:
 *   zen   → github.com/zen         (fast text, proves basic fetch works)
 *   users → github.com/users       (real JSON array, tests parsing + auth headers)
 *   repos → github.com/repos/...   (large object, tests timing metrics)
 *   retry → httpbin.org/status/503 (always 503 → drives 3 retries then HTTPError)
 *   slow  → httpbin.org/delay/3    (3-second response → proves timeout config)
 */

import { create, auth, HTTPError, TimeoutError } from "kinetex";
import type { RequestConfig, KinetexResponse } from "kinetex";
import { concurrencyLimit, rateLimit } from "kinetex/plugins";

const UPSTREAM_ROUTES: Record<string, string> = {
  zen:   "https://api.github.com/zen",
  users: "https://api.github.com/users?per_page=5",
  repos: "https://api.github.com/repos/denoland/deno",
  retry: "https://httpbin.org/status/503",
  slow:  "https://httpbin.org/delay/3",
};

function makeLogger(requestId: string) {
  return {
    request: (config: RequestConfig) =>
      console.log(JSON.stringify({ level: "info", phase: "request", requestId, method: config.method ?? "GET", url: config.url })),
    response: (res: KinetexResponse<unknown>) =>
      console.log(JSON.stringify({ level: "info", phase: "response", requestId, status: res.status, durationMs: res.timing?.duration, retries: res.retries, fromCache: res.fromCache })),
    error: (err: unknown) => {
      const e = err as { message: string; response?: { status: number } };
      console.error(JSON.stringify({ level: "error", phase: "error", requestId, message: e.message, status: e.response?.status ?? null }));
    },
  };
}

export async function handleGateway(request: Request, env: Env): Promise<Response> {
  const url       = new URL(request.url);
  const segment   = url.pathname.replace(/^\/gateway\/?/, "").split("/")[0] ?? "";
  const requestId = crypto.randomUUID();

  if (request.method !== "GET") {
    return Response.json({ error: "Only GET is supported" }, { status: 405 });
  }

  const upstreamUrl = UPSTREAM_ROUTES[segment];
  if (!upstreamUrl) {
    return Response.json({ error: "Unknown resource", available: Object.keys(UPSTREAM_ROUTES) }, { status: 404 });
  }

  // ── kinetex instance created INSIDE the handler — never at module scope ────
  const api = create({
    timeout:   { request: 15_000, response: 8_000 },
    retry: {
      limit: 3, statusCodes: [429, 500, 502, 503, 504], methods: ["GET"],
      delay: (attempt: number) => Math.min(150 * 2 ** attempt, 5_000),
      onNetworkError: true,
      onRetry: (attempt: number, error: unknown) => {
        const e = error as Error;
        console.warn(`[${requestId}] Retry ${attempt}: ${e.message}`);
      },
    },
    headers: { "User-Agent": "kinetex-gateway-worker/1.0.0" },
    logger: makeLogger(requestId),
  });

  const authedApi = api.extend(auth.bearer(env.API_TOKEN));
  authedApi.use(concurrencyLimit(10));
  authedApi.use(rateLimit({ requestsPerSecond: 50, burst: 100 }));

  authedApi.interceptors.request.use(async (config: RequestConfig) => ({
    ...config,
    headers: { ...(config.headers as Record<string, string>), "X-Request-ID": requestId, "X-Gateway": "kinetex-cf-worker/1.0.0" },
  }));

  const hooks = {
    afterResponse: [
      (res: KinetexResponse<unknown>) => {
        console.log(JSON.stringify({ level: "metric", event: "response_timing", requestId, ttfb: res.timing?.ttfb, duration: res.timing?.duration, status: res.status }));
        return res;
      },
    ],
  };

  try {
    const res = await authedApi.get(upstreamUrl, { hooks });
    return new Response(JSON.stringify(res.data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": requestId,
        "X-Response-Time": `${res.timing?.duration ?? 0}ms`,
        "X-Retries": String(res.retries ?? 0),
        "X-From-Cache": String(res.fromCache ?? false),
        "Cache-Control": "public, max-age=30",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    if (err instanceof HTTPError) {
      return Response.json({ error: "Upstream HTTP error", status: err.response?.status, requestId, retries: (err as unknown as { retries?: number }).retries ?? 0, note: segment === "retry" ? "Expected — httpbin/status/503 always 503, proves retry exhaustion" : undefined }, { status: err.response?.status ?? 502 });
    }
    if (err instanceof TimeoutError) return Response.json({ error: "Upstream timed out", requestId, note: segment === "slow" ? "Expected if response timeout < 3s delay" : undefined }, { status: 504 });
    const e = err as Error;
    return Response.json({ error: "Internal error", message: e.message, requestId }, { status: 500 });
  }
}
