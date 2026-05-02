/**
 * glp1.cl — Cloudflare Worker
 *
 * Sirve los assets estáticos de /public y maneja /api/lead para capturar
 * leads del quiz, escribirlos en Notion y notificar por email vía Resend.
 *
 * Secrets requeridos (Cloudflare → Workers → Settings → Variables and Secrets):
 *   - NOTION_TOKEN          → Internal Integration token (https://www.notion.so/profile/integrations)
 *   - NOTION_DATABASE_ID    → 350d43f959a74023bf1531bfd8cdef22 (DB "GLP1 — Leads")
 *   - RESEND_API_KEY        → API key de https://resend.com (plan free: 100 emails/día)
 *   - NOTIFY_EMAIL          → diegonavarrete.j@gmail.com (destino de la notificación)
 *   - NOTIFY_FROM           → "GLP1 Leads <leads@glp1.cl>" (mientras no se verifique dominio,
 *                              usar "onboarding@resend.dev")
 */

const ALLOWED_ORIGINS = new Set([
  "https://glp1.cl",
  "https://www.glp1.cl",
  "https://glp1-cl.diegonavarrete-j.workers.dev",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
]);

const VALID_OBJETIVOS = new Set([
  "Bajar 5–10 kg",
  "Bajar 10–20 kg",
  "Bajar más de 20 kg",
  "Mejorar salud metabólica",
]);

const VALID_CONDICIONES = new Set([
  "Diabetes 2 / Resistencia insulina",
  "Hipertensión / Colesterol",
  "Hígado graso",
  "Ninguna",
]);

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

// dominios desechables — bloqueamos los más usados por scrapers
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "10minutemail.com", "guerrillamail.com", "tempmail.com", "yopmail.com",
  "throwaway.email", "fakemail.net", "getairmail.com", "sharklasers.com", "dispostable.com",
  "maildrop.cc", "tempmailo.com", "mintemail.com", "trashmail.com", "mailnesia.com",
  "tempr.email", "spam4.me", "mvrht.net", "mt2014.com", "mailinator2.com",
  "33mail.com", "emailondeck.com", "fakeinbox.com", "guerrillamailblock.com", "mohmal.com"
]);

const MIN_FILL_MS = 2000; // un humano no completa el form en menos de 2s

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- CORS preflight ---------------------------------------------------
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // --- API: lead capture -----------------------------------------------
    if (url.pathname === "/api/lead" && request.method === "POST") {
      return handleLead(request, env, ctx);
    }

    // --- Healthcheck ------------------------------------------------------
    if (url.pathname === "/api/health") {
      return json(
        {
          ok: true,
          ts: new Date().toISOString(),
          notion: Boolean(env.NOTION_TOKEN && env.NOTION_DATABASE_ID),
          email: Boolean(env.RESEND_API_KEY && env.NOTIFY_EMAIL),
        },
        request,
      );
    }

    // --- Static assets ---------------------------------------------------
    // env.ASSETS is bound automatically when "assets" is configured in wrangler.jsonc
    return env.ASSETS.fetch(request);
  },
};

async function handleLead(request, env, ctx) {
  // 1. parse + validate payload
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, request, 400);
  }

  // === capa anti-spam ===
  // honeypot: si viene relleno, fingimos éxito y descartamos silenciosamente
  const honeypot = (body && body._meta && typeof body._meta.honeypot === "string") ? body._meta.honeypot : "";
  if (honeypot && honeypot.trim().length > 0) {
    return json({ ok: true, imc: 0, categoriaIMC: "" }, request); // bot no se entera
  }

  // tiempo mínimo en form — bots envían en milisegundos
  const elapsedMs = (body && body._meta && typeof body._meta.elapsed_ms === "number") ? body._meta.elapsed_ms : 0;
  if (elapsedMs && elapsedMs < MIN_FILL_MS) {
    return json({ ok: false, error: "too_fast" }, request, 400);
  }

  // === validaciones de datos ===
  const peso = num(body.peso);
  const estatura = num(body.estatura);
  if (!peso || !estatura || peso < 40 || peso > 250 || estatura < 120 || estatura > 220) {
    return json({ ok: false, error: "invalid_metrics" }, request, 400);
  }

  const imc = +(peso / Math.pow(estatura / 100, 2)).toFixed(1);
  const categoriaIMC = clasificarIMC(imc);

  const objetivo = VALID_OBJETIVOS.has(body.objetivo) ? body.objetivo : null;
  const condiciones = VALID_CONDICIONES.has(body.condiciones) ? body.condiciones : null;

  const nombre = clean(body.nombre, 80);
  const email = clean(body.email, 120).toLowerCase();
  const telefonoRaw = clean(body.telefono, 30);
  const notas = clean(body.notas, 1000);
  const userAgent = clean(request.headers.get("user-agent") || "", 240);

  // nombre: requerido, al menos un espacio (nombre + apellido), sin URLs
  if (!nombre || nombre.length < 3 || !/\s/.test(nombre) || /https?:\/\/|www\./i.test(nombre)) {
    return json({ ok: false, error: "invalid_name" }, request, 400);
  }

  // email: regex + bloqueo de dominios desechables
  if (!EMAIL_RE.test(email)) {
    return json({ ok: false, error: "invalid_email" }, request, 400);
  }
  const emailDomain = email.split("@")[1];
  if (DISPOSABLE_DOMAINS.has(emailDomain)) {
    return json({ ok: false, error: "disposable_email" }, request, 400);
  }

  // teléfono: aceptamos solo celulares chilenos. Normalizamos a +569 + 8 dígitos.
  const telefono = normalizeChileMobile(telefonoRaw);
  if (!telefono) {
    return json({ ok: false, error: "invalid_phone" }, request, 400);
  }

  // 2. fan-out: Notion + Resend en paralelo, no bloquea respuesta al usuario
  const tasks = [];

  if (env.NOTION_TOKEN && env.NOTION_DATABASE_ID) {
    tasks.push(
      sendToNotion(env, {
        nombre,
        email,
        telefono,
        peso,
        estatura,
        imc,
        categoriaIMC,
        objetivo,
        condiciones,
        notas,
        userAgent,
      }).catch((err) => ({ source: "notion", error: String(err) })),
    );
  }

  if (env.RESEND_API_KEY && env.NOTIFY_EMAIL) {
    tasks.push(
      sendNotifyEmail(env, {
        nombre,
        email,
        telefono,
        peso,
        estatura,
        imc,
        categoriaIMC,
        objetivo,
        condiciones,
      }).catch((err) => ({ source: "resend", error: String(err) })),
    );
  }

  const results = await Promise.all(tasks);
  const errors = results.filter((r) => r && r.error);
  if (errors.length) {
    console.error("lead_partial_failure", JSON.stringify(errors));
  }

  return json({ ok: true, imc, categoriaIMC }, request);
}

// --- Notion ----------------------------------------------------------------

async function sendToNotion(env, lead) {
  const properties = {
    Nombre: {
      title: [{ text: { content: lead.nombre || lead.email || "Lead anónimo" } }],
    },
    "Peso (kg)": { number: lead.peso },
    "Estatura (cm)": { number: lead.estatura },
    IMC: { number: lead.imc },
    "Categoría IMC": { select: { name: lead.categoriaIMC } },
    Origen: { select: { name: "Landing quiz" } },
    "User Agent": { rich_text: [{ text: { content: lead.userAgent || "" } }] },
  };

  if (lead.email) properties.Email = { email: lead.email };
  if (lead.telefono) properties["Teléfono"] = { phone_number: lead.telefono };
  if (lead.objetivo) properties.Objetivo = { select: { name: lead.objetivo } };
  if (lead.condiciones) properties.Condiciones = { select: { name: lead.condiciones } };
  if (lead.notas) properties.Notas = { rich_text: [{ text: { content: lead.notas } }] };

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { database_id: env.NOTION_DATABASE_ID },
      properties,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`notion_${res.status}: ${text.slice(0, 300)}`);
  }
  return { source: "notion", ok: true };
}

// --- Resend ----------------------------------------------------------------

async function sendNotifyEmail(env, lead) {
  const from = env.NOTIFY_FROM || "GLP1 Leads <onboarding@resend.dev>";
  const subject = `🩺 Nuevo lead glp1.cl — ${lead.nombre || lead.email || "anónimo"} (IMC ${lead.imc})`;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;color:#1a1a1a">
      <h2 style="margin:0 0 8px">Nuevo lead — ${escapeHtml(lead.categoriaIMC)}</h2>
      <p style="color:#666;margin:0 0 16px">Origen: Landing quiz · ${new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" })}</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <tr><td style="padding:6px 0;color:#666">Nombre</td><td style="padding:6px 0"><b>${escapeHtml(lead.nombre || "—")}</b></td></tr>
        <tr><td style="padding:6px 0;color:#666">Email</td><td style="padding:6px 0">${escapeHtml(lead.email || "—")}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Teléfono</td><td style="padding:6px 0">${escapeHtml(lead.telefono || "—")}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Peso / Estatura</td><td style="padding:6px 0">${lead.peso} kg · ${lead.estatura} cm</td></tr>
        <tr><td style="padding:6px 0;color:#666">IMC</td><td style="padding:6px 0"><b>${lead.imc}</b> — ${escapeHtml(lead.categoriaIMC)}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Objetivo</td><td style="padding:6px 0">${escapeHtml(lead.objetivo || "—")}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Condiciones</td><td style="padding:6px 0">${escapeHtml(lead.condiciones || "—")}</td></tr>
      </table>
      <p style="color:#999;font-size:12px;margin-top:24px">Este lead también quedó guardado en Notion.</p>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [env.NOTIFY_EMAIL],
      subject,
      html,
      reply_to: lead.email || undefined,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`resend_${res.status}: ${text.slice(0, 300)}`);
  }
  return { source: "resend", ok: true };
}

// --- helpers ---------------------------------------------------------------

function clasificarIMC(imc) {
  if (imc >= 30) return "Excelente candidato";
  if (imc >= 27) return "Probable candidato";
  if (imc >= 25) return "Evaluación recomendada";
  return "No es candidato";
}

/**
 * Normaliza un teléfono a formato chileno celular E.164: "+569XXXXXXXX".
 * Acepta entradas como:
 *   "+56 9 1234 5678", "569 1234 5678", "9 1234 5678", "12345678", "1234 5678"
 * Devuelve null si no se puede normalizar a un celular chileno válido.
 */
function normalizeChileMobile(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;

  let local; // 8 dígitos del celular sin prefijo de país ni el 9
  if (digits.length === 11 && digits.startsWith("569")) {
    local = digits.slice(3);
  } else if (digits.length === 9 && digits.startsWith("9")) {
    local = digits.slice(1);
  } else if (digits.length === 8) {
    local = digits;
  } else {
    return null;
  }

  if (local.length !== 8) return null;
  // primer dígito no puede ser 0 (no hay celulares chilenos así)
  if (local[0] === "0") return null;

  return "+569" + local;
}

function num(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function clean(v, maxLen) {
  if (v == null) return "";
  return String(v).trim().slice(0, maxLen);
}

function corsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://glp1.cl";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(payload, request, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request),
    },
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
