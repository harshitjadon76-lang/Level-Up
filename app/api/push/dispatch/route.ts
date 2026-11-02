import { timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { createAdminClient } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function constantTimeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function dateShift(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function localParts(timeZone: string) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const v = Object.fromEntries(p.map((x) => [x.type, x.value]));
  return { date: `${v.year}-${v.month}-${v.day}`, minute: Number(v.hour) * 60 + Number(v.minute) };
}
function parseState(value: unknown): { tasks: Array<Record<string, unknown>>; reminderSettings: Record<string, unknown> } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const outer = value as { S?: unknown };
  const s = (outer.S && typeof outer.S === "object" && !Array.isArray(outer.S) ? outer.S : value) as Record<string, unknown>;
  return {
    tasks: Array.isArray(s.tasks) ? s.tasks as Array<Record<string, unknown>> : [],
    reminderSettings: s.reminderSettings && typeof s.reminderSettings === "object" && !Array.isArray(s.reminderSettings)
      ? s.reminderSettings as Record<string, unknown> : {},
  };
}
async function claimDelivery(admin: ReturnType<typeof createAdminClient>, userId: string, key: string) {
  const { error } = await admin.from("push_delivery_log").insert({ user_id: userId, notification_key: key });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw error;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET || "";
  const authorization = req.headers.get("authorization") || "";
  if (!secret || !constantTimeEqual(authorization, `Bearer ${secret}`)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const publicKey = process.env.PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.PUSH_VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "push dispatch is not configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  const admin = createAdminClient();
  const { data: subs, error: subError } = await admin.from("push_subscriptions")
    .select("endpoint,user_id,subscription,timezone").limit(5000);
  if (subError) return Response.json({ error: "could not read notification subscriptions" }, { status: 503 });

  const userIds = [...new Set((subs || []).map((x) => x.user_id as string))];
  const states = new Map<string, unknown>();
  for (const id of userIds) {
    const { data, error } = await admin.from("user_state").select("state").eq("user_id", id).maybeSingle();
    if (!error && data) states.set(id, data.state);
  }

  let sent = 0, skipped = 0, removed = 0;
  const nowIso = new Date().toISOString();
  for (const sub of subs || []) {
    let local: ReturnType<typeof localParts>;
    try { local = localParts(typeof sub.timezone === "string" ? sub.timezone : "Asia/Kolkata"); }
    catch { local = localParts("Asia/Kolkata"); }
    const parsed = parseState(states.get(sub.user_id));
    if (!parsed) { skipped++; continue; }
    const rs = parsed.reminderSettings;
    if (rs.enabled !== true && rs.dailyEnabled !== true) { skipped++; continue; }
    const candidates: Array<{ key: string; title: string; body: string; url: string }> = [];
    const lead = Number(rs.leadMinutes);
    const leadMinutes = Number.isFinite(lead) ? Math.max(0, Math.min(30, Math.round(lead))) : 10;
    if (rs.enabled === true) for (const task of parsed.tasks) {
      if (task.done || task.fail || typeof task.id !== "string" && typeof task.id !== "number") continue;
      if (typeof task.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(task.date) || typeof task.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(task.time)) continue;
      const [h, m] = task.time.split(":").map(Number);
      const scheduled = h * 60 + m;
      let dueDate = task.date, dueMinute = scheduled - leadMinutes;
      if (dueMinute < 0) { dueDate = dateShift(dueDate, -1); dueMinute += 1440; }
      if (local.date === dueDate && local.minute >= dueMinute && local.minute <= dueMinute + 2) {
        const title = String(task.t || "Your next task").slice(0, 160);
        const key = `task:${task.date}:${String(task.id)}:${leadMinutes}`;
        candidates.push({ key, title: leadMinutes ? `${title} starts in ${leadMinutes} min` : `Time for ${title}`, body: `Scheduled for ${task.time}. Open Level Up to review your plan.`, url: "/" });
      }
    }
    if (rs.dailyEnabled === true && typeof rs.dailyTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(rs.dailyTime)) {
      const [dh, dm] = rs.dailyTime.split(":").map(Number), due = dh * 60 + dm;
      if (local.minute >= due && local.minute <= due + 2) {
        candidates.push({ key: `daily:${local.date}`, title: "Your Level Up check-in ☀️", body: "Take a moment to review today's goals and progress.", url: "/" });
      }
    }
    for (const item of candidates) {
      let claimed = false;
      try { claimed = await claimDelivery(admin, sub.user_id, item.key); }
      catch { skipped++; continue; }
      if (!claimed) { skipped++; continue; }
      try {
        await webpush.sendNotification(sub.subscription as webpush.PushSubscription, JSON.stringify({
          title: item.title,
          body: item.body,
          url: item.url,
          tag: item.key,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
        }), { TTL: 300 });
        sent++;
      } catch (e) {
        await admin.from("push_delivery_log").delete().eq("user_id", sub.user_id).eq("notification_key", item.key);
        const status = typeof e === "object" && e !== null && "statusCode" in e ? Number((e as { statusCode: unknown }).statusCode) : 0;
        if (status === 404 || status === 410) {
          await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
          removed++;
        } else skipped++;
      }
    }
  }
  // Delivery history only needs to protect recent reminders from duplicate scheduler calls.
  await admin.from("push_delivery_log").delete().lt("sent_at", new Date(Date.now() - 14 * 864e5).toISOString());
  return Response.json({ ok: true, sent, skipped, removed, checked: subs?.length || 0, at: nowIso }, { headers: { "Cache-Control": "no-store" } });
}
