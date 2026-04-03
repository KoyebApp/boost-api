// Auto-synced with wrangler.json [vars] — all values are present at runtime.
// Demo tokens are baked into wrangler.json vars. For production swap them
// for real wrangler secrets without touching any code.

declare interface Env {
  // ── URLs ──────────────────────────────────────────────────────────────────
  UPSTREAM_BASE_URL:    string;  // https://jsonplaceholder.typicode.com
  CORPORATE_PROXY_URL:  string;  // http://proxy.corp.internal:3128
  SOCKS5_PROXY_URL:     string;  // socks5://127.0.0.1:1080

  // ── Demo tokens (baked into wrangler.json vars) ───────────────────────────
  /** Bearer token forwarded by the API Gateway. Demo value: "demo-api-token-kinetex" */
  API_TOKEN:    string;
  /** Bearer token used by the SSE Relay. Demo value: "demo-sse-token-kinetex" */
  SSE_TOKEN:    string;
  /** Corporate proxy username. Demo value: "demo-proxy-user" */
  PROXY_USER:   string;
  /** Corporate proxy password. Demo value: "demo-proxy-pass" */
  PROXY_PASS:   string;
  /** Digest auth username. Demo value: "demo-digest-user" */
  DIGEST_USER:  string;
  /** Digest auth password. Demo value: "demo-digest-pass" */
  DIGEST_PASS:  string;

  // ── OAuth2 (graphql-proxy worker — empty strings = feature disabled) ───────
  OAUTH2_TOKEN_URL:     string;
  OAUTH2_SCOPE:         string;
  OAUTH2_CLIENT_ID:     string;
  OAUTH2_CLIENT_SECRET: string;
}
