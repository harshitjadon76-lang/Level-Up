import { authed } from "@/lib/auth";
import { createAdminClient } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 120) => typeof value === "string" ? value.slice(0, max) : "";
const eventId = (value: unknown) => {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const id = String(value);
  return id.length > 0 && id.length <= 120 && /^[A-Za-z0-9._:-]+$/.test(id) ? id : "";
};
const positiveInt = (value: unknown, fallback = 0, max = 10000000) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.floor(n))) : fallback;
};

function taskPoints(task: Obj, skillDefs: Obj): { points: number; skill: string } {
  const priority: Record<string, number> = { Low: 1, Normal: 2, High: 3 };
  const multiplier = priority[text(task.pri, 20)] || 2;
  const skill = text(task.sk, 60) || "Personality";
  const skillDef = isObj(skillDefs[skill]) ? skillDefs[skill] as Obj : {};
  const rawWeight = Number(skillDef.w);
  const weight = Number.isFinite(rawWeight) ? Math.max(1, Math.min(3, Math.floor(rawWeight))) : 2;
  return { points: Math.min(18, 2 * multiplier * weight), skill };
}

type XpEvent = { key: string; type: string; points: number; skill: string | null; skillDelta: number };

export async function POST(req: Request) {
  const auth = await authed(req);
  if (!auth) {
    return Response.json({ error: "Authentication required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const admin = createAdminClient();
    const { error: createError } = await admin.from("xp_profiles").upsert(
      { user_id: auth.user.id, name: text(auth.user.user_metadata?.full_name || auth.user.user_metadata?.name || auth.user.email?.split("@")[0] || "Player", 80), points: 0, skill_xp: {} },
      { onConflict: "user_id", ignoreDuplicates: true }
    );
    if (createError) throw createError;

    const { data: row, error: stateError } = await admin.from("user_state")
      .select("state").eq("user_id", auth.user.id).maybeSingle();
    if (stateError) throw stateError;

    const doc = isObj(row?.state) ? row.state : {};
    const state = isObj(doc.S) ? doc.S : doc;
    const skillDefs = isObj(doc.SK) ? doc.SK : {};
    const tasks: Obj[] = Array.isArray(state.tasks) ? state.tasks.filter(isObj) : [];
    const habits: Obj[] = Array.isArray(state.hab) ? state.hab.filter(isObj) : [];
    const clientSeasonMonth = text(state.activeSeasonMonth, 7);
    const seasonMonth = /^\d{4}-\d{2}$/.test(clientSeasonMonth) ? clientSeasonMonth : new Date().toISOString().slice(0, 7);
    const { data: currentProfile, error: currentProfileError } = await admin.from("xp_profiles")
      .select("season_month").eq("user_id", auth.user.id).single();
    if (currentProfileError) throw currentProfileError;
    if (currentProfile.season_month !== seasonMonth) {
      const { error: seasonResetError } = await admin.from("xp_profiles")
        .update({ points: 0, season_month: seasonMonth, updated_at: new Date().toISOString() })
        .eq("user_id", auth.user.id);
      if (seasonResetError) throw seasonResetError;
    }
    const events: XpEvent[] = [];
    const levelUpCandidates: Array<{ day: string; category: string; key: string; at: string }> = [];

    // Normalize both current YYYY-MM keys and the older zero-based, unpadded month keys.
    const habitCalendarDate = (monthKey: string, day: number) => {
      const match = String(monthKey).match(/^(\d{4})-(\d{1,2})$/);
      if (!match) return new Date().toISOString().slice(0, 7) + "-" + String(day).padStart(2, "0");
      const year = Number(match[1]);
      const rawMonth = match[2];
      let monthNumber = Number(rawMonth);
      if (rawMonth.length === 1) monthNumber += 1; // legacy month came from Date.getMonth()
      if (monthNumber > 12) monthNumber = ((monthNumber - 1) % 12) + 1;
      if (monthNumber < 1) monthNumber = 1;
      return `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    };

    // New trophy system: every credited task minute is worth exactly 2 trophies.
    // Each task's completion is deduplicated by the immutable task event key below.
    const completionDate = (task: Obj) => {
      const dd = text(task.dd, 10), at = text(task.completedAt, 40), scheduled = text(task.date, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dd)) return dd;
      if (/^\d{4}-\d{2}-\d{2}T/.test(at)) return at.slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(scheduled)) return scheduled;
      return new Date().toISOString().slice(0, 10);
    };
    const duration = (task: Obj) => { const n = Number(task.min); return Number.isFinite(n) ? Math.max(1, Math.min(480, Math.floor(n))) : 30; };
    const trophyAwards = new Map<string, number>();
    for (const task of tasks) {
      const id = eventId(task.id);
      if (!id || (task.done !== true && task.trophyAwarded !== true) || task.fail === true) continue;
      trophyAwards.set(id, duration(task) * 2);
    }

    // Rewards are calculated from saved activity on the server. The browser's submitted
    // S.points and S.xp values are intentionally ignored. Event keys make every reward idempotent.
    for (const task of tasks) {
      const id = eventId(task.id);
      const partialMinutes = positiveInt(task.partialMinutes, 0, 480);
      const partialDay = text(task.partialDay, 10);
      if (id && task.partialLogged === true && partialMinutes > 0 && /^\d{4}-\d{2}-\d{2}$/.test(partialDay)) {
        events.push({ key: `task-partial:${id}:${partialDay}`, type: "task_partial", points: partialMinutes * 2, skill: null, skillDelta: 0 });
      }
    }
    for (const task of tasks) {
      const id = eventId(task.id);
      if (!id || task.done !== true || task.fail === true) continue;
      const reward = taskPoints(task, skillDefs);
      const category = text(task.sk, 60);
      const directPersonalityLevelUp = category === "Personality" && task.skillLevelUp === true ? 10 : 0;
      // Academic/Tech/Communication advance by logged minutes; Mindset/Fitness advance only via habits.
      const skillDelta = ["Academics", "Tech", "Communication", "Mindset", "Fitness"].includes(category) ? 0 : reward.points + directPersonalityLevelUp;
      const partialCredit = task.partialLogged === true ? positiveInt(task.partialMinutes, 0, 480) * 2 : 0;
      events.push({ key: `task:${id}`, type: "task_completed", points: Math.max(0, (trophyAwards.get(id) || 0) - partialCredit), skill: skillDelta ? reward.skill : null, skillDelta });
      if (["Academics", "Tech", "Communication", "Mindset", "Fitness"].includes(category) && task.personalityBonusAwarded === true) {
        events.push({ key: `personality:task:${id}:progress`, type: "personality_inherited_progress", points: 0, skill: "Personality", skillDelta: 1 });
        if (["Academics", "Tech", "Communication"].includes(category) && task.personalityLevelUp === true) {
          levelUpCandidates.push({
            day: completionDate(task),
            category,
            key: `personality:task:${id}:levelup`,
            at: text(task.completedAt, 40) || `${completionDate(task)}T23:59:59`,
          });
        }
      }
    }

    const storedMonth = text(state.mk, 7);
    // The legacy app uses a zero-based, sometimes unpadded month key (e.g. 2026-9).
    // Keep that exact key for deduplication so it matches the client-side habit ledger.
    const month = /^\d{4}-(?:0?[1-9]|1[0-2])$/.test(storedMonth) ? storedMonth : new Date().toISOString().slice(0, 7);
    for (const habit of habits) {
      const name = text(habit.n, 100).trim();
      if (!name || !Array.isArray(habit.d)) continue;
      const category = text(habit.sk, 60) || "Personality";
      for (let index = 0; index < Math.min(31, habit.d.length); index++) {
        const day = index + 1;
        const eventKey = `habit:${month}:${name.toLowerCase()}:${day}`;
        if (habit.d[index] === 0) {
          const missedDate = habitCalendarDate(month, day);
          const weekday = new Date(missedDate + "T12:00:00").getDay();
          const restDays = Array.isArray(habit.restDays) ? habit.restDays.map(Number) : [];
          const shieldedDays = Array.isArray(habit.shieldedDays) ? habit.shieldedDays.map(String) : [];
          if (!restDays.includes(weekday) && !shieldedDays.includes(missedDate)) {
            events.push({ key: `habit-missed:${month}:${name.toLowerCase()}:${day}`, type: "habit_missed", points: -7, skill: null, skillDelta: 0 });
          }
          continue;
        }
        if (habit.d[index] !== 1) continue;
        if (eventKey.length > 200) continue;
        // New habit reward: a completed check-in awards +1 through +7 based on the current streak.
        // Rest days (2) preserve streak continuity but do not award.
        const restDays = Array.isArray(habit.restDays) ? habit.restDays.map(Number) : [];
        let streak = 1;
        for (let prior = index - 1; prior >= 0; prior--) {
          const priorDate = habitCalendarDate(month, prior + 1);
          const weekday = new Date(priorDate + "T12:00:00").getDay();
          if (habit.d[prior] === 1 || habit.d[prior] === 2 || restDays.includes(weekday)) streak++;
          else break;
        }
        const habitTrophyReward = Math.min(7, Math.max(1, streak));
        events.push({ key: eventKey, type: "habit_checked", points: habitTrophyReward, skill: null, skillDelta: 0 });
        const monthDayKey = `${month}:${day}`;
        const bonusMap = isObj(habit.personalityBonusAwarded) ? habit.personalityBonusAwarded : {};
        const levels = isObj(habit.skillLevelUps) ? habit.skillLevelUps : {};
        const levelUpAt = isObj(habit.personalityLevelUpAt) ? habit.personalityLevelUpAt : {};
        if (["Mindset", "Fitness"].includes(category) && bonusMap[monthDayKey] === true) {
          events.push({ key: `personality:habit:${month}:${name.toLowerCase()}:${day}:progress`, type: "personality_inherited_progress", points: 0, skill: "Personality", skillDelta: 1 });
          if (levels[monthDayKey] === true) {
            levelUpCandidates.push({
              day: habitCalendarDate(month, day),
              category,
              key: `personality:habit:${month}:${name.toLowerCase()}:${day}:levelup`,
              at: text(levelUpAt[monthDayKey], 40) || `${habitCalendarDate(month, day)}T23:59:59`,
            });
          }
        }
      }
    }

    // Personality diminishing returns are counted per source category and local calendar day:
    // first level-up = +10 XP, further level-ups that day in the same category = +5 XP.
    const groupedLevelUps = new Map<string, typeof levelUpCandidates>();
    for (const candidate of levelUpCandidates) {
      const groupKey = `${candidate.day}|${candidate.category}`;
      const group = groupedLevelUps.get(groupKey) || [];
      group.push(candidate);
      groupedLevelUps.set(groupKey, group);
    }
    for (const group of groupedLevelUps.values()) {
      group.sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
      group.forEach((candidate, index) => {
        events.push({
          key: candidate.key,
          type: "personality_inherited_levelup",
          points: 0,
          skill: "Personality",
          skillDelta: index === 0 ? 10 : 5,
        });
      });
    }

    // Bound the work for large or malformed state records. Each event is deduplicated in SQL.
    const batch = events.slice(0, 5000);
    const { data: awardRows, error: awardError } = await admin.rpc("award_xp_events", {
      p_user_id: auth.user.id,
      p_events: batch,
    });
    if (awardError) throw awardError;
    const awardResult = Array.isArray(awardRows) ? awardRows[0] : awardRows;
    const awarded = Number(awardResult?.applied_count) || 0;

    const { data: me, error: profileError } = await admin.from("xp_profiles")
      .select("points,skill_xp,name,updated_at")
      .eq("user_id", auth.user.id).single();
    if (profileError) throw profileError;

    return Response.json({
      ok: true,
      awarded,
      me: { points: me.points, skill_xp: me.skill_xp || {}, name: me.name, updated_at: me.updated_at },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("XP reconciliation failed.", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "XP could not be synchronized. Run the latest Supabase schema.sql." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
