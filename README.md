# kinetex-workers

Six production-ready Cloudflare Workers showcasing **kinetex v0.0.2** — the universal HTTP client for the modern JavaScript ecosystem.

| Worker | Path prefix | Key features |
|---|---|---|
| API Gateway | `/gateway/*` | `undici` transport · `auth.bearer()` · retry · `concurrencyLimit` · `rateLimit` · structured logging |
| Zod Validator | `/validate/*` | `schema: ZodSchema` · fluent chain · `auth.apiKey()` · HAR recording |
| Valibot Forms | `/forms/*` | `schema: ValibotSchema` · `cookieJar` · custom middleware · JSON + FormData |
| Proxy Fetcher | `/proxy/*` | `proxyMiddleware` · `envProxy` · SOCKS5 · `auth.digest()` · `responseSizeLimit` |
| SSE Relay | `/stream/*` | `sse()` async generator · auto-reconnect · multi-source aggregator · `undici` |
| GraphQL Proxy | `/graphql/*` | `graphqlPlugin` · `auth.oauth2()` · SWR cache · Zod · HAR |

**Stack:** `kinetex@0.0.2` · `undici@7.24.6` · `zod@4.3.6` · `valibot@1.3.1` · `socks-proxy-agent@10.0.0` · `wrangler@4.80.0`

**Kinetex Docs:** https://kinetexjs.github.io/kinetex/

**Links**:
- https://kinetex-api-gateway.gtech-apiz.workers.dev
-
- https://kinetex-zod-validator.gtech-apiz.workers.dev
-
- https://kinetex-valibot-forms.gtech-apiz.workers.dev
-
- https://kinetex-proxy-fetcher.gtech-apiz.workers.dev
-
- https://kinetex-sse-relay.gtech-apiz.workers.dev
-
- https://kinetex-graphql-proxy.gtech-apiz.workers.dev
-
- https://kinetex-misc-features.gtech-apiz.workers.dev


**Endpoints**:

**Worker 1 — API Gateway**
- https://kinetex-api-gateway.gtech-apiz.workers.dev/gateway/zen
-
- https://kinetex-api-gateway.gtech-apiz.workers.dev/gateway/users
-
- https://kinetex-api-gateway.gtech-apiz.workers.dev/gateway/repos
-
- https://kinetex-api-gateway.gtech-apiz.workers.dev/gateway/retry
-
- https://kinetex-api-gateway.gtech-apiz.workers.dev/gateway/slow

**Worker 2 — Zod Validator**
- https://kinetex-zod-validator.gtech-apiz.workers.dev/validate?resource=user
-
- https://kinetex-zod-validator.gtech-apiz.workers.dev/validate?resource=users
-
- https://kinetex-zod-validator.gtech-apiz.workers.dev/validate?resource=repo
-
- https://kinetex-zod-validator.gtech-apiz.workers.dev/validate?resource=fail
-
- https://kinetex-zod-validator.gtech-apiz.workers.dev/validate/har

**Worker 3 — Valibot Forms (POST only — paste in browser gives schema info)**
- https://kinetex-valibot-forms.gtech-apiz.workers.dev/forms/schema/contact
-
- https://kinetex-valibot-forms.gtech-apiz.workers.dev/forms/schema/newsletter
-
- https://kinetex-valibot-forms.gtech-apiz.workers.dev/forms/schema/feedback
**[Worker 4 — Proxy Fetcher**
- https://kinetex-proxy-fetcher.gtech-apiz.workers.dev/proxy/profiles
-
- https://kinetex-proxy-fetcher.gtech-apiz.workers.dev/proxy/har

**Worker 5 — SSE Relay (streaming — browser will show live events)**
- https://kinetex-sse-relay.gtech-apiz.workers.dev/stream/info
-
- https://kinetex-sse-relay.gtech-apiz.workers.dev/stream/relay
-
- https://kinetex-sse-relay.gtech-apiz.workers.dev/stream/relay?source=secondary
-
- https://kinetex-sse-relay.gtech-apiz.workers.dev/stream/aggregate

**Worker 6 — GraphQL Proxy**
- https://kinetex-graphql-proxy.gtech-apiz.workers.dev/graphql/countries
-
- https://kinetex-graphql-proxy.gtech-apiz.workers.dev/graphql/countries?continent=EU
-
- https://kinetex-graphql-proxy.gtech-apiz.workers.dev/graphql/countries?continent=AS
-
- https://kinetex-graphql-proxy.gtech-apiz.workers.dev/graphql/country/US
-
- https://kinetex-graphql-proxy.gtech-apiz.workers.dev/graphql/country/DE
-
- https://kinetex-graphql-proxy.gtech-apiz.workers.dev/graphql/country/JP
-
- https://kinetex-graphql-proxy.gtech-apiz.workers.dev/graphql/har

**Worker 7 — Misc Features**
- https://kinetex-misc-features.gtech-apiz.workers.dev/misc/compose
-
- https://kinetex-misc-features.gtech-apiz.workers.dev/misc/basic-auth
-
- https://kinetex-misc-features.gtech-apiz.workers.dev/misc/aws-sigv4
-
- https://kinetex-misc-features.gtech-apiz.workers.dev/misc/callback
-
- https://kinetex-misc-features.gtech-apiz.workers.dev/misc/cancel-all
-
- https://kinetex-misc-features.gtech-apiz.workers.dev/misc/cancel-chain
-
- https://kinetex-misc-features.gtech-apiz.workers.dev/misc/redirects
-
- https://kinetex-misc-features.gtech-apiz.workers.dev/misc/decompress
-
- https://kinetex-misc-features.gtech-apiz.workers.dev/misc/response-types
-
- https://kinetex-misc-features.gtech-apiz.workers.dev/misc/throw-http-errors
-
- https://kinetex-misc-features.gtech-apiz.workers.dev/misc/sub-instance
-
- https://kinetex-misc-features.gtech-apiz.workers.dev/misc/extend


> /gateway/retry will return a 503 with retries: 3 — that's expected, it proves the retry exhaustion working. /gateway/slow takes ~3s by design.
