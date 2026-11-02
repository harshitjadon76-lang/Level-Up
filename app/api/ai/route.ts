import { GoogleGenAI } from "@google/genai";
import { allow, authed } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SYSTEM = `You are Level Up's AI planner and coach for a student in India. Be warm, brief and realistic, like a smart friend who understands their day.
Reply with ONLY JSON: {"reply": string, "actions": Action[]}.

Action shapes (use only what is needed):
{"a":"add","t":string,"sk":string,"pri":"Low"|"Normal"|"High","min":number,"date":"YYYY-MM-DD","time":"HH:MM"|null,"win":"morning"|"afternoon"|"evening"|"night"|null,"note":string|null}
{"a":"move","id":number,"date":"YYYY-MM-DD"|null,"time":"HH:MM"|null,"win":string|null}
{"a":"edit","id":number,"t":string|null,"sk":string|null,"pri":string|null,"min":number|null}
{"a":"done","id":number}  {"a":"delete","id":number}
{"a":"habit_add","n":string,"sk":string}  {"a":"habit_remove","n":string}  {"a":"habit_rename","n":string,"to":string}

How to think:
- Understand the situation, not just the words. Hinglish is fine: kal=tomorrow, aaj=today, parso=day after tomorrow, subah=morning, dopahar=afternoon, shaam=evening, raat=night, ghanta=hour.
- Use only skills from the SKILLS list. Tech = programming, web development, databases, software tools. Academics = study, exams, assignments. Fitness = gym, run, sports, sleep, food. Communication = calls, emails, presenting. Mindset = planning, meditation, reflection. Personality = habits, grooming, hobbies, errands.
- Times: if the user states a clock time, put it in "time". If they give only a duration or a day ("study dbms 1hr"), set "time":null and a sensible "win" and the app will pick a free slot (study is usually evening, workouts morning or evening). Never invent a clock time yourself. Never schedule before NOW on today's date.
- Durations: "1hr"=60, "1.5 hours"=90. If none is given guess realistically (call 15, gym 60, study session 60-90, assignment 90).
- Sessions longer than 3 hours must be split into separate sessions of at most 3 hours on different days or windows. Respect the user-selected workload budget (which can be up to 18 hours); if today is already heavy, say so and place work on later days.
- Big goals (exam, quiz, test, project, submission): build a ROADMAP. One "add" per session, spread across the days before the deadline, at most 5 hours of study per day, easier or revision sessions on the last 1-2 days, nothing new the evening before. Add the exam/quiz itself as an "add" (Academics, High priority, its own date and time if known, min 120 if unknown). If the exact date is missing, assume the nearest sensible weekday from the CALENDAR and say what you assumed.
- "I have an exam tomorrow": if the subject is unknown, ask ONE short question and add nothing. If known, schedule revision today and tomorrow morning with High priority and remind them to sleep.
- Ask ONE short question with no actions only when essential information is missing or a request could match several tasks.
- Refer to existing tasks by their id from TASKS. Do not duplicate tasks that already exist. For delete, move or edit pick the best matching id.
- Habits: only use habit actions to add, remove or rename habits. Do not turn habits into tasks.
- "reply": max 2 short sentences, friendly, specific. Do not list clock times in the reply; the app appends the exact schedule after placing tasks. If you only answer a question (no change), put the full answer in "reply" (max 5 short lines).`;


const PLAN_SYSTEM = `You are Level Up's daily scheduling assistant. Reply with ONLY valid JSON: {"reply": string, "actions": Action[]}.
For this request, create a preview schedule for exactly the TARGET DATE supplied in the request. Use only these action shapes:
{"a":"add","t":string,"sk":string,"pri":"Low"|"Normal"|"High","min":number,"date":"YYYY-MM-DD","time":"HH:MM","win":null,"note":string|null}
{"a":"move","id":number,"date":"YYYY-MM-DD","time":"HH:MM","win":null}
Rules:
- Return only add and move actions. Never delete, mark done, or edit a task. This is a preview; the app will ask the user before applying it.
- Use task IDs from CONTEXT for existing open tasks. Never duplicate a task that already exists. Do not move completed/failed tasks. Leave existing fixed timed tasks on the target date in place.
- Prefer overdue, high-priority and deadline-near work, balanced with habits and the user's unfinished goals. Use recent completion patterns and the selected daily workload limit to avoid overloading the user.
- Respect the selected workload limit, start/end window, current time for today, routine hours, existing timed tasks, and Google Calendar busy intervals. Leave at least 10 minutes between work blocks and never overlap an existing commitment.
- Assign a real HH:MM time to every proposed add/move. Do not schedule before the current time on today. Keep total planned work within the hours budget when possible; if it cannot fit, choose the most important tasks and explain briefly what was left out.
- Keep blocks realistic: ordinarily 25–90 minutes, with longer work split into smaller sessions. Suggest at most one or two next-step tasks for goals if the task list is otherwise light. Do not turn habits into tasks.
- Use only skills from SKILLS in CONTEXT. Tech for programming/tools/technology, Academics for study/exams/assignments, Fitness for exercise, Mindset for reflection/meditation, Communication for calls/emails, Personality for errands/hobbies.
- The reply should be at most 3 short sentences, specific to the user's context. Do not claim calendar integration is connected unless the context says it is. If there is nothing sensible to plan, return an empty actions array and explain briefly.`;

type Body = {
  mode?: "chat" | "help" | "plan";
  text?: string;
  now?: { date: string; time: string; weekday: string; tz: string };
  ctx?: Record<string, unknown>;
  history?: Array<{ r: string; t: string }>;
  mood?: number;
  entry?: string;
  targetDate?: string;
  planner?: { energy?: string; hours?: number; start?: string; end?: string; includeCarryover?: boolean };
};

function calendar(date: string) {
  const out: string[] = [];
  for (let i = 0; i < 15; i++) {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    out.push(`${d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} ${d.toISOString().slice(0, 10)}${i === 0 ? " (today)" : ""}`);
  }
  return out.join(", ");
}

function parse(text: string) {
  const clean = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const j = JSON.parse(clean) as { reply?: unknown; actions?: unknown };
  return {
    reply: typeof j.reply === "string" ? j.reply.slice(0, 1000) : "Done.",
    actions: Array.isArray(j.actions) ? j.actions.slice(0, 40) : [],
  };
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validClock(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function actionText(value: unknown, max = 180): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return clean.length > 0 ? clean.slice(0, max) : null;
}
function sanitizeActions(actions: unknown[], mode: "chat" | "plan", contextValue: unknown, targetDate: string) {
  const ctx = record(contextValue);
  const skillEntries = Array.isArray(ctx.skills) ? ctx.skills : [];
  const skills = skillEntries.map((item) => {
    if (typeof item === "string") return item;
    const obj = record(item);
    return typeof obj.name === "string" ? obj.name : typeof obj.n === "string" ? obj.n : "";
  }).filter(Boolean);
  const fallbackSkills = ["Tech", "Fitness", "Mindset", "Academics", "Personality", "Communication"];
  const knownSkills = new Set(skills.length ? skills : fallbackSkills);
  const taskList = mode === "plan" ? ctx.candidateTasks : ctx.tasks;
  const knownTaskIds = new Set((Array.isArray(taskList) ? taskList : []).map((item) => Number(record(item).id)).filter(Number.isSafeInteger));
  const habitList = Array.isArray(ctx.habits) ? ctx.habits : [];
  const knownHabits = new Set(habitList.map((item) => {
    const obj = record(item); return String(obj.n ?? obj.name ?? "").trim().toLowerCase();
  }).filter(Boolean));
  const output: Record<string, unknown>[] = [];

  for (const raw of actions.slice(0, 40)) {
    const a = record(raw);
    if (mode === "plan") {
      if (!validDate(a.date) || a.date !== targetDate || !validClock(a.time)) continue;
      if (a.a === "add") {
        const title = actionText(a.t);
        const skill = typeof a.sk === "string" ? a.sk.trim() : "";
        if (!title || !knownSkills.has(skill)) continue;
        const min = Number(a.min);
        output.push({ a: "add", t: title, sk: skill, pri: ["Low", "Normal", "High"].includes(String(a.pri)) ? a.pri : "Normal", min: Number.isFinite(min) ? Math.max(1, Math.min(240, Math.round(min))) : 30, date: targetDate, time: a.time, win: null, note: actionText(a.note, 240) });
      } else if (a.a === "move") {
        const id = Number(a.id);
        if (!Number.isSafeInteger(id) || !knownTaskIds.has(id)) continue;
        output.push({ a: "move", id, date: targetDate, time: a.time, win: null });
      }
      continue;
    }

    if (a.a === "add") {
      const title = actionText(a.t);
      const skill = typeof a.sk === "string" ? a.sk.trim() : "";
      if (!title || !knownSkills.has(skill) || !validDate(a.date)) continue;
      if (validClock(a.time) === false && a.time != null) continue;
      const min = Number(a.min);
      const win = ["morning", "afternoon", "evening", "night"].includes(String(a.win)) ? a.win : null;
      output.push({ a: "add", t: title, sk: skill, pri: ["Low", "Normal", "High"].includes(String(a.pri)) ? a.pri : "Normal", min: Number.isFinite(min) ? Math.max(1, Math.min(480, Math.round(min))) : 30, date: a.date, time: a.time ?? null, win, note: actionText(a.note, 240) });
    } else if (["move", "edit", "done", "delete"].includes(String(a.a))) {
      const id = Number(a.id);
      if (!Number.isSafeInteger(id) || !knownTaskIds.has(id)) continue;
      if (a.a === "done" || a.a === "delete") output.push({ a: a.a, id });
      else if (a.a === "move") {
        if (a.date != null && !validDate(a.date)) continue;
        if (a.time != null && !validClock(a.time)) continue;
        const win = ["morning", "afternoon", "evening", "night"].includes(String(a.win)) ? a.win : null;
        output.push({ a: "move", id, date: a.date ?? null, time: a.time ?? null, win });
      } else {
        const patch: Record<string, unknown> = { a: "edit", id };
        if (a.t != null) { const title = actionText(a.t); if (title) patch.t = title; }
        if (a.sk != null && typeof a.sk === "string" && knownSkills.has(a.sk)) patch.sk = a.sk;
        if (["Low", "Normal", "High"].includes(String(a.pri))) patch.pri = a.pri;
        if (a.min != null && Number.isFinite(Number(a.min))) patch.min = Math.max(1, Math.min(480, Math.round(Number(a.min))));
        if (Object.keys(patch).length > 2) output.push(patch);
      }
    } else if (a.a === "habit_add") {
      const n = actionText(a.n, 80); const sk = typeof a.sk === "string" ? a.sk : "";
      if (n && knownSkills.has(sk)) output.push({ a: "habit_add", n, sk });
    } else if (a.a === "habit_remove") {
      const n = actionText(a.n, 80); if (n && knownHabits.has(n.toLowerCase())) output.push({ a: "habit_remove", n });
    } else if (a.a === "habit_rename") {
      const n = actionText(a.n, 80); const to = actionText(a.to, 80);
      if (n && to && knownHabits.has(n.toLowerCase())) output.push({ a: "habit_rename", n, to });
    }
  }
  return output.slice(0, 40);
}

export async function POST(req: Request) {
  const a = await authed(req);
  if (!a) return Response.json({ error: "auth" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  let b: Body;
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > 48_000) {
      return Response.json({ error: "request too large" }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    b = JSON.parse(raw) as Body;
    if (!b || typeof b !== "object" || Array.isArray(b)) {
      return Response.json({ error: "invalid request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const mode = b.mode || "chat";
  if (!["chat", "help", "plan"].includes(mode)) return Response.json({ error: "invalid mode" }, { status: 400 });
  if (String(b.text ?? "").length > 1200 || String(b.entry ?? "").length > 1500) {
    return Response.json({ error: "input too long" }, { status: 413, headers: { "Cache-Control": "no-store" } });
  }
  if (!allow(a.user.id)) return Response.json({ error: "slow down" }, { status: 429, headers: { "Cache-Control": "no-store" } });
  if (!process.env.GEMINI_API_KEY) return Response.json({ error: "no key" }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

  try {
    if (mode === "help") {
      const moods = ["very low", "low", "okay", "good", "great"];
      const moodIndex = Number.isFinite(Number(b.mood)) ? Math.max(0, Math.min(4, Math.round(Number(b.mood)))) : 2;
      const prompt = b.entry?.trim()
        ? `Mood: ${moods[moodIndex]}. Journal entry: """${b.entry.slice(0, 1500)}"""\nGive ONE kind, specific tip or reflection in at most 25 words. Plain text only.`
        : `Mood: ${moods[moodIndex]}. Context: ${JSON.stringify(b.ctx ?? {}).slice(0, 800)}\nWrite a one or two sentence starter for a journal entry in first person, plain text only, no quotes.`;
      const r = await ai.models.generateContent({ model, contents: prompt, config: { temperature: 0.7 } });
      return Response.json({ reply: (r.text || "").trim().slice(0, 1200) }, { headers: { "Cache-Control": "no-store" } });
    }

    const rawNow = record(b.now);
    const serverDate = new Date().toISOString().slice(0, 10);
    const now = {
      date: validDate(rawNow.date) ? rawNow.date : serverDate,
      time: validClock(rawNow.time) ? rawNow.time : "12:00",
      weekday: typeof rawNow.weekday === "string" ? rawNow.weekday.slice(0, 20) : "",
      tz: typeof rawNow.tz === "string" && rawNow.tz.length <= 80 ? rawNow.tz : "Asia/Kolkata",
    };
    if (mode === "plan") {
      const targetDate = validDate(b.targetDate) ? b.targetDate : validDate(now.date) ? now.date : new Date().toISOString().slice(0, 10);
      const planContent = [
        `NOW: ${now.weekday} ${now.date} ${now.time} (${now.tz})`,
        `TARGET DATE: ${targetDate}`,
        `PLANNER SETTINGS: ${JSON.stringify(b.planner ?? {})}`,
        `CONTEXT: ${JSON.stringify(b.ctx ?? {}).slice(0, 14000)}`,
        "Create the most useful realistic preview for this target date. Return JSON only.",
      ].join("\n");
      const planResult = await ai.models.generateContent({
        model,
        contents: planContent,
        config: { systemInstruction: PLAN_SYSTEM, responseMimeType: "application/json", temperature: 0.25 },
      });
      const parsed = parse(planResult.text || "{}");
      return Response.json({ reply: parsed.reply, actions: sanitizeActions(parsed.actions, "plan", b.ctx, targetDate) }, { headers: { "Cache-Control": "no-store" } });
    }
    const content = [
      `NOW: ${now.weekday} ${now.date} ${now.time} (${now.tz})`,
      `CALENDAR: ${calendar(now.date)}`,
      `CONTEXT: ${JSON.stringify(b.ctx ?? {}).slice(0, 9000)}`,
      `RECENT CHAT: ${JSON.stringify((b.history ?? []).slice(-6))}`,
      `USER: ${String(b.text ?? "").slice(0, 1200)}`,
    ].join("\n");

    const r = await ai.models.generateContent({
      model,
      contents: content,
      config: { systemInstruction: SYSTEM, responseMimeType: "application/json", temperature: 0.3 },
    });
    const parsed = parse(r.text || "{}");
    return Response.json({ reply: parsed.reply, actions: sanitizeActions(parsed.actions, "chat", b.ctx, now.date) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("gemini error", e);
    return Response.json({ error: "ai failed" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
