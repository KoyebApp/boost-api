/**
 * Worker 2 — Zod Validator
 * kinetex + Zod schema · fluent chain · HAR · auth.apiKey() · lifecycle hooks
 *
 * Hits real public APIs with strict Zod schemas to verify kinetex
 * schema enforcement, HAR recording, and the chain() fluent API:
 *   user  → reqres.in/api/users/2         (single user, wrapped response)
 *   users → reqres.in/api/users           (paginated list)
 *   repo  → api.github.com/repos/denoland/deno (large real object)
 *   fail  → httpbin.org/status/422        (upstream error path)
 */

import { create, auth, HTTPError, ValidationError } from "kinetex";
import type { RequestConfig, KinetexResponse } from "kinetex";
import { z } from "zod";

const ReqresPersonSchema = z.object({
  id:         z.number().int().positive(),
  email:      z.string().email(),
  first_name: z.string().min(1),
  last_name:  z.string().min(1),
  avatar:     z.string().url(),
});

const ReqresUserSchema = z.object({
  data:    ReqresPersonSchema,
  support: z.object({ url: z.string().url(), text: z.string() }),
});

const ReqresUsersListSchema = z.object({
  page:        z.number().int().positive(),
  per_page:    z.number().int().positive(),
  total:       z.number().int().nonnegative(),
  total_pages: z.number().int().positive(),
  data:        z.array(ReqresPersonSchema),
  support:     z.object({ url: z.string().url(), text: z.string() }),
});

const GithubRepoSchema = z.object({
  id:                  z.number().int().positive(),
  name:                z.string().min(1),
  full_name:           z.string().min(1),
  description:         z.string().nullable(),
  html_url:            z.string().url(),
  stargazers_count:    z.number().int().nonnegative(),
  forks_count:         z.number().int().nonnegative(),
  open_issues_count:   z.number().int().nonnegative(),
  language:            z.string().nullable(),
  default_branch:      z.string(),
  topics:              z.array(z.string()),
  visibility:          z.string(),
});

type ResourceKey = "user" | "users" | "repo" | "fail";

const RESOURCES: Record<ResourceKey, { url: string; schema: z.ZodTypeAny; description: string }> = {
  user:  { url: "https://reqres.in/api/users/2",               schema: ReqresUserSchema,       description: "Single user from reqres.in with Zod wrapper schema" },
  users: { url: "https://reqres.in/api/users",                 schema: ReqresUsersListSchema,  description: "Paginated user list from reqres.in" },
  repo:  { url: "https://api.github.com/repos/denoland/deno",  schema: GithubRepoSchema,       description: "GitHub repo object — large real response" },
  fail:  { url: "https://httpbin.org/status/422",              schema: z.object({ ok: z.boolean() }), description: "422 from httpbin — exercises HTTPError path" },
};

let _api: ReturnType<typeof create> | null = null;

function getApi() {
  if (_api) return _api;
  _api = create({
    timeout: 10_000,
    retry:   { limit: 2, delay: (n: number) => 200 * 2 ** n },
    har:     true,
    headers: { "User-Agent": "kinetex-validator-worker/1.0.0" },
    hooks: {
      beforeRequest: [
        (config: RequestConfig) => ({
          ...config,
          headers: { ...(config.headers as Record<string, string>), "X-Correlation-ID": crypto.randomUUID().slice(0, 8), "X-Schema-Enforced": "true" },
        }),
      ],
      afterResponse: [
        (res: KinetexResponse<unknown>) => {
          console.log(JSON.stringify({ validated: true, status: res.status, durationMs: res.timing?.duration, url: res.request?.url }));
          return res;
        },
      ],
      onError: [
        (err: unknown) => {
          const e = err as { constructor: { name: string }; message: string; request?: { url?: string } };
          console.error(JSON.stringify({ errorType: e.constructor.name, message: e.message, url: e.request?.url ?? "unknown" }));
        },
      ],
    },
  });
  _api.use(auth.apiKey("demo-key-00000000", { header: "X-API-Key" }));
  return _api;
}

export async function handleValidator(request: Request, _env: Env): Promise<Response> {
  const url  = new URL(request.url);
  const path = url.pathname.replace(/^\/validate/, "");

  const api = getApi();

  if (path === "/har") {
    const har = api.exportHAR?.();
    return Response.json(har ?? { message: "No HAR entries yet — hit /validate?resource=user first" });
  }

  if (!path || path === "/") {
    const resource = url.searchParams.get("resource") as ResourceKey | null;

    if (!resource || !RESOURCES[resource]) {
      return Response.json({ error: "Missing or unknown ?resource=", supported: Object.keys(RESOURCES), examples: Object.entries(RESOURCES).map(([k, v]) => ({ resource: k, description: v.description, url: v.url })) }, { status: 400 });
    }

    const { url: upstreamUrl, schema, description } = RESOURCES[resource];

    try {
      const { data, status, timing, retries } = await api.chain(upstreamUrl).schema(schema).retry(2).timeout(8_000).as<unknown>();
      return Response.json({ ok: true, validated: true, resource, description, upstream: upstreamUrl, status, durationMs: timing?.duration, retries, data });
    } catch (err) {
      if (err instanceof ValidationError) {
        return Response.json({ ok: false, error: "Schema validation failed", resource, details: (err.validationError as { message?: string })?.message ?? String(err.validationError) }, { status: 422 });
      }
      if (err instanceof HTTPError) return Response.json({ ok: false, error: "Upstream HTTP error", resource, upstream: upstreamUrl, status: err.response?.status }, { status: err.response?.status ?? 502 });
      const e = err as Error;
      return Response.json({ ok: false, error: e.message }, { status: 500 });
    }
  }

  return Response.json({
    worker: "zod-validator",
    endpoints: {
      "/validate?resource=user":  "Single user from reqres.in — validated with Zod",
      "/validate?resource=users": "Paginated user list — validated with Zod",
      "/validate?resource=repo":  "GitHub repo object — validated with Zod",
      "/validate?resource=fail":  "422 from httpbin — exercises HTTPError path",
      "/validate/har":            "Export HAR trace of all requests made this isolate",
    },
  });
}
