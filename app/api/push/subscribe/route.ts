import { authed } from "@/lib/auth";
import { createAdminClient } from "@/lib/admin";

export const dynamic = "force-dynamic";

function validSubscription(value: unknown): value is {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof v.endpoint !== "string" || v.endpoint.length > 4096) return false;
  try {
    const u = new URL(v.endpoint);
    if (u.protocol !== "https:") return false;
  } catch { return false; }
  return Boolean(
    v.keys && typeof v.keys.p256dh === "string" && v.keys.p256dh.length <= 512 &&
    typeof v.keys.auth === "string" && v.keys.auth.length <= 512,
  );
}

function validTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 100) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; }
  catch { return false; }
}

export async function GET(req: Request) {
  const auth = await authed(req);
  if (!auth) return Response.json({ error: "auth" }, { status: 401 });
  try {
    const admin = createAdminClient();
    const { count, error } = await admin.from("push_subscriptions")
      .select("endpoint", { count: "exact", head: true }).eq("user_id", auth.user.id);
    if (error) throw error;
    return Response.json({ enabled: (count || 0) > 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "push storage is not configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(req: Request) {
  const auth = await authed(req);
  if (!auth) return Response.json({ error: "auth" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  let body: unknown;
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > 12_000) return Response.json({ error: "request too large" }, { status: 413 });
    body = JSON.parse(raw);
  } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "invalid request" }, { status: 400 });
  const input = body as { subscription?: unknown; timezone?: unknown };
  if (!validSubscription(input.subscription) || !validTimezone(input.timezone)) {
    return Response.json({ error: "invalid subscription or timezone" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const admin = createAdminClient();
    const sub = input.subscription;
    const { error } = await admin.from("push_subscriptions").upsert({
      endpoint: sub.endpoint,
      user_id: auth.user.id,
      subscription: sub,
      timezone: input.timezone,
      updated_at: new Date().toISOString(),
    }, { onConflict: "endpoint" });
    if (error) throw error;
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not save push subscription.", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "could not save notification subscription" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(req: Request) {
  const auth = await authed(req);
  if (!auth) return Response.json({ error: "auth" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  let endpoint = "";
  try { endpoint = new URL(req.url).searchParams.get("endpoint") || ""; } catch {}
  if (!endpoint || endpoint.length > 4096) return Response.json({ error: "endpoint required" }, { status: 400 });
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("push_subscriptions").delete().eq("user_id", auth.user.id).eq("endpoint", endpoint);
    if (error) throw error;
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "could not remove subscription" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
