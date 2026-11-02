import { createClient } from "@supabase/supabase-js";

export async function authed(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  const token = match?.[1];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || token.length > 8192 || !url || !anon) return null;

  try {
    const sb = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user) return null;
    return { sb, user: data.user };
  } catch {
    return null;
  }
}

const hits = new Map<string, number[]>();
let lastPrune = 0;
/** Per-process throttle for AI usage. For multi-instance deployment, also configure provider/project quotas. */
export function allow(userId: string, max = 30, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const list = (hits.get(userId) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) return false;
  list.push(now);
  hits.set(userId, list);
  if (now - lastPrune > 60_000) {
    for (const [id, times] of hits) {
      const fresh = times.filter((t) => now - t < windowMs);
      if (fresh.length) hits.set(id, fresh);
      else hits.delete(id);
    }
    lastPrune = now;
  }
  return true;
}
