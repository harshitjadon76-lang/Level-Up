import { createAdminClient } from "@/lib/admin";
import { authed } from "@/lib/auth";

export const dynamic = "force-dynamic";

function isToken(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !/[\r\n]/.test(value);
}

export async function POST(req: Request) {
  const auth = await authed(req);
  if (!auth) return Response.json({ error: "auth" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  let body: unknown;
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > 12_000) {
      return Response.json({ error: "request too large" }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const input = body as { refresh_token?: unknown; access_token?: unknown; expires_at?: unknown };
  if (!isToken(input.refresh_token, 4096)) {
    return Response.json({ error: "refresh token required" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const access = input.access_token == null ? null : isToken(input.access_token, 8192) ? input.access_token : undefined;
  if (access === undefined) {
    return Response.json({ error: "invalid access token" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const expiresAt = typeof input.expires_at === "string" && Number.isFinite(Date.parse(input.expires_at))
    ? new Date(input.expires_at).toISOString()
    : new Date(Date.now() + 3300_000).toISOString();

  try {
    const admin = createAdminClient();
    const { error } = await admin.from("google_tokens").upsert({
      user_id: auth.user.id,
      refresh_token: input.refresh_token,
      access_token: access,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.error("Could not save Google Calendar credentials.", error.message);
      return Response.json({ error: "could not save calendar credentials" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Google Calendar credential storage is not configured.", error);
    return Response.json({ error: "server credential storage is not configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
