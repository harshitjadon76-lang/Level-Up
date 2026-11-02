export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    supabaseConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    googleTokenStorageConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    pushNotificationsConfigured: Boolean(process.env.PUSH_VAPID_PUBLIC_KEY && process.env.PUSH_VAPID_PRIVATE_KEY && process.env.PUSH_VAPID_SUBJECT && process.env.CRON_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY),
  }, { headers: { "Cache-Control": "no-store" } });
}
