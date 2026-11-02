import { authed } from "@/lib/auth";
import { createAdminClient } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cleanName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const name = value.replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, 80);
  return name || fallback;
}

export async function GET(req: Request) {
  const auth = await authed(req);
  if (!auth) {
    return Response.json({ error: "Authentication required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const admin = createAdminClient();
    const metadata = auth.user.user_metadata || {};
    const fallback = cleanName(auth.user.email?.split("@")[0], "Player");
    const profileName = cleanName(metadata.full_name || metadata.name, fallback);

    // New accounts start at zero seasonal trophies. Existing profiles are reset by the season-aware sync route.
    const { error: createError } = await admin.from("xp_profiles").upsert(
      { user_id: auth.user.id, name: profileName, points: 0, skill_xp: {} },
      { onConflict: "user_id", ignoreDuplicates: true }
    );
    if (createError) throw createError;

    const { data: me, error: meError } = await admin.from("xp_profiles")
      .select("user_id,name,points,skill_xp,updated_at")
      .eq("user_id", auth.user.id).single();
    if (meError) throw meError;

    const { data: rows, error: rowsError } = await admin.from("xp_profiles")
      .select("user_id,name,points")
      .neq("user_id", auth.user.id)
      .order("points", { ascending: false })
      .limit(200);
    if (rowsError) throw rowsError;

    return Response.json({
      me: { points: me.points, skill_xp: me.skill_xp || {}, name: me.name, updated_at: me.updated_at },
      players: (rows || []).map((row: { name?: unknown; points?: unknown }) => ({ n: cleanName(row.name, "Player"), p: Number(row.points) || 0, real: 1 })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("XP leaderboard query failed.", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Leaderboard is temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
