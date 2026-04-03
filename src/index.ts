/**
 * kinetex-cf-workers — unified entry point
 *
 * IMPORTANT: All imports from kinetex must stay inside handler functions
 * because kinetex creates a default singleton at module scope which violates
 * Cloudflare Workers' global-scope restriction. Dynamic imports ensure
 * kinetex only initialises inside a handler invocation.
 */

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // Dynamic imports — kinetex and all workers load inside the handler,
    // never at module evaluation time.
    const url  = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin":  "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Request-ID, X-Proxy-Profile, Last-Event-ID",
          "Access-Control-Max-Age":       "86400",
        },
      });
    }

    if (path.startsWith("/gateway"))  { const { handleGateway }  = await import("./workers/gateway.js");  return handleGateway(request, env); }
    if (path.startsWith("/validate")) { const { handleValidator } = await import("./workers/validator.js"); return handleValidator(request, env); }
    if (path.startsWith("/forms"))    { const { handleForms }     = await import("./workers/forms.js");     return handleForms(request, env); }
    if (path.startsWith("/proxy"))    { const { handleProxy }     = await import("./workers/proxy.js");     return handleProxy(request, env); }
    if (path.startsWith("/stream"))   { const { handleSSE }       = await import("./workers/sse.js");       return handleSSE(request, env); }
    if (path.startsWith("/graphql"))  { const { handleGraphQL }   = await import("./workers/graphql.js");   return handleGraphQL(request, env); }
    if (path.startsWith("/misc"))     { const { handleMisc }      = await import("./workers/misc.js");      return handleMisc(request, env); }

    return Response.json({
      name:        "kinetex-cf-workers",
      version:     "1.0.0",
      kinetex:     "0.0.2",
      description: "Seven Cloudflare Workers exercising every kinetex feature against real public APIs.",
      upstreams:   ["api.github.com", "httpbin.org", "reqres.in", "countries.trevorblades.com", "sse.dev"],
      workers: {
        "Worker 1 — API Gateway":    "GET /gateway/{zen|users|repos|retry|slow}",
        "Worker 2 — Zod Validator":  "GET /validate?resource={user|users|repo|fail}  |  GET /validate/har",
        "Worker 3 — Valibot Forms":  "POST /forms/submit/{contact|newsletter|feedback}  |  GET /forms/schema/{name}",
        "Worker 4 — Proxy Fetcher":  "POST /proxy/fetch  |  GET /proxy/profiles  |  GET /proxy/har",
        "Worker 5 — SSE Relay":      "GET /stream/relay[?source=&maxRetries=]  |  GET /stream/aggregate[?sources=]",
        "Worker 6 — GraphQL Proxy":  "GET /graphql/countries[?continent=]  |  GET /graphql/country/:code  |  POST /graphql/raw",
        "Worker 7 — Misc Features":  "GET /misc/{compose|basic-auth|aws-sigv4|callback|cancel-all|cancel-chain|redirects|decompress|response-types|throw-http-errors|sub-instance|extend}",
      },
      stack: ["kinetex@0.0.2", "zod@3", "valibot@1", "socks-proxy-agent@8"],
      docs:  "https://kinetexjs.github.io/kinetex/",
    });
  },
} satisfies ExportedHandler<Env>;
