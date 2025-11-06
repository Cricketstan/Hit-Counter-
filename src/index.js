export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "*";

    // CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    const key = url.searchParams.get("key") || "default";
    const uniqueMode = url.searchParams.get("unique") === "1";

    if (url.pathname.startsWith("/get")) {
      return json(await getCounts(env, key), origin);
    }

    if (url.pathname.startsWith("/hit")) {
      const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";

      // Unique check (per IP per day)
      let uniqueInc = 1;
      if (uniqueMode) {
        const day = new Date().toISOString().slice(0, 10);
        const dedupeKey = `u:${key}:${day}:${ip}`;
        const already = await env.HITCOUNTER.get(dedupeKey);
        if (already) uniqueInc = 0;
        else await env.HITCOUNTER.put(dedupeKey, "1", { expirationTtl: 86400 });
      }

      // Get old values
      const totalKey = `t:${key}`;
      const uniqKey  = `n:${key}`;
      const [tRaw, uRaw] = await Promise.all([
        env.HITCOUNTER.get(totalKey),
        env.HITCOUNTER.get(uniqKey),
      ]);

      const total  = (parseInt(tRaw || "0") || 0) + 1;
      const unique = (parseInt(uRaw || "0") || 0) + uniqueInc;

      // Save new values
      await Promise.all([
        env.HITCOUNTER.put(totalKey, String(total)),
        env.HITCOUNTER.put(uniqKey,  String(unique)),
        env.HITCOUNTER.put(`updated:${key}`, new Date().toISOString()),
      ]);

      return json(await getCounts(env, key), origin);
    }

    return new Response("Hit Counter API ✅\nUse /hit?key=test or /get?key=test");
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

async function getCounts(env, key) {
  const [tRaw, uRaw, updated] = await Promise.all([
    env.HITCOUNTER.get(`t:${key}`),
    env.HITCOUNTER.get(`n:${key}`),
    env.HITCOUNTER.get(`updated:${key}`),
  ]);
  const total  = parseInt(tRaw || "0") || 0;
  const unique = parseInt(uRaw || "0") || 0;
  return {
    key,
    total,
    unique,
    total_formatted: formatNum(total),
    unique_formatted: formatNum(unique),
    updated_at: updated || null,
  };
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
