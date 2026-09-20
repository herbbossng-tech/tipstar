// Supabase Edge Function (Deno runtime).
//
// Validates a Telegram Mini App `initData` payload server-side and returns
// the resolved Telegram user, or 401 if validation fails. This is the
// edge-function counterpart to packages/telegram/src/init-data.ts — the
// algorithm MUST stay identical to that package. Deno cannot import the
// Node workspace package directly without a bundling step, so the HMAC
// logic is intentionally re-implemented here using Web Crypto; if you
// change the algorithm in packages/telegram, mirror the change here too.
//
// Deploy: supabase functions deploy telegram-init-auth
// Required secret: TELEGRAM_BOT_TOKEN (supabase secrets set TELEGRAM_BOT_TOKEN=...)

const encoder = new TextEncoder();

async function hmacSha256(keyMaterial: Uint8Array | string, data: string): Promise<Uint8Array> {
  const keyBytes = typeof keyMaterial === "string" ? encoder.encode(keyMaterial) : keyMaterial;
  const key = await crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return new Uint8Array(signature);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function validateInitData(initDataRaw: string, botToken: string, maxAgeSeconds: number) {
  const params = new URLSearchParams(initDataRaw);
  const hash = params.get("hash");
  if (!hash) return { valid: false as const, reason: "missing_hash" };

  const entries: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    entries.push(`${key}=${value}`);
  }
  entries.sort();
  const dataCheckString = entries.join("\n");

  const secretKey = await hmacSha256("WebAppData", botToken);
  const computedHashBytes = await hmacSha256(secretKey, dataCheckString);
  const computedHash = toHex(computedHashBytes);

  if (!timingSafeEqualHex(computedHash, hash)) {
    return { valid: false as const, reason: "signature_invalid" };
  }

  const authDateRaw = params.get("auth_date");
  if (!authDateRaw) return { valid: false as const, reason: "missing_auth_date" };
  const ageSeconds = Date.now() / 1000 - Number(authDateRaw);
  if (ageSeconds > maxAgeSeconds || ageSeconds < -60) {
    return { valid: false as const, reason: "expired" };
  }

  const userRaw = params.get("user");
  const user = userRaw ? JSON.parse(userRaw) : undefined;

  return { valid: true as const, user, authDate: new Date(Number(authDateRaw) * 1000).toISOString() };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) {
    return new Response(JSON.stringify({ error: "server_misconfigured" }), { status: 500 });
  }

  const maxAgeSeconds = Number(Deno.env.get("TELEGRAM_INITDATA_MAX_AGE_SECONDS") ?? "86400");

  let body: { initData?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }

  if (!body.initData) {
    return new Response(JSON.stringify({ error: "missing_init_data" }), { status: 400 });
  }

  const result = await validateInitData(body.initData, botToken, maxAgeSeconds);
  if (!result.valid) {
    return new Response(JSON.stringify({ error: "unauthorized", reason: result.reason }), { status: 401 });
  }

  // NOTE: Section 01 boundary — resolving/creating the internal Tipstar
  // user record (idempotent upsert keyed on telegram user id) and issuing
  // a session/JWT is the backend's job in a later section. This function
  // only proves the payload is authentic.
  return new Response(JSON.stringify({ valid: true, user: result.user, authDate: result.authDate }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
