/**
 * Worker 3 — Valibot Form Gateway
 * kinetex + Valibot v1 · Cookie jar · Custom middleware · JSON + FormData
 *
 * Validates forms with Valibot, then POSTs the clean payload to
 * https://httpbin.org/post — a real endpoint that echoes the body back
 * as JSON, proving kinetex actually delivered the request over the wire.
 */

import { create, ValidationError } from "kinetex";
import type { Middleware } from "kinetex";
import { cookieJar, withCookies } from "kinetex/plugins";
import * as v from "valibot";

const ContactSchema = v.object({
  name:    v.pipe(v.string(), v.minLength(2), v.maxLength(100)),
  email:   v.pipe(v.string(), v.email()),
  subject: v.pipe(v.string(), v.minLength(5), v.maxLength(200)),
  message: v.pipe(v.string(), v.minLength(20), v.maxLength(5000)),
  website: v.optional(v.pipe(v.string(), v.url())),
});
const NewsletterSchema = v.object({
  email:        v.pipe(v.string(), v.email()),
  name:         v.optional(v.pipe(v.string(), v.minLength(1))),
  lists:        v.array(v.picklist(["weekly-digest", "product-updates", "security-alerts"])),
  gdpr_consent: v.literal(true),
});
const FeedbackSchema = v.object({
  rating:    v.pipe(v.number(), v.minValue(1), v.maxValue(5)),
  category:  v.picklist(["bug", "feature-request", "ux", "performance", "other"]),
  comment:   v.optional(v.pipe(v.string(), v.maxLength(1000))),
  anonymous: v.optional(v.boolean()),
});

type FormName = "contact" | "newsletter" | "feedback";
const FORMS: Record<FormName, { schema: v.GenericSchema; description: string }> = {
  contact:    { schema: ContactSchema,    description: "Contact form submission" },
  newsletter: { schema: NewsletterSchema, description: "Newsletter signup with GDPR consent" },
  feedback:   { schema: FeedbackSchema,   description: "Product feedback (rating 1–5)" },
};

function validate<T extends v.GenericSchema>(schema: T, data: unknown) {
  const result = v.safeParse(schema, data);
  if (!result.success) return { ok: false as const, issues: v.flatten(result.issues) };
  return { ok: true as const, output: result.output };
}

const honeypotMiddleware: Middleware = async (req, next) => {
  if (req.body && typeof req.body === "string") {
    try {
      const parsed = JSON.parse(req.body) as Record<string, unknown>;
      const { website_url: _h1, hp_email: _h2, ...clean } = parsed;
      return next({ ...req, body: JSON.stringify(clean) });
    } catch {
      // not JSON — pass through
    }
  }
  return next(req);
};

export async function handleForms(request: Request, _env: Env): Promise<Response> {
  const url  = new URL(request.url);
  const path = url.pathname.replace(/^\/forms/, "");

  // ── All kinetex instances created INSIDE the handler ──────────────────────
  const jar = cookieJar();
  const api = create({
    timeout: 12_000,
    retry:   { limit: 2, statusCodes: [429, 500, 503], delay: (n: number) => 300 * 2 ** n },
    headers: { "X-Client": "kinetex-form-worker/1.0.0", "X-Powered-By": "kinetex + valibot", "User-Agent": "kinetex-form-worker/1.0.0" },
  })
    .use(withCookies(jar))
    .use(honeypotMiddleware);

  if (!path || path === "/") {
    return Response.json({
      worker: "valibot-forms",
      upstream: "https://httpbin.org/post — echoes payload, proves real delivery",
      forms: Object.entries(FORMS).map(([name, cfg]) => ({
        name, description: cfg.description,
        submit: `POST /forms/submit/${name}`,
        schema: `GET /forms/schema/${name}`,
      })),
    });
  }

  const schemaMatch = path.match(/^\/schema\/([a-z_-]+)$/);
  if (schemaMatch && request.method === "GET") {
    const formName = schemaMatch[1] as FormName;
    const form     = FORMS[formName];
    if (!form) return Response.json({ error: "Unknown form" }, { status: 404 });
    return Response.json({
      form: formName, description: form.description,
      fields: Object.keys((form.schema as v.ObjectSchema<v.ObjectEntries, undefined>).entries ?? {}),
    });
  }

  const submitMatch = path.match(/^\/submit\/([a-z_-]+)$/);
  if (submitMatch && request.method === "POST") {
    const formName = submitMatch[1] as FormName;
    const form     = FORMS[formName];
    if (!form) return Response.json({ error: "Unknown form", available: Object.keys(FORMS) }, { status: 404 });

    let body: Record<string, unknown>;
    try {
      const ct = request.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        body = await request.json() as Record<string, unknown>;
      } else {
        const fd = await request.formData();
        body = Object.fromEntries(fd.entries());
        if (formName === "feedback" && body["rating"])         body["rating"]       = Number(body["rating"]);
        if (formName === "feedback" && body["anonymous"])      body["anonymous"]    = body["anonymous"] === "true";
        if (formName === "newsletter" && body["gdpr_consent"]) body["gdpr_consent"] = body["gdpr_consent"] === "true";
        if (formName === "newsletter" && body["lists"])        body["lists"]        = Array.isArray(body["lists"]) ? body["lists"] : [body["lists"]];
      }
    } catch {
      return Response.json({ error: "Could not parse request body" }, { status: 400 });
    }

    const result = validate(form.schema, body);
    if (!result.ok) return Response.json({ ok: false, error: "Validation failed", form: formName, issues: result.issues }, { status: 422 });

    const payload: Record<string, unknown> = {
      ...(result.output as Record<string, unknown>),
      _form: formName,
      _at:   new Date().toISOString(),
    };

    try {
      // POST to httpbin.org/post — it echoes the entire request body back as JSON,
      // confirming kinetex actually sent the payload over the network.
      const res = await api.post("https://httpbin.org/post", {
        json:            payload,
        throwHttpErrors: false,
        dedupe:          false,
      });
      type HttpbinPost = { json?: unknown; url?: string; headers?: Record<string, string> };
      const echo = (res.data as HttpbinPost)?.json;
      return Response.json({
        ok:           true,
        form:         formName,
        submissionId: crypto.randomUUID().slice(0, 8),
        message:      "Form submitted successfully — echoed back by httpbin.org/post",
        upstream:     "https://httpbin.org/post",
        httpStatus:   res.status,
        echo,
        timing:       res.timing,
      }, { status: 201 });
    } catch (err) {
      if (err instanceof ValidationError) return Response.json({ ok: false, error: "Upstream response validation failed" }, { status: 502 });
      const e = err as Error;
      return Response.json({ ok: false, error: e.message }, { status: 502 });
    }
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}
