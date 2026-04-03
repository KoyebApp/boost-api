/**
 * Worker 5 — SSE Streaming Relay + Aggregator
 * kinetex SSE plugin · concurrencyLimit · rateLimit
 *
 * Sources use httpbin.org/stream-bytes and sse.dev for real SSE events.
 * transport:"undici" removed — workerd uses its own fetch; undici raw
 * sockets are not available in the Workers sandbox.
 */

import { create, auth } from "kinetex";
import { sse, concurrencyLimit, rateLimit } from "kinetex/plugins";

const SOURCES: Record<string, string> = {
  primary:   "https://sse.dev/test",
  secondary: "https://sse.dev/test",
  tertiary:  "https://sse.dev/test",
};

interface SSEFrameOptions { data?: unknown; event?: string; id?: string; comment?: string; }

function frame({ data, event, id, comment }: SSEFrameOptions): string {
  const lines: string[] = [];
  if (comment) lines.push(`: ${comment}`);
  if (id)      lines.push(`id: ${id}`);
  if (event)   lines.push(`event: ${event}`);
  lines.push(`data: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  lines.push("", "");
  return lines.join("\n");
}

function sseHeaders(): HeadersInit {
  return { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no", "Access-Control-Allow-Origin": "*" };
}

export async function handleSSE(request: Request, env: Env): Promise<Response> {
  const url  = new URL(request.url);
  const path = url.pathname.replace(/^\/stream/, "");
  const enc  = new TextEncoder();

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Last-Event-ID" } });
  }

  if (path === "/info" || path === "" || path === "/") {
    return Response.json({
      worker:           "sse-relay",
      availableSources: Object.keys(SOURCES),
      sources:          SOURCES,
      endpoints: {
        "/stream/relay":     "Relay one upstream SSE source (add ?source=primary|secondary|tertiary)",
        "/stream/aggregate": "Merge all sources into one stream",
      },
    });
  }

  if (path === "/relay") {
    const sourceName  = url.searchParams.get("source") ?? "primary";
    const upstreamUrl = SOURCES[sourceName];
    if (!upstreamUrl) return Response.json({ error: "Unknown source", available: Object.keys(SOURCES) }, { status: 400 });

    const maxRetries  = parseInt(url.searchParams.get("maxRetries") ?? "10", 10);
    const lastEventId = request.headers.get("Last-Event-ID") ?? undefined;

    // ── kinetex instance — no undici transport in workerd ─────────────────
    const client = create({
      timeout: { response: 30_000 },
      retry: {
        limit: 5,
        delay: (n: number) => Math.min(1_000 * 2 ** n, 30_000),
        onNetworkError: true,
      },
      hooks: { onError: [(err: unknown) => { const e = err as { message: string }; console.error(JSON.stringify({ event: "sse_error", message: e.message })); }] },
    });
    const authed = client.extend(auth.bearer(env.SSE_TOKEN));
    authed.use(concurrencyLimit(20));
    authed.use(rateLimit({ requestsPerSecond: 5, burst: 10 }));
    authed.interceptors.request.use(async (cfg) => ({
      ...cfg, headers: { ...(cfg.headers as Record<string, string>), "X-Stream-ID": crypto.randomUUID(), "Cache-Control": "no-cache" },
    }));
    void authed;

    const controller = new AbortController();
    request.signal.addEventListener("abort", () => controller.abort());
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();

    void (async () => {
      try {
        await writer.write(enc.encode(frame({ comment: `connected to ${sourceName} (${upstreamUrl})` })));
        let count = 0;
        for await (const event of sse(upstreamUrl, {
          signal:  controller.signal,
          headers: { Authorization: `Bearer ${env.SSE_TOKEN}`, ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}) },
          maxRetries,
        })) {
          count++;
          await writer.write(enc.encode(frame({ event: event.event ?? "message", id: event.id, data: event.data })));
          if (count % 25 === 0) await writer.write(enc.encode(frame({ comment: `ping count=${count}` })));
          if (count >= 20) break;
        }
        await writer.write(enc.encode(frame({ event: "done", data: { count, source: sourceName } })));
      } catch (err) {
        if (!controller.signal.aborted) {
          const e = err as Error;
          await writer.write(enc.encode(frame({ event: "error", data: { message: e.message } })));
        }
      } finally { await writer.close().catch(() => undefined); }
    })();

    return new Response(readable, { headers: sseHeaders() });
  }

  if (path === "/aggregate") {
    const sourcesParam     = url.searchParams.get("sources");
    const requestedSources = sourcesParam ? sourcesParam.split(",").filter((s) => SOURCES[s]) : Object.keys(SOURCES);

    const controller = new AbortController();
    request.signal.addEventListener("abort", () => controller.abort());
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    let total    = 0;

    void (async () => {
      const tasks = requestedSources.map(async (name) => {
        const upstream = SOURCES[name];
        if (!upstream) return;
        let srcCount = 0;
        try {
          for await (const event of sse(upstream, { signal: controller.signal, maxRetries: 5 })) {
            total++;
            srcCount++;
            await writer.write(enc.encode(frame({ event: event.event ?? "message", id: event.id, data: { source: name, data: event.data, total } })));
            if (srcCount >= 10) break;
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            const e = err as Error;
            await writer.write(enc.encode(frame({ event: "source-error", data: { source: name, error: e.message } })));
          }
        }
      });
      await Promise.allSettled(tasks);
      if (!controller.signal.aborted) await writer.write(enc.encode(frame({ event: "aggregate-done", data: { sources: requestedSources, total } })));
      await writer.close().catch(() => undefined);
    })();

    return new Response(readable, { headers: sseHeaders() });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}
