import { authed } from "@/lib/auth";
import { deleteEvent, getToken, listEvents, upsertEvent, type TaskIn } from "@/lib/google";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await authed(req);
  if (!a) return Response.json({ error: "auth" }, { status: 401 });
  let { token, reason } = await getToken(a.user.id);
  if (!token) return Response.json({ connected: false, events: [], reason });

  const u = new URL(req.url);
  const from = u.searchParams.get("from") || new Date().toISOString();
  const to = u.searchParams.get("to") || new Date(Date.now() + 14 * 864e5).toISOString();
  const fromMs = Date.parse(from), toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs || toMs - fromMs > 93 * 864e5) {
    return Response.json({ error: "invalid date range" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  let r = await listEvents(token, new Date(fromMs).toISOString(), new Date(toMs).toISOString());
  if (!r.ok && r.status === 401) {
    // The cached token was stale: force a fresh one from the refresh token and retry once.
    const fresh = await getToken(a.user.id, true);
    if (!fresh.token) return Response.json({ connected: false, events: [], reason: fresh.reason || "refresh_failed" });
    token = fresh.token;
    r = await listEvents(token, new Date(fromMs).toISOString(), new Date(toMs).toISOString());
  }
  if (!r.ok) return Response.json({ connected: false, events: [], status: r.status, reason: `google_${r.status}` });
  return Response.json({ connected: true, events: r.events });
}

export async function POST(req: Request) {
  const a = await authed(req);
  if (!a) return Response.json({ error: "auth" }, { status: 401 });
  let { token, reason } = await getToken(a.user.id);
  if (!token) return Response.json({ connected: false, reason });

  let body: { op?: "upsert" | "delete"; task?: TaskIn; ev?: string };
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > 16_000) {
      return Response.json({ error: "request too large" }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    body = JSON.parse(raw) as typeof body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "invalid request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (body.op === "delete" && typeof body.ev === "string" && body.ev.length > 0 && body.ev.length <= 512) {
    let ok = await deleteEvent(token, body.ev);
    if (!ok) { const fresh = await getToken(a.user.id, true); if (fresh.token) { token = fresh.token; ok = await deleteEvent(token, body.ev); } }
    return Response.json({ connected: true, ok });
  }
  if (body.op === "upsert" && body.task?.date && body.task?.time &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.task.date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.task.time) &&
      typeof body.task.t === "string" && body.task.t.trim().length > 0 && body.task.t.length <= 180 &&
      Number.isFinite(Number(body.task.min)) && Number(body.task.min) >= 5 && Number(body.task.min) <= 480) {
    let r = await upsertEvent(token, body.task);
    if ("error" in r && r.error === 401) {
      const fresh = await getToken(a.user.id, true);
      if (fresh.token) { token = fresh.token; r = await upsertEvent(token, body.task); }
    }
    return Response.json({ connected: true, ...r });
  }
  return Response.json({ error: "bad request" }, { status: 400 });
}
