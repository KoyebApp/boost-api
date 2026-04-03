/**
 * Worker 6 — GraphQL Proxy
 * kinetex graphqlPlugin · auth.oauth2() · SWR cache · Zod · HAR · interceptors
 */

import { create, auth, HTTPError, KinetexError } from "kinetex";
import type { Middleware, RequestConfig } from "kinetex";
import { graphqlPlugin } from "kinetex/plugins";
import { z } from "zod";

const GQL_ENDPOINT = "https://countries.trevorblades.com/graphql";

const CountrySchema = z.object({
  code: z.string(), name: z.string(), capital: z.string().nullable(), currency: z.string().nullable(), emoji: z.string(),
  continent: z.object({ name: z.string() }), languages: z.array(z.object({ name: z.string() })),
});
const CountriesResponseSchema    = z.object({ data: z.object({ countries: z.array(CountrySchema) }) });
const CountryByCodeResponseSchema = z.object({ data: z.object({ country: CountrySchema.nullable() }) });

const gqlLogger: Middleware = async (req, next) => {
  const start = Date.now();
  console.log(JSON.stringify({ phase: "gql-request", url: req.url, method: req.method }));
  const res = await next(req);
  console.log(JSON.stringify({ phase: "gql-response", status: res.status, durationMs: Date.now() - start }));
  return res;
};

const gqlErrorSurface: Middleware = async (req, next) => {
  const res = await next(req);
  if ((res.data as { errors?: unknown[] })?.errors?.length) console.warn(JSON.stringify({ gqlErrors: (res.data as { errors: unknown[] }).errors }));
  return res;
};

function countriesConfig(continent?: string) {
  return graphqlPlugin("/graphql", {
    query: `query ListCountries($continent: String) { countries(filter:{continent:{eq:$continent}}) { code name capital currency emoji continent{name} languages{name} } }`,
    variables: continent ? { continent } : {}, operationName: "ListCountries",
  });
}
function countryByCodeConfig(code: string) {
  return graphqlPlugin("/graphql", {
    query: `query GetCountry($code: ID!) { country(code:$code) { code name capital currency emoji continent{name} languages{name} } }`,
    variables: { code }, operationName: "GetCountry",
  });
}

function gqlError(err: unknown): Response {
  const e = err as Error;
  console.error(JSON.stringify({ errorType: e.constructor.name, message: e.message }));
  if (err instanceof HTTPError)    return Response.json({ ok: false, error: "Upstream HTTP error", status: err.response?.status }, { status: err.response?.status ?? 502 });
  if (err instanceof KinetexError) return Response.json({ ok: false, error: "kinetex error", message: e.message }, { status: 502 });
  return Response.json({ ok: false, error: e.message }, { status: 500 });
}

export async function handleGraphQL(request: Request, env: Env): Promise<Response> {
  const url  = new URL(request.url);
  const path = url.pathname.replace(/^\/graphql/, "");

  // ── kinetex client created INSIDE the handler ──────────────────────────
  const client = create({
    baseURL: GQL_ENDPOINT,
    timeout: { request: 20_000, response: 6_000 },
    retry:   { limit: 2, statusCodes: [429, 500, 503], methods: ["POST"], delay: (n: number) => 300 * 2 ** n },
    cache: {
      ttl: 60_000, swr: 120_000,
      key: (req: RequestConfig) => {
        try {
          const b  = typeof req.body === "string" ? JSON.parse(req.body) : (req.body as unknown as Record<string, unknown>);
          return `gql:${(b?.operationName as string) ?? "anon"}:${JSON.stringify(b?.variables ?? {})}`;
        } catch { return `gql:${req.url}`; }
      },
    },
    headers: { "Content-Type": "application/json", "X-GQL-Client": "kinetex-graphql-proxy/1.0.0" },
    har: true,
  });

  if (env.OAUTH2_TOKEN_URL && env.OAUTH2_CLIENT_ID) {
    client.extend(auth.oauth2({
      tokenUrl: env.OAUTH2_TOKEN_URL, clientId: env.OAUTH2_CLIENT_ID,
      clientSecret: env.OAUTH2_CLIENT_SECRET, scope: env.OAUTH2_SCOPE ?? "read",
      onToken: (token: { expires_in?: number }) => console.log("OAuth2 token refreshed, expires_in:", token.expires_in),
    }));
  }

  client.interceptors.request.use(async (config: RequestConfig) => ({
    ...config, headers: { ...(config.headers as Record<string, string>), "X-Trace-ID": crypto.randomUUID(), "X-Request-Time": new Date().toISOString() },
  }));
  client.interceptors.response.use((response) => {
    if ((response.data as { errors?: unknown[] })?.errors) console.warn(JSON.stringify({ gqlErrors: (response.data as { errors: unknown[] }).errors }));
    return response;
  });
  client.use(gqlLogger);
  client.use(gqlErrorSurface);

  if (path === "/countries") {
    const continent = url.searchParams.get("continent") ?? undefined;
    const config    = countriesConfig(continent);
    try {
      const { data, fromCache, timing } = await client.post(config.url, { ...config, schema: CountriesResponseSchema });
      type S = z.infer<typeof CountriesResponseSchema>;
      const typed = data as S | undefined;
      return Response.json({ ok: true, fromCache, durationMs: timing?.duration, count: typed?.data?.countries?.length ?? 0, continent: continent ?? "all", countries: typed?.data?.countries ?? [] });
    } catch (err) { return gqlError(err); }
  }

  const codeMatch = path.match(/^\/country\/([A-Z]{2,3})$/);
  if (codeMatch) {
    const config = countryByCodeConfig(codeMatch[1]!);
    try {
      const { data, fromCache, timing, retries } = await client.post(config.url, { ...config, schema: CountryByCodeResponseSchema });
      type S = z.infer<typeof CountryByCodeResponseSchema>;
      const country = (data as S | undefined)?.data?.country;
      if (!country) return Response.json({ ok: false, error: "Country not found", code: codeMatch[1] }, { status: 404 });
      return Response.json({ ok: true, fromCache, durationMs: timing?.duration, retries, country });
    } catch (err) { return gqlError(err); }
  }

  if (path === "/raw" && request.method === "POST") {
    let body: { query?: string; variables?: unknown; operationName?: string };
    try { body = await request.json() as typeof body; } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }
    if (!body.query) return Response.json({ error: "query is required" }, { status: 400 });
    const config = graphqlPlugin("/graphql", { query: body.query, variables: (body.variables ?? {}) as Record<string, unknown>, operationName: body.operationName ?? "RawQuery" });
    try {
      const { data, fromCache, timing } = await client.post(config.url, config);
      return Response.json({ ok: true, fromCache, durationMs: timing?.duration, ...(data as object) });
    } catch (err) { return gqlError(err); }
  }

  if (path === "/har") {
    const har = client.exportHAR?.();
    return Response.json(har ?? { message: "No HAR entries yet" });
  }

  return Response.json({ worker: "graphql-proxy", upstream: GQL_ENDPOINT, endpoints: { "/graphql/countries": "List all countries", "/graphql/countries?continent=EU": "Filter by continent", "/graphql/country/US": "Single country by ISO code", "/graphql/raw (POST)": "Pass-through GQL query", "/graphql/har": "HAR trace" } });
}
