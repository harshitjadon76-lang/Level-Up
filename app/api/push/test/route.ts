import webpush from "web-push";
import { authed } from "@/lib/auth";
import { createAdminClient } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function configurePush() {
  const publicKey = process.env.PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.PUSH_VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) throw new Error("Web Push VAPID keys are not configured");
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export async function POST(req: Request) {
  const auth = await authed(req);
  if (!auth) return Response.json({ error: "auth" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    configurePush();
    const admin = createAdminClient();
    const { data, error } = await admin.from("push_subscriptions")
      .select("endpoint, subscription").eq("user_id", auth.user.id).limit(10);
    if (error) throw error;
    if (!data?.length) return Response.json({ error: "no push subscription found; enable background notifications first" }, { status: 409 });
    let sent = 0;
    for (const row of data) {
      try {
        await webpush.sendNotification(row.subscription as webpush.PushSubscription, JSON.stringify({
          title: "Level Up is connected ✅",
          body: "Background notifications are ready. Your task reminders can reach you when the app is closed.",
          url: "/",
          tag: "levelup-push-test",
        }), { TTL: 60 });
        sent++;
      } catch (e) {
        const status = typeof e === "object" && e !== null && "statusCode" in e ? Number((e as { statusCode: unknown }).statusCode) : 0;
        if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("endpoint", row.endpoint);
        else console.error("Push test delivery failed.", status || "unknown status");
      }
    }
    return sent
      ? Response.json({ ok: true, sent }, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: "The push service rejected the test notification. Check the VAPID settings and browser subscription." }, { status: 502 });
  } catch (e) {
    console.error("Push test is not configured.", e instanceof Error ? e.message : "unknown error");
    return Response.json({ error: "background push is not configured on the server" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
