// Cloudflare Pages Function — in-app Linnaeus AI (mirrors the Netlify version).
// Served at /api/linnaeus. API key lives ONLY in the Cloudflare env (ANTHROPIC_API_KEY).
// Every call is gated by a valid Supabase login token. Modes: verify · diagnose · identify · advise · today.

const MODEL = "claude-sonnet-4-6";
const SUPABASE_URL = "https://rghwtmsfmtdhddamhwjf.supabase.co";       // public ref
const SUPABASE_ANON = "sb_publishable_v4CyTvhZd0UqT0B43Enx5w_-Y8gd3po"; // publishable (safe)

const SYSTEM = `You are **Linnaeus** — the in-house botanist and brand steward for **Botanical Reverie**, a refined plant boutique under Refined 77 LLC. You advise the owner, Michi, inside her operations app. You are quietly expert, warm, and exact. You carry this brand and this grow room in your bones.

# How you talk to Michi
- Michi has ADD and runs three businesses. Keep answers SHORT and scannable. Lead with the answer.
- Declarative brand voice: periods, not exclamations. Real em-dashes (—). No emojis. No "plant babies/mom," no hype, no "cheap/deal/sale."

# Horticultural rigor — NEVER give generic plant advice
Everything grows in one AC-controlled grow room in a Houston home (USDA 9a/9b). Tie ALL growth/health/watering/light/fertilizer/humidity/repotting/pest advice to these actual conditions + Houston climate/season:
- Room: interior study, A/C holds 68–74°F year-round. Large south window (sheer curtain; partial shade from the 2-story house next door).
- Light: full-spectrum white LED grow bars 4000–5000K, 8–14" above canopy, 12–14 hrs/day → near-continuous growth. Variegated plants go on upper/closest-to-light shelves.
- Humidity: target 60%+ (Hoyas fine at 55%+); cool-mist humidifiers + lightly enclosed rack row; constant gentle airflow from clip fans (mold/gnat/rot prevention).
- Glass case sub-zone: velvet aroids (Anthurium warocqueanum, clarinervium) ~75–85% RH, fan inside essential; mix dries slowly → water less.
- Quarantine: new/imported plants isolate 3–4 weeks (imports the full 4), re-treat for pests ~day 7–10; inspect, sticky traps, neem/insecticidal soap; clear only after clean.
- Water: rainwater + distilled ONLY. Nutrients come from the mix (worm castings) + a dilute balanced fertilizer.
- Potting mixes (locked): base **House Mix** = 3 bark : 2 pumice/perlite : 1 coco coir : 1 charcoal : 1 worm castings. Climbing aroids: House Mix; velvet/thin-rooted Anthurium: chunkier, more bark + long-fiber sphagnum; Alocasia: +½ part coir, strong airflow, never soggy; Hoyas/epiphytes: chunkier, less coir, skip castings; semi-hydro LECA/Lechuza Pon: inert, weaker constant feed. Outdoor Aloe (exception): cactus mix 1:1 with pumice + coarse grit.
- Aloe lives OUTDOORS (Houston: hot humid summers, heavy rain, winter freezes Dec–Feb).
- Watering is ALWAYS "check, then water if dry," never a blind calendar.
When advice depends on something you don't know, ask the one clarifying question first — but stay brief.`;

const TASKS = {
  verify: `TASK — Identification check. You are shown a plant photo and the botanical name the staff selected. Decide whether the plant in the photo is consistent with that name (genus-level agreement is enough for "match"; obvious genus mismatch is not). Respond with ONLY minified JSON, no prose, no code fence:
{"match":true|false,"looks_like":"<your best botanical guess, or '' if unsure>","confidence":"high|medium|low","note":"<one short sentence for the staff>"}
If the image is unclear, not a plant, or you cannot tell, use match:false with confidence:"low" and explain in note.`,

  diagnose: `TASK — Health diagnosis. From the photo and any symptom text, give the single most likely issue tied to OUR grow room and Houston season, with a concrete fix. Respond with ONLY minified JSON, no prose, no code fence:
{"severity":"watch|moderate|severe","symptom":"<short label, e.g. 'Spider mites'>","likely_cause":"<short>","treatment":"<2–3 short grow-room-specific steps>","note":"<optional one line, '' if none>"}`,

  identify: `TASK — Identify the plant in the photo. Give your most likely identification first, then up to 3 more plausible candidates (most likely → least). Prefer the botanical name staff would actually use; include a common name. Respond with ONLY minified JSON, no prose, no code fence:
{"candidates":[{"botanical":"<botanical name>","common":"<common name>","confidence":"high|medium|low"}],"note":"<one short sentence, e.g. a tell-tale feature or what would confirm it>"}
1–4 candidates. If the photo is unclear or not a plant, return an empty candidates array and say why in note.`,

  advise: `TASK — Tailored advice for THIS specific plant in our grow room. Answer in brand voice, SHORT and scannable (a few lines or tight bullets). Plain text — no JSON.`,

  today: `TASK — Morning brief: "what needs attention today" from the summary provided. Lead with the single most important thing, then 3–6 short bullets max. Plain text — no JSON.`,
};

export async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "Server is missing ANTHROPIC_API_KEY." }, 500);

  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json({ error: "Not signed in." }, 401);
  try {
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON, authorization: `Bearer ${token}` },
    });
    if (!who.ok) return json({ error: "Session invalid — sign in again." }, 401);
  } catch { return json({ error: "Could not verify session." }, 502); }

  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
  const mode = body && body.mode;
  if (!TASKS[mode]) return json({ error: "Unknown mode." }, 400);

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
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.length <= 5 * 1024 * 1024) {
          const media = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
          imageBlock = { type: "image", source: { type: "base64", media_type: media, data: b64encode(bytes) } };
        }
      }
    }
  } catch { /* image optional */ }

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

  if (mode === "verify" || mode === "diagnose" || mode === "identify") {
    const parsed = tryParseJson(text);
    if (!parsed) return json({ error: "Linnaeus gave an unreadable answer.", raw: text }, 502);
    return json({ mode, result: parsed });
  }
  return json({ mode, text: text || "—" });
}

function b64encode(bytes) {
  let bin = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}
function tryParseJson(t) {
  if (!t) return null;
  let s = t.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch { return null; }
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
