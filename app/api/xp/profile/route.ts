import { authed } from "@/lib/auth";
import { createAdminClient } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(req: Request) {
  const auth = await authed(req);
  if (!auth) {
    return Response.json({ error: "Authentication required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const admin = createAdminClient();
    const userId = auth.user.id;
    const { error: eventsError } = await admin.from("xp_events").delete().eq("user_id", userId);
    if (eventsError) throw eventsError;
    const { error: profileError } = await admin.from("xp_profiles").delete().eq("user_id", userId);
    if (profileError) throw profileError;
    const { error: legacyError } = await admin.from("scores").delete().eq("user_id", userId);
    if (legacyError) throw legacyError;
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Could not reset XP profile" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
