import { createAdminClient } from "@/lib/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export type TokenResult = { token: string | null; reason?: string };

/** Returns a usable Google access token, or null plus a reason the UI can show. force=true skips the cached token. */
export async function getToken(userId: string, force = false): Promise<TokenResult> {
  let sb: SupabaseClient;
  try {
    sb = createAdminClient();
  } catch (error) {
    console.error("Google Calendar server storage is not configured.", error);
    return { token: null, reason: "server_not_configured" };
  }
  const { data, error } = await sb
    .from("google_tokens")
    .select("refresh_token, access_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("Could not read Google Calendar credentials.", error.message);
    return { token: null, reason: "storage_error" };
  }
  if (!data?.refresh_token) return { token: null, reason: "no_token" };
  if (!force && data.access_token && data.expires_at && new Date(data.expires_at).getTime() > Date.now() + 60_000) {
    return { token: data.access_token as string };
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return { token: null, reason: "google_client_not_configured" };
  }
  let j: { access_token?: string; expires_in?: number };
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: data.refresh_token as string,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      console.error("Google refused to refresh the Calendar token.", r.status, await r.text().catch(() => ""));
      return { token: null, reason: "refresh_failed" };
    }
    j = await r.json() as { access_token?: string; expires_in?: number };
  } catch (error) {
    console.error("Google token refresh request failed.", error);
    return { token: null, reason: "refresh_failed" };
  }
  if (!j.access_token || !Number.isFinite(Number(j.expires_in)) || Number(j.expires_in) < 60) {
    return { token: null, reason: "refresh_failed" };
  }
  const { error: saveError } = await sb
    .from("google_tokens")
    .update({ access_token: j.access_token, expires_at: new Date(Date.now() + Number(j.expires_in) * 1000).toISOString(), updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (saveError) console.error("Could not cache Google Calendar access token.", saveError.message);
  return { token: j.access_token };
}

export async function accessToken(userId: string): Promise<string | null> {
  return (await getToken(userId)).token;
}

export type TaskIn = {
  id: number; t: string; date: string; time: string; min: number;
  sk?: string; pri?: string; pts?: number; done?: boolean; ev?: string; tz?: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** local wall-clock end time (handles crossing midnight) */
function endOf(date: string, time: string, min: number) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + min;
  let d = date;
  if (total >= 1440) {
    const x = new Date(date + "T00:00:00Z");
    x.setUTCDate(x.getUTCDate() + Math.floor(total / 1440));
    d = x.toISOString().slice(0, 10);
  }
  const mm = total % 1440;
  return `${d}T${pad(Math.floor(mm / 60))}:${pad(mm % 60)}:00`;
}

export function eventBody(t: TaskIn) {
  const tz = t.tz || "Asia/Kolkata";
  return {
    summary: `${t.done ? "✅" : "⚡"} ${t.t}`,
    description: `Skill: ${t.sk || "-"} · ${t.pri || "-"} priority · ${t.pts ?? 0} trophies\nPlanned by Level Up`,
    start: { dateTime: `${t.date}T${t.time}:00`, timeZone: tz },
    end: { dateTime: endOf(t.date, t.time, Math.max(5, t.min || 30)), timeZone: tz },
    colorId: t.done ? "8" : undefined,
    reminders: t.done
      ? { useDefault: false, overrides: [] }
      : {
          useDefault: false,
          overrides: [
            { method: "popup", minutes: 15 },
            { method: "popup", minutes: 5 },
            { method: "popup", minutes: 0 },
            { method: "email", minutes: 15 },
          ],
        },
    extendedProperties: { private: { levelup: "1", taskId: String(t.id) } },
  };
}

export async function listEvents(token: string, from: string, to: string) {
  const u = new URL(API);
  u.searchParams.set("timeMin", from);
  u.searchParams.set("timeMax", to);
  u.searchParams.set("singleEvents", "true");
  u.searchParams.set("orderBy", "startTime");
  u.searchParams.set("maxResults", "250");
  const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return { ok: false as const, status: r.status, events: [] };
  const j = (await r.json()) as { items?: Array<Record<string, any>> };
  const events = (j.items || [])
    .filter((e) => e.status !== "cancelled")
    .map((e) => ({
      id: e.id as string,
      title: (e.summary as string) || "(no title)",
      start: (e.start?.dateTime || e.start?.date) as string,
      end: (e.end?.dateTime || e.end?.date) as string,
      allDay: !e.start?.dateTime,
      app: e.extendedProperties?.private?.levelup === "1",
    }));
  return { ok: true as const, status: 200, events };
}

export async function upsertEvent(token: string, t: TaskIn) {
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const body = JSON.stringify(eventBody(t));
  if (t.ev) {
    const r = await fetch(`${API}/${encodeURIComponent(t.ev)}`, { method: "PATCH", headers: h, body });
    if (r.ok) return { ev: t.ev };
    if (r.status !== 404 && r.status !== 410) return { error: r.status };
  }
  const r = await fetch(API, { method: "POST", headers: h, body });
  if (!r.ok) return { error: r.status };
  const j = (await r.json()) as { id: string };
  return { ev: j.id };
}

export async function deleteEvent(token: string, ev: string) {
  const r = await fetch(`${API}/${encodeURIComponent(ev)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.ok || r.status === 404 || r.status === 410;
}
