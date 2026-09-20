// Supabase Edge Function (Deno runtime).
//
// Receives Telegram Bot API webhook updates. Verifies the
// `X-Telegram-Bot-Api-Secret-Token` header before accepting a request
// (Engineering Constitution L — validate Telegram-originated requests
// server-side). Section 01 boundary: acknowledges and logs the update;
// routing updates into bot command handlers / notification dispatch is
// built out in a later section (see apps/bot for the equivalent Node
// long-polling/webhook implementation used in local development).
//
// Deploy: supabase functions deploy telegram-webhook --no-verify-jwt
// Required secret: TELEGRAM_WEBHOOK_SECRET (must match the secret_token
// passed to https://api.telegram.org/bot<token>/setWebhook)

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const expectedSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (!expectedSecret) {
    return new Response(JSON.stringify({ error: "server_misconfigured" }), { status: 500 });
  }

  const providedSecret = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!timingSafeEqual(providedSecret, expectedSecret)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }

  console.log("telegram_webhook_update_received", JSON.stringify({ hasUpdate: update !== null }));

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
});
