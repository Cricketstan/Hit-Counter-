export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // CORS
    const origin = request.headers.get("Origin") || "*";
    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    // Block bots
    const ua = (request.headers.get("User-Agent") || "").slice(0, 200);
    if (!ua || /bot|crawl|spider|preview|fetch|monitor|facebookexternalhit|curl|wget|headless/i.test(ua)) {
      return json({ error: "blocked_bot" }, origin, 403);
    }

    const keyParam = (url.searchParams.get("key") || "").trim();
    const key = keyParam || inferKeyFromPath(url.pathname) || "home";
    const uniqueMode = url.searchParams.get("unique") === "1";

    if (url.pathname.startsWith("/get")) {
      return json(await getCounts(env, key), origin);
    }

    if (url.pathname.startsWith("/hit")) {
      const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
      await throttle(env, ip, key, 3); // 3 sec rate limit

      let uniqueInc = 1;
      if (uniqueMode) {
        const day = new Date().toISOString().slice(0, 10);
        const dedupeKey = `u:${key}:${day}:${ip}`;
        const seen = await env.HITCOUNTER.get(dedupeKey);
        if (seen) uniqueInc = 0;
        else await env.HITCOUNTER.put(dedupeKey, "1", { expirationTtl: 86400 });
      }

      const totalKey = `t:${key}`;
      const uniqKey = `n:${key}`;
      const [tRaw, uRaw] = await Promise.all([
        env.HITCOUNTER.get(totalKey),
        env.HITCOUNTER.get(uniqKey),
      ]);

      const total = (parseInt(tRaw || "0", 10) || 0) + 1;
      const unique = (parseInt(uRaw || "0", 10) || 0) + uniqueInc;

      await Promise.all([
        env.HITCOUNTER.put(totalKey, String(total)),
        env.HITCOUNTER.put(uniqKey, String(unique)),
        env.HITCOUNTER.put(`updated:${key}`, new Date().toISOString()),
      ]);

      return json(await getCounts(env, key), origin);
    }

    return new Response(
      `Hit Counter API Ready ✅
➡ Increment: /hit?key=<id>&unique=1
➡ Read only: /get?key=<id>`,
      { headers: { "content-type": "text/plain" } }
    );
  }
};

// Helpers
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body, origin, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}

function inferKeyFromPath(path) {
  const clean = path.replace(/^\/+|\/+$/g, "");
  return clean || null;
}

async function getCounts(env, key) {
  const [tRaw, uRaw, updated] = await Promise.all([
    env.HITCOUNTER.get(`t:${key}`),
    env.HITCOUNTER.get(`n:${key}`),
    env.HITCOUNTER.get(`updated:${key}`),
  ]);
  const total = parseInt(tRaw || "0", 10) || 0;
  const unique = parseInt(uRaw || "0", 10) || 0;
  return {
    key,
    total,
    unique,
    total_formatted: formatNum(total),
    unique_formatted: formatNum(unique),
    updated_at: updated || null,
  };
}

async function throttle(env, ip, key, sec) {
  const k = `th:${key}:${ip}`;
  const hit = await env.HITCOUNTER.get(k);
  if (!hit) await env.HITCOUNTER.put(k, "1", { expirationTtl: sec });
}

function formatNum(n) {
  if (n < 1000) return String(n);
  const units = ["K", "M", "B", "T"];
  let unit = -1;
  let num = n;
  while (num >= 1000 && unit < units.length - 1) {
    num /= 1000;
    unit++;
  }
  return `${Math.round(num * 10) / 10}${units[unit]}`;
    }
