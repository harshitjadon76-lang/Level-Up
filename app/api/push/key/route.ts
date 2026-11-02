export const dynamic = "force-dynamic";

export function GET() {
  const publicKey = process.env.PUSH_VAPID_PUBLIC_KEY || "";
  const ready = Boolean(
    publicKey &&
    process.env.PUSH_VAPID_PRIVATE_KEY &&
    process.env.PUSH_VAPID_SUBJECT &&
    process.env.CRON_SECRET &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  return Response.json(
    { publicKey, configured: ready },
    { headers: { "Cache-Control": "no-store" } },
  );
}
