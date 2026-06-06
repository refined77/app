// Netlify Function (v2) — in-app Linnaeus AI for the Operations App.
// The API key lives ONLY here (env). Every call is gated by a valid Supabase login token,
// so only signed-in staff (Michi/Laura) can spend the API budget.
// Modes: verify (photo vs name) · diagnose (photo→issue) · advise (per-plant) · today (brief).

import { SYSTEM, TASKS } from "./linnaeus-prompt.mjs";

const MODEL = "claude-sonnet-4-6";
const SUPABASE_URL = "https://rghwtmsfmtdhddamhwjf.supabase.co";       // public ref
const SUPABASE_ANON = "sb_publishable_v4CyTvhZd0UqT0B43Enx5w_-Y8gd3po"; // publishable (safe)

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "Server is missing ANTHROPIC_API_KEY." }, 500);

  // --- Login gate: validate the caller's Supabase access token ---
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json({ error: "Not signed in." }, 401);
  try {
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON, authorization: `Bearer ${token}` },
    });
    if (!who.ok) return json({ error: "Session invalid — sign in again." }, 401);
  } catch {
    return json({ error: "Could not verify session." }, 502);
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }

  const mode = body && body.mode;
  if (!TASKS[mode]) return json({ error: "Unknown mode." }, 400);

  // --- Build the image block (from base64 or by fetching a URL) ---
  let imageBlock = null;
  try {
    if (body.image_b64) {
      let data = body.image_b64, media = body.media_type || "image/jpeg";
      const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(data);
      if (m) { media = m[1]; data = m[2]; }
      imageBlock = { type: "image", source: { type: "base64", media_type: media, data } };
    } else if (body.image_url) {
      const r = await fetch(body.image_url);
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length <= 5 * 1024 * 1024) {
          const media = r.headers.get("content-type") || "image/jpeg";
          imageBlock = { type: "image", source: { type: "base64", media_type: media.split(";")[0], data: buf.toString("base64") } };
        }
      }
    }
  } catch { /* image optional — proceed without it */ }

  // --- Compose the user turn ---
  const p = body.plant || {};
  const ctx = [];
  if (p.unique_name) ctx.push(`Our name: ${p.unique_name}`);
  if (p.botanical_name) ctx.push(`Botanical name (staff-selected): ${p.botanical_name}`);
  if (p.common_name) ctx.push(`Common name: ${p.common_name}`);
  if (p.cultivar) ctx.push(`Cultivar: ${p.cultivar}`);
  if (p.location_zone) ctx.push(`Location/zone: ${p.location_zone}`);
  if (p.status) ctx.push(`Status: ${p.status}`);
  if (p.condition_at_intake) ctx.push(`Condition at intake: ${p.condition_at_intake}`);
  if (p.date_entered) ctx.push(`Entered: ${p.date_entered}`);

  const parts = [];
  if (mode === "verify" && body.botanical_name) parts.push(`Name the staff selected: ${body.botanical_name}${body.common_name ? ` (${body.common_name})` : ""}.`);
  if (ctx.length) parts.push("Plant context:\n" + ctx.join("\n"));
  if (body.symptom) parts.push(`Symptom the staff noted: ${body.symptom}`);
  if (body.question) parts.push(`Question: ${body.question}`);
  if (body.summary) parts.push(`Today's snapshot:\n${String(body.summary).slice(0, 6000)}`);
  if (!parts.length) parts.push("(No extra context provided.)");

  const content = [{ type: "text", text: parts.join("\n\n") }];
  if (imageBlock) content.push(imageBlock);

  const maxTokens = (mode === "advise" || mode === "today") ? 700 : 400;

  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system: [
          { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
          { type: "text", text: TASKS[mode] },
        ],
        messages: [{ role: "user", content }],
      }),
    });
  } catch { return json({ error: "Could not reach Linnaeus." }, 502); }

  const raw = await upstream.text();
  let data; try { data = JSON.parse(raw); } catch { data = null; }
  if (!upstream.ok) {
    return json({ error: "Linnaeus API error.", status: upstream.status, detail: (data && data.error && data.error.message) || (raw ? raw.slice(0, 300) : "(empty response)") }, upstream.status || 502);
  }

  const text = (data && Array.isArray(data.content))
    ? data.content.filter((b) => b && b.type === "text").map((b) => b.text).join("").trim()
    : "";

  // verify/diagnose → structured JSON; advise/today → prose
  if (mode === "verify" || mode === "diagnose" || mode === "identify") {
    const parsed = tryParseJson(text);
    if (!parsed) return json({ error: "Linnaeus gave an unreadable answer.", raw: text }, 502);
    return json({ mode, result: parsed });
  }
  return json({ mode, text: text || "—" });
};

function tryParseJson(t) {
  if (!t) return null;
  let s = t.trim().replace(/^```(?:json)?/i, "").replace(/```$/,"").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch { return null; }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
