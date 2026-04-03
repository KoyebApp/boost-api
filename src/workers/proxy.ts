/**
 * Worker 4 — Proxy Fetcher
 * kinetex + proxyMiddleware + envProxy + SOCKS5 + Digest auth
 * responseSizeLimit · HAR recording · SSRF allowlist
 *
 * Updated allowlist includes real test endpoints:
 *   httpbin.org    — echo, status codes, auth, delays, compression
 *   reqres.in      — REST users API with real JSON
 *   api.github.com — large real responses for size-limit testing
 */

import { create, auth, HTTPError, TimeoutError } from "kinetex";
import { proxyMiddleware, envProxy, cookieJar, withCookies, responseSizeLimit, ResponseSizeError } from "kinetex/plugins";

const ALLOWED_ORIGINS = new Set([
  "httpbin.org",
  "reqres.in",
  "api.github.com",
  "api.publicapis.org",
]);

function isAllowedTarget(raw: string): boolean {
  try { return ALLOWED_ORIGINS.has(new URL(raw).hostname); } catch { return false; }
}

export async function handleProxy(request: Request, env: Env): Promise<Response> {
  const url  = new URL(request.url);
  const path = url.pathname.replace(/^\/proxy/, "");

  // ── All kinetex instances created INSIDE the handler ──────────────────────
  const base = {
    timeout: { request: 30_000 as const, response: 8_000 as const },
    retry: { limit: 3, statusCodes: [429, 502, 503, 504], delay: (n: number) => 500 * 2 ** n, onNetworkError: true },
    headers: { "User-Agent": "kinetex-proxy-worker/1.0.0", "Accept-Encoding": "gzip, deflate, br" },
  };
  const jar = cookieJar();

  const instances = {
    corporate: create(base).use(withCookies(jar)).use(responseSizeLimit(10 * 1024 * 1024)).use(proxyMiddleware({
      url: env.CORPORATE_PROXY_URL, auth: { username: env.PROXY_USER, password: env.PROXY_PASS },
      noProxy: ["localhost", "127.0.0.1", ".internal"], headers: { "Proxy-Connection": "keep-alive" },
    })),
    env: create(base).use(withCookies(jar)).use(responseSizeLimit(10 * 1024 * 1024)).use(envProxy()),
    socks5: create(base).use(withCookies(jar)).use(responseSizeLimit(5 * 1024 * 1024)).use(proxyMiddleware({ url: env.SOCKS5_PROXY_URL, protocol: "socks5" })),
    "direct-digest": create({ ...base, timeout: 15_000 }).use(withCookies(jar)).use(auth.digest(env.DIGEST_USER, env.DIGEST_PASS)),
  };

  if (path === "/profiles" || path === "" || path === "/") {
    return Response.json({
      profiles: [
        { name: "corporate",     description: "Corporate HTTP proxy with basic auth",            header: "X-Proxy-Profile: corporate" },
        { name: "env",           description: "Reads HTTP_PROXY / HTTPS_PROXY from environment", header: "X-Proxy-Profile: env" },
        { name: "socks5",        description: "SOCKS5 tunnel (requires socks-proxy-agent)",       header: "X-Proxy-Profile: socks5" },
        { name: "direct-digest", description: "Direct fetch with RFC 2617 Digest auth",           header: "X-Proxy-Profile: direct-digest" },
      ],
      allowlist: [...ALLOWED_ORIGINS],
      usage:    "POST /proxy/fetch  body:{url,method?,headers?,body?}  header:X-Proxy-Profile:<name>",
      examples: [
        { url: "https://httpbin.org/get",                              note: "Echo headers — good for verifying proxy headers are forwarded" },
        { url: "https://httpbin.org/status/503",                       note: "Always 503 — triggers retry logic" },
        { url: "https://httpbin.org/delay/2",                          note: "2-second delay — tests timeout config" },
        { url: "https://reqres.in/api/users",                          note: "Real paginated JSON — tests response parsing" },
        { url: "https://api.github.com/repos/denoland/deno",           note: "Large real JSON — tests responseSizeLimit" },
        { url: "https://httpbin.org/digest-auth/auth/user/pass",       note: "Use with direct-digest profile" },
      ],
    });
  }

  if (path === "/fetch" && request.method === "POST") {
    let payload: { url?: string; method?: string; headers?: Record<string, string>; body?: unknown };
    try { payload = await request.json() as typeof payload; } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }

    const { url: targetUrl, method = "GET", headers = {}, body } = payload;
    if (!targetUrl) return Response.json({ error: "url is required" }, { status: 400 });
    if (!isAllowedTarget(targetUrl)) return Response.json({ error: "Target not in allowlist", allowed: [...ALLOWED_ORIGINS] }, { status: 403 });

    const profileKey = (request.headers.get("X-Proxy-Profile") ?? "env") as keyof typeof instances;
    const client     = instances[profileKey];
    if (!client) return Response.json({ error: "Unknown proxy profile", available: Object.keys(instances) }, { status: 400 });

    try {
      const res = await client.get(targetUrl, { method: method.toUpperCase(), headers, ...(body ? { json: body } : {}), throwHttpErrors: false, har: true });
      return Response.json({ ok: true, proxyProfile: profileKey, status: res.status, timing: res.timing, retries: res.retries, data: res.data });
    } catch (err) {
      if (err instanceof ResponseSizeError) return Response.json({ error: "Response too large", actual: err.actualBytes, limit: err.maxBytes }, { status: 413 });
      if (err instanceof TimeoutError)      return Response.json({ error: "Timed out via proxy", profile: profileKey }, { status: 504 });
      if (err instanceof HTTPError)         return Response.json({ error: "HTTP error", status: err.response?.status }, { status: err.response?.status ?? 502 });
      const e = err as Error;
      return Response.json({ error: e.message }, { status: 502 });
    }
  }

  if (path === "/har") {
    const har = instances.env.exportHAR?.();
    return Response.json(har ?? { message: "No HAR entries yet — POST /proxy/fetch first" });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}
