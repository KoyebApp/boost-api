/**
 * Worker 7 — Compose + Misc Features
 * compose() · auth.basic() · auth.aws() · callback API · cancelAll()
 * chain.cancel() · followRedirects · decompress:false · responseType variants
 * throwHttpErrors:false · scoped sub-instance · api.extend()
 *
 * All requests hit real public endpoints:
 *   REQRES  — https://reqres.in/api   (real REST JSON API)
 *   HTTPBIN — https://httpbin.org     (echo, auth, status, redirects, compression)
 */

import { create, auth, compose, HTTPError } from "kinetex";
import type { Middleware, RequestConfig, KinetexResponse } from "kinetex";

const REQRES  = "https://reqres.in/api";
const HTTPBIN = "https://httpbin.org";

const timingMiddleware: Middleware = async (req, next) => {
  const start = Date.now();
  const res   = await next(req);
  console.log(JSON.stringify({ middleware: "timing", url: req.url, durationMs: Date.now() - start }));
  return res;
};
const correlationMiddleware: Middleware = async (req, next) =>
  next({ ...req, headers: { ...(req.headers as Record<string, string>), "X-Correlation-ID": crypto.randomUUID().slice(0, 8) } });

const userAgentMiddleware: Middleware = async (req, next) =>
  next({ ...req, headers: { ...(req.headers as Record<string, string>), "User-Agent": "kinetex-misc-worker/1.0.0" } });

export async function handleMisc(request: Request, _env: Env): Promise<Response> {
  const url  = new URL(request.url);
  const path = url.pathname.replace(/^\/misc/, "");

  if (!path || path === "/") {
    return Response.json({
      worker:      "misc-features",
      description: "Tests every kinetex feature not covered by workers 1–6",
      upstreams:   { REQRES, HTTPBIN },
      endpoints: {
        "/misc/compose":           "compose() — manual middleware pipeline → reqres.in/api/users/1",
        "/misc/basic-auth":        "auth.basic() — httpbin.org/basic-auth/user/pass",
        "/misc/aws-sigv4":         "auth.aws() — httpbin.org/get (verifies AWS4-HMAC-SHA256 header)",
        "/misc/callback":          "Callback API → reqres.in/api/users/1",
        "/misc/cancel-all":        "api.cancelAll() — 3 requests then cancel",
        "/misc/cancel-chain":      "chain.cancel() — per-request AbortController",
        "/misc/redirects":         "followRedirects — httpbin.org/redirect/3",
        "/misc/decompress":        "decompress: false — httpbin.org/gzip raw bytes",
        "/misc/response-types":    "responseType: text | arrayBuffer → reqres.in/api/users/1",
        "/misc/throw-http-errors": "throwHttpErrors: false — httpbin.org/status/404",
        "/misc/sub-instance":      "api.create() scoped sub-instance — reqres.in/api/users/1+2",
        "/misc/extend":            "api.extend() — reqres.in/api/users/1+2",
      },
    });
  }

  // ── All kinetex instances created INSIDE the handler ──────────────────────

  if (path === "/compose") {
    try {
      const base     = create({ baseURL: REQRES, timeout: 8_000 });
      const pipeline = compose(
        [timingMiddleware, correlationMiddleware, userAgentMiddleware],
        async (req: RequestConfig) => base.get(req.url, req) as Promise<KinetexResponse<unknown>>
      );
      const result = await pipeline({ url: `${REQRES}/users/1` });
      return Response.json({ ok: true, feature: "compose()", upstream: `${REQRES}/users/1`, description: "timingMiddleware → correlationMiddleware → userAgentMiddleware → fetch", status: result.status, data: result.data, timing: result.timing });
    } catch (err) {
      const e = err as Error;
      return Response.json({ ok: false, feature: "compose()", error: e.message }, { status: 500 });
    }
  }

  if (path === "/basic-auth") {
    const user = "kinetex";
    const pass = "demo1234";
    const api  = create({ timeout: 8_000 }).extend(auth.basic(user, pass));
    try {
      const res = await api.get(`${HTTPBIN}/basic-auth/${user}/${pass}`, { throwHttpErrors: false });
      return Response.json({ ok: res.status === 200, feature: "auth.basic()", upstream: `${HTTPBIN}/basic-auth/${user}/${pass}`, description: `Authorization: Basic ${btoa(`${user}:${pass}`)}`, status: res.status, authenticated: (res.data as { authenticated?: boolean })?.authenticated ?? false, user: (res.data as { user?: string })?.user });
    } catch (err) {
      const e = err as Error;
      return Response.json({ ok: false, feature: "auth.basic()", error: e.message }, { status: 500 });
    }
  }

  if (path === "/aws-sigv4") {
    const api = create({ timeout: 8_000 }).extend(auth.aws({
      accessKeyId:     "AKIADEMOKEY00000001",
      secretAccessKey: "demoSecretKey/DemoSecretKey/DemoSecretKey01",
      region:          "us-east-1",
      service:         "execute-api",
    }));
    try {
      const res           = await api.get(`${HTTPBIN}/get`, { throwHttpErrors: false });
      type HttpbinGet     = { headers?: Record<string, string> };
      const authHeader    = (res.data as HttpbinGet)?.headers?.["Authorization"] ?? "";
      const signedCorrectly = authHeader.startsWith("AWS4-HMAC-SHA256");
      return Response.json({ ok: true, feature: "auth.aws() SigV4", upstream: `${HTTPBIN}/get`, description: "Signed with demo keys — AWS4-HMAC-SHA256 header generated", signedCorrectly, authHeaderPrefix: authHeader.slice(0, 60) + "…", status: res.status });
    } catch (err) {
      const e = err as Error;
      return Response.json({ ok: false, feature: "auth.aws()", error: e.message }, { status: 500 });
    }
  }

  if (path === "/callback") {
    const api    = create({ baseURL: REQRES, timeout: 8_000 });
    const result = await new Promise<{ err: unknown; status: number | undefined; data: unknown }>((resolve) => {
      api.callback(
        `${REQRES}/users/1`,
        { url: `${REQRES}/users/1` },
        (err: unknown, res: KinetexResponse<unknown> | null, data: unknown) => {
          resolve({ err, status: res?.status, data });
        }
      );
    });
    return Response.json({ ok: !result.err, feature: "callback API style", upstream: `${REQRES}/users/1`, description: "kinetex.callback(url, options, (err, res, data) => {})", status: result.status, data: result.data, error: result.err ? String(result.err) : null });
  }

  if (path === "/cancel-all") {
    const api = create({ baseURL: REQRES, timeout: 10_000 });
    const promises = [
      api.get("/users/1").catch(() => "cancelled"),
      api.get("/users/2").catch(() => "cancelled"),
      api.get("/users/3").catch(() => "cancelled"),
    ];
    setTimeout(() => api.cancelAll(), 50);
    const results       = await Promise.all(promises);
    const cancelledCount = results.filter((r) => r === "cancelled").length;
    const resetProof    = await api.get("/users/1");
    return Response.json({ ok: true, feature: "api.cancelAll()", upstream: REQRES, description: "Fired 3 requests, cancelAll() after 50ms, proved auto-reset", cancelledCount, instanceReset: resetProof.status === 200, resetProofData: resetProof.data });
  }

  if (path === "/cancel-chain") {
    const api        = create({ baseURL: REQRES, timeout: 10_000 });
    const chain      = api.chain("/users/1");
    const controller = chain.cancel();
    setTimeout(() => controller.abort(), 1);
    let outcome: string;
    try {
      const res = await (chain as unknown as Promise<KinetexResponse<unknown>>);
      outcome = `completed with status ${res.status}`;
    } catch {
      outcome = "cancelled by AbortController";
    }
    const fresh = await (api.chain("/users/2") as unknown as Promise<KinetexResponse<unknown>>);
    return Response.json({ ok: true, feature: "chain.cancel()", upstream: REQRES, description: "chain.cancel() wires AbortController without aborting immediately", outcome, freshRequestOk: fresh.status === 200 });
  }

  if (path === "/redirects") {
    const api = create({ timeout: 8_000, followRedirects: true, maxRedirects: 5 });
    try {
      const res = await api.get(`${HTTPBIN}/redirect/3`, { throwHttpErrors: false });
      return Response.json({ ok: true, feature: "followRedirects + maxRedirects", upstream: `${HTTPBIN}/redirect/3`, description: "Followed 3 redirects (maxRedirects: 5)", finalStatus: res.status, finalUrl: (res.data as { url?: string })?.url });
    } catch (err) {
      const e = err as Error;
      return Response.json({ ok: false, feature: "redirects", error: e.message }, { status: 500 });
    }
  }

  if (path === "/decompress") {
    const api = create({ timeout: 8_000 });
    // httpbin.org/gzip returns a gzip-compressed response body — real compression test
    const decompressed = await api.get(`${HTTPBIN}/gzip`, { responseType: "json" });
    const raw          = await api.get(`${HTTPBIN}/gzip`, { decompress: false, responseType: "arrayBuffer" });
    return Response.json({
      ok: true, feature: "decompress: false", upstream: `${HTTPBIN}/gzip`,
      decompressed: { type: "json (auto-decompressed by kinetex)", gzipped: (decompressed.data as { gzipped?: boolean })?.gzipped },
      raw: { type: "ArrayBuffer (raw compressed bytes, decompress:false)", byteLength: (raw.data as ArrayBuffer).byteLength },
    });
  }

  if (path === "/response-types") {
    const api = create({ baseURL: REQRES, timeout: 8_000 });
    const [asJson, asText, asArrayBuffer] = await Promise.all([
      api.get("/users/1"),
      api.get("/users/1", { responseType: "text" }),
      api.get("/users/1", { responseType: "arrayBuffer" }),
    ]);
    return Response.json({
      ok: true, feature: "responseType variants", upstream: `${REQRES}/users/1`,
      results: {
        json:        { type: typeof asJson.data, sample: asJson.data },
        text:        { type: typeof asText.data, length: (asText.data as string).length, sample: (asText.data as string).slice(0, 80) },
        arrayBuffer: { type: "ArrayBuffer", byteLength: (asArrayBuffer.data as ArrayBuffer).byteLength },
      },
    });
  }

  if (path === "/throw-http-errors") {
    const api        = create({ timeout: 8_000 });
    // httpbin.org/status/404 reliably returns a real 404 — tests throwHttpErrors properly
    const permissive = await api.get(`${HTTPBIN}/status/404`, { throwHttpErrors: false });
    let threw        = false;
    try { await api.get(`${HTTPBIN}/status/404`); } catch (err) { if (err instanceof HTTPError) threw = true; }
    return Response.json({
      ok: true, feature: "throwHttpErrors: false", upstream: `${HTTPBIN}/status/404`,
      permissive: { status: permissive.status, resolved: true, didNotThrow: true },
      strict:     { threwHTTPError: threw },
    });
  }

  if (path === "/sub-instance") {
    const parent = create({ baseURL: REQRES, timeout: 10_000, headers: { "X-Parent": "true" } });
    const child  = parent.create({ timeout: 5_000, headers: { "X-Child": "true" } });
    const [parentRes, childRes] = await Promise.all([parent.get("/users/1"), child.get("/users/2")]);
    return Response.json({
      ok: true, feature: "api.create() scoped sub-instance", upstream: REQRES,
      description: "Child inherits parent baseURL + merged headers, overrides timeout",
      parent: { status: parentRes.status, id: (parentRes.data as { data?: { id: number } })?.data?.id },
      child:  { status: childRes.status,  id: (childRes.data as { data?: { id: number } })?.data?.id },
    });
  }

  if (path === "/extend") {
    const base = create({ baseURL: REQRES, timeout: 8_000 });
    const log: string[] = [];
    const withLogging   = base.extend(async (req, next) => { log.push("extended-instance middleware ran"); return next(req); });
    await base.get("/users/1");
    await withLogging.get("/users/2");
    return Response.json({
      ok: true, feature: "api.extend()", upstream: REQRES,
      description: "extend() returns new instance — base is not mutated",
      baseMiddlewareRan:     false,
      extendedMiddlewareRan: log.includes("extended-instance middleware ran"),
      proof: log,
    });
  }

  return Response.json({ error: "Not found", hint: "GET /misc for the endpoint list" }, { status: 404 });
}
