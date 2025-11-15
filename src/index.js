export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    const key = url.searchParams.get("key") || "default";
    const uniqueMode = url.searchParams.get("unique") === "1";

    if (url.pathname.startsWith("/get")) {
      return json(await getCountsFirebase(key, env), origin);
    }

    if (url.pathname.startsWith("/hit")) {
      const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";

      let uniqueInc = 1;
      if (uniqueMode) {
        const day = new Date().toISOString().slice(0, 10);
        const ipKey = `unique/${key}/${day}/${ip}.json`;
        const exists = await firebaseGet(env, ipKey);
        if (exists) {
          uniqueInc = 0;
        } else {
          await firebasePut(env, ipKey, true);
        }
      }

      const totalPath = `counters/${key}/total.json`;
      const uniquePath = `counters/${key}/unique.json`;

      const totalValue = (await firebaseGet(env, totalPath)) || 0;
      const uniqueValue = (await firebaseGet(env, uniquePath)) || 0;

      const newTotal = totalValue + 1;
      const newUnique = uniqueValue + uniqueInc;

      await firebasePut(env, totalPath, newTotal);
      await firebasePut(env, uniquePath, newUnique);

      await firebasePut(env, `counters/${key}/updated_at.json`, new Date().toISOString());

      return json(await getCountsFirebase(key, env), origin);
    }

    return new Response("Hit Counter API (Firebase Mode) ✔\nUse /hit?key=test or /get?key=test");
  }
};

// ---- Firebase Helpers ----

const FIREBASE_URL = "https://hit-counters-default-rtdb.firebaseio.com/";

async function firebaseGet(env, path) {
  const url = FIREBASE_URL + path;
  const res = await fetch(url);
  return await res.json();
}

async function firebasePut(env, path, value) {
  const url = FIREBASE_URL + path;
  await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
}

async function getCountsFirebase(key, env) {
  const base = `counters/${key}/`;
  const total = (await firebaseGet(env, base + "total.json")) || 0;
  const unique = (await firebaseGet(env, base + "unique.json")) || 0;
  const updated = await firebaseGet(env, base + "updated_at.json");

  return {
    key,
    total,
    unique,
    total_formatted: formatNum(total),
    unique_formatted: formatNum(unique),
    updated_at: updated || null,
  };
}

// ---- CORS + Utils ----

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
