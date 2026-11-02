/* Level Up: connects the frontend to Supabase, Google Calendar and Gemini.
   Loaded after the main app script. It reuses the app's globals (S, SK, render, ...). */
(function () {
  "use strict";
  const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  let SB = null, SESSION = null, U = null, READY = false, GCAL = false, GCAL_WHY = "", busy = false, lastJson = "", saveT = 0, syncing = false;
  let REV = 0, BASE = null, writeBusy = false, writeAgain = false, checkBusy = false, pendingRemote = null, syncChannel = null, syncWarned = false, lastRemoteNotice = 0;
  const G = { busy: {}, all: [], real: [], range: "" };
  const NF = new Set();
  const PERSIST = ["points","range","dark","snd","nid","q","mood","xp","tasks","hab","goals","taskMode","subSkills","subSkillProgress","skillMinutes","personalityLevelUpCounts","personalityAwardedEvents","skillCat","reminderSettings","planner","habArch","chat","jr","journalPage","log","dh","rt","joined","lc","mk","streak","tour","ms","py","ev","name","pd","simDifficulty","habitEditId","seasonHistory","activeSeasonMonth","seasonStartDate","simLastAccruedDate"];
  const DEF_RT = { wake: "07:00", sleep: "23:30", ws: "08:00", we: "22:00", busy: 0, bf: "09:00", bt: "16:00" };
  const COLORS = ["#ffd34d","#5ff0ff","#8dffc0","#ff8ac8","#c9bcff","#ff8a9a"];
  const ICONS = { Fitness: "FIT", Mindset: "MIND", Academics: "BOOK", Communication: "TALK", Personality: "" };

  /* ---------- helpers ---------- */
  const hm = (t) => { const [a, b] = String(t).split(":").map(Number); return a * 60 + b; };
  const mh = (n) => pad(Math.floor(n / 60) % 24) + ":" + pad(n % 60);
  const plusD = (d, k) => { const x = new Date(d + "T00:00"); x.setDate(x.getDate() + k); return iso(x); };
  const isWk = (d) => { const g = new Date(d + "T00:00").getDay(); return g > 0 && g < 6; };
  const nowInfo = () => { const n = new Date(); return { date: iso(n), time: pad(n.getHours()) + ":" + pad(n.getMinutes()), weekday: n.toLocaleDateString("en-US", { weekday: "long" }), tz: TZ }; };
  const api = (path, o = {}) => fetch(path, { ...o, headers: { "Content-Type": "application/json", ...(SESSION ? { Authorization: "Bearer " + SESSION.access_token } : {}) } });
  const span = (t) => dl(t.date) + ", " + fmtT(t.time) + "–" + fmtT(mh(hm(t.time) + t.min));
  const skName = (n) => Object.keys(SK).find((k) => k.toLowerCase() === String(n || "").toLowerCase()) || "Academics";
  const taskSkillName = (n, title) => { const key = Object.keys(SK).find((k) => k.toLowerCase() === String(n || "").toLowerCase()); if (["Tech","Academics","Communication"].includes(key)) return key; const text = String(title || "").toLowerCase(); return /call|email|reply|present|speak|meeting|message|friend|interview|discussion/.test(text) ? "Communication" : /code|program|debug|website|sql|python|javascript|algorithm|computer/.test(text) ? "Tech" : "Academics"; };
  const cap = (v, list, d) => list.find((x) => x.toLowerCase() === String(v || "").toLowerCase()) || d;
  const doneAll = () => S.tasks.filter((t) => t.done).length + (S.pd || 0);

  /* ---------- state ---------- */
  function freshState() {
    const first = ((S.name || "").split(" ")[0]) || "there";
    S.points = 0; S.nid = 1; S.tasks = []; S.goals = []; S.taskMode = "ai"; S.subSkills = {}; S.subSkillProgress = {}; S.skillMinutes = { Academics: 0, Tech: 0, Communication: 0 }; S.personalityLevelUpCounts = {}; S.personalityAwardedEvents = []; S.skillCat = "Academics"; S.reminderSettings = { enabled: false, leadMinutes: 10, dailyEnabled: false, dailyTime: "20:00" }; S.jr = []; S.log = []; S.dh = {}; S.habArch = {}; S.ev = {}; S.pd = 0; S.streak = 0;
    S.xp = {}; Object.keys(SK).forEach((k) => (S.xp[k] = 0));
    S.mk = TODAY.slice(0, 7); S.joined = TODAY; S.lc = plusD(TODAY, -1); S.rt = { ...DEF_RT }; S.tour = false; S.ms = "";
    S.hab = HB.map((h) => ({ i: h[0], n: h[1], sk: h[2], c: h[3], d: Array.from({ length: dim }, () => null), cr: TODAY, st: 0 }));
    S.chat = [{ r: "ai", t: `Hi ${first}! Tell me what to plan, like “study DBMS 1 hour” or “I have a quiz next week”.` }];
  }
  function applyState(row) {
    const o = row.S || {};
    PERSIST.forEach((k) => { if (o[k] !== undefined) S[k] = o[k]; });
    if (row.SK && Object.keys(row.SK).length) { Object.keys(row.SK).forEach((k) => { if (SK[k] && row.SK[k] && typeof row.SK[k] === "object") SK[k] = { ...SK[k], ...row.SK[k] }; }); }
    if (row.ac) document.documentElement.style.setProperty("--ac", row.ac);
  }
  function normalise() {
    S.rt = { ...DEF_RT, ...(S.rt || {}) };
    S.dh = S.dh || {}; S.ev = S.ev || {}; S.habArch = S.habArch || {}; S.goals = Array.isArray(S.goals) ? S.goals : []; S.taskMode = S.taskMode || "ai"; S.subSkills = S.subSkills && typeof S.subSkills === "object" ? S.subSkills : {}; S.subSkillProgress = S.subSkillProgress && typeof S.subSkillProgress === "object" ? S.subSkillProgress : {}; S.skillMinutes = { Academics: 0, Tech: 0, Communication: 0, ...(S.skillMinutes || {}) }; S.personalityLevelUpCounts = S.personalityLevelUpCounts && typeof S.personalityLevelUpCounts === "object" ? S.personalityLevelUpCounts : {}; S.personalityAwardedEvents = Array.isArray(S.personalityAwardedEvents) ? S.personalityAwardedEvents : []; S.skillCat = S.skillCat || "Academics"; S.reminderSettings = { enabled: false, leadMinutes: 10, dailyEnabled: false, dailyTime: "20:00", ...(S.reminderSettings || {}) }; S.planner = { date: TODAY, energy: "normal", hours: 4, start: "08:00", end: "22:00", includeCarryover: true, preview: null, status: "", ...(S.planner || {}) }; if (!/^\d{4}-\d{2}-\d{2}$/.test(S.planner.date) || S.planner.date < TODAY) S.planner.date = TODAY; S.streak = S.streak || 0;
    S.mk = S.mk || TODAY.slice(0, 7); S.joined = S.joined || TODAY; S.lc = S.lc || plusD(TODAY, -1);
    Object.keys(SK).forEach((k) => { if (S.xp[k] == null) S.xp[k] = 0; });
    S.tasks.forEach((t) => { delete t.diff; if (!t.date) t.date = TODAY; S.nid = Math.max(S.nid || 1, (t.id || 0) + 1); });
    S.hab.forEach((h, i) => { if (!h.cr) h.cr = S.joined; if (h.st == null) h.st = 0; if (!SK[h.sk]) h.sk = "Personality"; h.hid = h.hid || ("habit-" + String(h.cr || S.joined || TODAY) + "-" + String(h.n || "") + "-" + i); h.restDays = Array.isArray(h.restDays) ? [...new Set(h.restDays.map(Number).filter(n => n >= 0 && n <= 6))] : []; h.streakShields = Math.max(0, Math.floor(Number(h.streakShields) || 0)); h.shieldedDays = Array.isArray(h.shieldedDays) ? h.shieldedDays : []; h.streakShieldRewards = Array.isArray(h.streakShieldRewards) ? h.streakShieldRewards : []; h.streakShieldMilestone = Math.max(0, Math.floor(Number(h.streakShieldMilestone) || 0)); });
    S.journalPage = Math.max(0, Math.floor(Number(S.journalPage) || 0)); S.cv = S.cv || "month"; S.hf = "all"; S.aiopen = false; S.cq = S.cq || "";
  }
  function payload() {
    const s = {}; PERSIST.forEach((k) => (s[k] = S[k]));
    return { S: s, SK, ac: document.documentElement.style.getPropertyValue("--ac") || "" };
  }
  function applyXpProfile(profile, persist = true) {
    if (!profile || typeof profile !== "object") return false;
    let changed = false;
    const pts = Number(profile.points);
    if (Number.isFinite(pts) && pts >= 0 && Math.floor(pts) !== Number(S.points)) {
      S.points = Math.max(0, Math.min(10000000, Math.floor(pts)));
      changed = true;
    }
    const canonical = profile.skill_xp && typeof profile.skill_xp === "object" && !Array.isArray(profile.skill_xp)
      ? profile.skill_xp : {};
    const keys = new Set([...Object.keys(SK), ...Object.keys(canonical)]);
    for (const key of keys) {
      if (!SK[key]) continue;
      // The new skill model derives Academics/Tech/Communication from minutes and
      // Mindset/Fitness from editable habit checkmarks. Do not overwrite those local
      // counters with the legacy profile XP ledger; Personality remains server-authoritative.
      if (key !== "Personality") continue;
      const n = Number(canonical[key]);
      const value = Number.isFinite(n) ? Math.max(0, Math.min(10000000, Math.floor(n))) : 0;
      if (Number(S.xp[key] || 0) !== value) changed = true;
      S.xp[key] = value;
    }
    if (typeof profile.name === "string" && profile.name.trim() && S.name !== profile.name) {
      S.name = profile.name.slice(0, 80);
      changed = true;
    }
    if (changed && persist && READY) save();
    return changed;
  }

  /* ---------- safe multi-device state sync ---------- */
  const clone = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const stableStringify = (v) => JSON.stringify(v, (_, x) => x && typeof x === "object" && !Array.isArray(x)
    ? Object.keys(x).sort().reduce((o, k) => { o[k] = x[k]; return o; }, {}) : x);
  const same = (a, b) => stableStringify(a) === stableStringify(b);
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  function entityKey(path, item) {
    if (!isObj(item)) return null;
    if (path.endsWith(".tasks") && item.id != null) return "id:" + item.id;
    if (path.endsWith(".goals") && item.created != null) return "created:" + item.created;
        if (path.endsWith(".jr") && item.id != null) return "id:" + item.id;
    if (path.endsWith(".hab")) return "habit:" + [item.cr || "", item.sk || "", item.n || "", item.i || ""].join("|");
    if (path.endsWith(".log") && item.t != null) return "t:" + item.t;
    return null;
  }
  function keyedArrayMerge(base, local, remote, path) {
    const all = [...new Set([...base, ...local, ...remote].map(x => entityKey(path, x)).filter(Boolean))];
    // Only use identity-based merging when every item on all sides has a stable key.
    if (!all.length || [...base, ...local, ...remote].some(x => !entityKey(path, x))) return null;
    const bm = new Map(base.map(x => [entityKey(path, x), x]));
    const lm = new Map(local.map(x => [entityKey(path, x), x]));
    const rm = new Map(remote.map(x => [entityKey(path, x), x]));
    const order = [...local.map(x => entityKey(path, x)), ...remote.map(x => entityKey(path, x))];
    const merged = new Map();
    for (const key of all) {
      const v = merge3(bm.get(key), lm.get(key), rm.get(key), path + "[" + key + "]");
      if (v !== undefined) merged.set(key, v);
    }
    return [...new Set(order)].filter(k => merged.has(k)).map(k => merged.get(k));
  }
  function isPrefix(a, b) { return a.length <= b.length && a.every((x, i) => same(x, b[i])); }
  function isSuffix(a, b) { return a.length <= b.length && a.every((x, i) => same(x, b[b.length - a.length + i])); }
  function merge3(base, local, remote, path = "") {
    if (same(local, base)) return clone(remote);
    if (same(remote, base) || same(local, remote)) return clone(local);
    if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
      const keyed = keyedArrayMerge(base, local, remote, path);
      if (keyed) return keyed;
      // Preserve concurrent additions to chat/history arrays instead of choosing one device.
      if (isPrefix(base, local) && isPrefix(base, remote)) {
        const out = [...base];
        for (const item of [...local.slice(base.length), ...remote.slice(base.length)]) if (!out.some(x => same(x, item))) out.push(clone(item));
        return out.slice(-Math.max(250, base.length));
      }
      if (base.length && isSuffix(base, local) && isSuffix(base, remote)) {
        const additions = [...local.slice(0, local.length - base.length), ...remote.slice(0, remote.length - base.length)];
        const unique = additions.filter((x, i) => additions.findIndex(y => same(x, y)) === i);
        return [...unique, ...base.map(clone)].slice(0, Math.max(500, base.length));
      }
      const out = [];
      const n = Math.max(base.length, local.length, remote.length);
      for (let i = 0; i < n; i++) {
        const v = merge3(base[i], local[i], remote[i], path + "[" + i + "]");
        if (v !== undefined) out[i] = v;
      }
      return out;
    }
    if (isObj(base) && isObj(local) && isObj(remote)) {
      const out = {};
      const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
      for (const k of keys) {
        const v = merge3(base[k], local[k], remote[k], path ? path + "." + k : k);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    // Same-field simultaneous edits are inherently ambiguous; keep this device's edit,
    // while the surrounding merge still retains changes to unrelated fields/records.
    return clone(local);
  }
  function applyRemoteState(remoteState) {
    if (!remoteState || !remoteState.S) return;
    applyState(remoteState);
    normalise();
  }
  function refreshSyncBase(state, revision) {
    BASE = clone(state); REV = Number(revision) || 0; lastJson = stableStringify(BASE);
  }
  function pendingKey() { return U && U.id ? "levelup.pending.v2:" + U.id : null; }
  function readPending() {
    const key = pendingKey(); if (!key) return null;
    try { const item = JSON.parse(localStorage.getItem(key) || "null"); return item && item.state && item.state.S ? item : null; }
    catch (_) { return null; }
  }
  function cachePending() {
    const key = pendingKey(); if (!key) return;
    try { localStorage.setItem(key, JSON.stringify({ state: payload(), base: BASE, revision: REV, at: Date.now() })); } catch (_) {}
  }
  function clearPendingIfClean() {
    const key = pendingKey(); if (!key) return;
    if (stableStringify(payload()) === lastJson) { try { localStorage.removeItem(key); } catch (_) {} }
    else cachePending();
  }
  function incomingRemote(row) {
    if (!READY || !row || !row.state || !Number.isFinite(Number(row.revision))) return;
    const r = Number(row.revision);
    if (r <= REV) return;
    if (writeBusy) {
      if (!pendingRemote || Number(pendingRemote.revision) < r) pendingRemote = row;
      return;
    }
    const local = payload();
    const wasDirty = stableStringify(local) !== lastJson;
    const merged = BASE ? merge3(BASE, local, row.state) : clone(row.state);
    refreshSyncBase(row.state, r);
    applyRemoteState(merged);
    const after = payload();
    if (stableStringify(after) !== lastJson) save();
    if (stableStringify(after) !== stableStringify(local)) {
      render();
      const now = Date.now();
      if (now - lastRemoteNotice > 15000) {
        toast(wasDirty ? "Synced updates from both devices" : "Updated from your other device");
        lastRemoteNotice = now;
      }
    }
  }
  async function pollState() {
    if (!READY || !SB || checkBusy || !U) return;
    checkBusy = true;
    try {
      const { data, error } = await SB.from("user_state").select("state,revision,updated_at").eq("user_id", U.id).maybeSingle();
      if (error) throw error;
      if (data) incomingRemote(data);
    } catch (e) { console.warn("Level Up sync check failed", e); }
    finally { checkBusy = false; }
  }
  function startStateSync() {
    if (syncChannel) { try { SB.removeChannel(syncChannel); } catch (e) {} }
    try {
      syncChannel = SB.channel("user-state-" + U.id)
        .on("postgres_changes", { event: "*", schema: "public", table: "user_state", filter: "user_id=eq." + U.id }, (event) => incomingRemote(event.new))
        .subscribe();
    } catch (e) { console.warn("Realtime unavailable; periodic sync remains enabled", e); }
    setInterval(pollState, 20000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { pollState(); flush(); } });
    window.addEventListener("online", () => { pollState(); flush(); });
  }
  save = function () {
    if (!READY) return;
    clearTimeout(saveT);
    if (stableStringify(payload()) === lastJson) { clearPendingIfClean(); return; }
    cachePending();
    saveT = setTimeout(flush, 900);
  };
  async function flush() {
    if (!READY || !SB || !U) return;
    if (writeBusy) { writeAgain = true; return; }
    clearTimeout(saveT);
    writeBusy = true;
    try {
      let attempts = 0;
      while (attempts < 5) {
        const p = payload(), j = stableStringify(p);
        if (j === lastJson) break;
        const { data, error } = await SB.rpc("save_user_state", { p_state: p, p_expected_revision: REV });
        if (error) throw error;
        const result = Array.isArray(data) ? data[0] : data;
        if (result && result.saved) {
          refreshSyncBase(result.state || p, result.revision);
          try {
            const xpResponse = await api("/api/xp/sync", { method: "POST", body: JSON.stringify({}) });
            const xpResult = await xpResponse.json().catch(() => ({}));
            if (xpResponse.ok && xpResult.me) {
              const profileChanged = applyXpProfile(xpResult.me, false);
              if (profileChanged) {
                // Update profile/leaderboard-facing counters immediately after server reconciliation.
                try { render(); } catch (_) {}
              }
            } else console.warn("Secure XP sync is unavailable; run the latest supabase/schema.sql.", xpResult.error || xpResponse.status);
          } catch (e) { console.warn("Secure XP sync failed.", e); }
          if (stableStringify(payload()) !== lastJson) writeAgain = true;
          break;
        }
        // Stale revision: merge the local changes onto the latest remote document and retry.
        if (result && result.state && Number.isFinite(Number(result.revision))) {
          const localNow = payload();
          const merged = BASE ? merge3(BASE, localNow, result.state) : clone(result.state);
          refreshSyncBase(result.state, result.revision);
          applyRemoteState(merged);
          if (stableStringify(payload()) !== stableStringify(localNow)) render();
          attempts++;
          continue;
        }
        // Row was removed elsewhere; retry as a first insert on the next pass.
        REV = 0; BASE = null; lastJson = ""; attempts++;
      }
      if (attempts >= 5 && stableStringify(payload()) !== lastJson) throw new Error("State changed repeatedly while saving. Please retry.");
      clearPendingIfClean();
    } catch (e) {
      console.error("Level Up multi-device save failed", e);
      if (!syncWarned) {
        syncWarned = true;
        toast(String(e && e.message || "Sync error").includes("save_user_state") ? "Run the latest supabase/schema.sql to enable safe sync" : "Could not sync right now; your changes will retry on the next save");
      }
      // Keep a per-user recovery copy so pending edits survive a browser reload/offline period.
      cachePending();
      // Retry on the next save action or when the app returns online/visible; do not spin in a loop.
      writeAgain = false;
    } finally {
      writeBusy = false;
      if (pendingRemote) { const pending = pendingRemote; pendingRemote = null; incomingRemote(pending); }
      if (writeAgain) { writeAgain = false; save(); }
    }
    syncCal();
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });

  /* ---------- day close: failed tasks, missed habits, bonuses ---------- */
  function ensureGrid(mk) {
    if (S.mk === mk) return;
    S.habArch[S.mk] = S.hab.map((h) => ({ hid: h.hid, n: h.n, sk: h.sk, ss: h.ss, restDays: h.restDays, streakShields: h.streakShields, shieldedDays: h.shieldedDays, streakShieldMilestone: h.streakShieldMilestone, streakShieldRewards: h.streakShieldRewards, progressSubskillByDay: h.progressSubskillByDay, progressTicksLogged: h.progressTicksLogged, personalityBonusAwarded: h.personalityBonusAwarded, skillLevelUps: h.skillLevelUps, personalityLevelUpAt: h.personalityLevelUpAt, d: h.d }));
    const [y, m] = mk.split("-").map(Number), n = new Date(y, m, 0).getDate();
    S.hab.forEach((h) => { h.d = Array.from({ length: n }, () => null); });
    S.mk = mk;
  }
  function closeDays() {
    let delta = 0, failed = 0, missed = 0, bonus = 0, d = plusD(S.lc, 1);
    while (d < TODAY) {
      ensureGrid(d.slice(0, 7));
      const i = +d.slice(8) - 1, dayT = S.tasks.filter((t) => t.date === d);
      dayT.forEach((t) => { if (!t.done && !t.fail) { t.fail = true; delta -= 2 * P(t); failed++; logA("task", "Missed “" + t.t + "”"); } });
      const earnedD = S.tasks.filter((t) => t.done && t.dd === d).reduce((a, t) => a + P(t), 0);
      let hb = 0;
      S.hab.forEach((h) => {
        const rest = typeof isHabitRestDate === "function" && isHabitRestDate(h, d);
        if (h.d[i] == null && rest) { h.d[i] = 2; }
        else if (h.d[i] == null && h.cr && d > h.cr) {
          const protectedByShield = typeof protectHabitMiss === "function" && protectHabitMiss(h, d);
          if (!protectedByShield) { h.d[i] = 0; delta -= 7; missed++; h.st = 0; h.streakShieldMilestone = 0; }
        }
        if (h.d[i] === 1) { h.st = (h.st || 0) + 1; hb += 0.1 * h.st; }
        else if (h.d[i] === 0) { h.st = 0; h.streakShieldMilestone = 0; }
        // Rest and shielded days are neutral: preserve continuity without a tick or penalty.
      });
      if (dayT.length) {
        const ok = dayT.filter((t) => t.done).length / dayT.length >= 0.7;
        S.streak = ok ? S.streak + 1 : 0;
        if (ok) { const b1 = Math.round(earnedD * Math.min(0.5, 0.1 * S.streak)); delta += b1; bonus += b1; }
      }
      const b2 = Math.round(earnedD * hb); delta += b2; bonus += b2;
      d = plusD(d, 1);
    }
    ensureGrid(TODAY.slice(0, 7));
    S.lc = plusD(TODAY, -1);
    if (!S.py || S.py.d !== TODAY) S.py = { d: TODAY, p: S.points + delta };
    if (delta || failed || missed) {
      logA("day", "Past days closed: " + (delta >= 0 ? "+" : "−") + Math.abs(delta) + " trophies (" + failed + " missed tasks, " + missed + " missed habits, " + bonus + " bonus)");
      setTimeout(() => toast("Past days closed: " + (delta >= 0 ? "+" : "−") + Math.abs(delta) + " TROPHIES"), 1800);
      setPoints(S.points + delta);
    }
    // keep the task list light: archive old finished tasks
    const cut = plusD(TODAY, -60);
    const old = S.tasks.filter((t) => t.date < cut && (t.done || t.fail));
    if (old.length) { S.pd = (S.pd || 0) + old.filter((t) => t.done).length; S.tasks = S.tasks.filter((t) => !old.includes(t)); }
  }

  /* ---------- history, habit xp, done date ---------- */
  const _tog = tog;
  tog = function (id) {
    const t = S.tasks.find((x) => x.id === id), was = t && t.done, dd0 = t && t.dd;
    _tog(id);
    if (!t) return;
    if (t.done && !was) { t.dd = typeof localToday === "function" ? localToday() : TODAY; t.completedAt = t.completedAt || new Date().toISOString(); hist(t.dd, t.sk, 1); }
    else if (!t.done && was) { hist(dd0 || TODAY, t.sk, -1); /* retain completion date/timestamp for cumulative daily accounting */ }
    save();
  };
  function hist(d, sk, n) { const o = (S.dh[d] = S.dh[d] || {}); o[sk] = Math.max(0, (o[sk] || 0) + n); }
  const _hc = hcell;
  hcell = function (hi, day) { _hc(hi, day); save(); };
  taskGraph = function () {
    const n = S.range, days = Array.from({ length: n }, (_, i) => addD(i - (n - 1)));
    const ser = Object.keys(SK).map((k) => ({ c: SK[k].c, v: days.map((d) => (S.dh[d] && S.dh[d][k]) || 0) }));
    return `<div class="row between" style="margin-bottom:10px"><span class="mu">Tasks done per day</span><div class="seg">${[7, 30, 90].map((v) => `<button data-rg="${v}" aria-pressed="${S.range == v}">${v}D</button>`).join("")}</div></div>${line(ser, days.map((d, i) => (i == n - 1 ? "Today" : n - 1 - i + "d ago")))}<div class="lg">${Object.keys(SK).map((k) => `<span><i class="dot" style="background:${SK[k].c}"></i>${k}</span>`).join("")}</div>`;
  };

  /* ---------- Google Calendar ---------- */
  function gcalWhy(r) {
    const m = { no_token: "No Google login is saved yet. Press CONNECT and allow calendar access.", server_not_configured: "The server is missing SUPABASE_SERVICE_ROLE_KEY.", storage_error: "The google_tokens table could not be read. Run supabase/schema.sql in Supabase.", google_client_not_configured: "The server is missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.", refresh_failed: "Google rejected the saved login (it may have expired). Press RECONNECT.", google_403: "Google Calendar API is not enabled for your Google Cloud project, or calendar access was not granted.", google_401: "Google rejected the saved login. Press RECONNECT." };
    return r ? (m[r] || "Google Calendar returned: " + r) : "";
  }
  async function loadGev(from, to) {
    if (!SESSION) return;
    try {
      const r = await api(`/api/gcal?from=${encodeURIComponent(new Date(from + "T00:00").toISOString())}&to=${encodeURIComponent(new Date(to + "T23:59").toISOString())}`);
      const j = await r.json(); GCAL = !!j.connected; GCAL_WHY = GCAL ? "" : String(j.reason || "");
      if (!GCAL) return;
      G.all = j.events; G.busy = {};
      j.events.forEach((e) => {
        if (e.allDay || e.app) return;
        const s = new Date(e.start), en = new Date(e.end), d = iso(s), a = s.getHours() * 60 + s.getMinutes();
        const b = iso(en) === d ? en.getHours() * 60 + en.getMinutes() : 1440;
        (G.busy[d] = G.busy[d] || []).push([a, Math.max(b, a + 5)]);
      });
      G.range = from + "|" + to;
    } catch (e) { /* offline: plan without Google events */ }
  }
  async function syncCal() {
    if (!GCAL || syncing || !SESSION) return;
    syncing = true;
    try {
      let n = 0;
      const ids = new Set(S.tasks.map((t) => String(t.id)));
      for (const k of Object.keys(S.ev)) {
        if (ids.has(k) || n >= 20) continue;
        n++; const r = await api("/api/gcal", { method: "POST", body: JSON.stringify({ op: "delete", ev: S.ev[k].e }) });
        if (r.ok) delete S.ev[k];
      }
      const lim = plusD(TODAY, -7);
      for (const t of S.tasks) {
        if (n >= 20) break;
        if (!t.time || !t.date || t.fail || t.calendarSyncPending || t.date < lim) continue;
        const h = [t.t, t.date, t.time, t.min, !!t.done, t.sk, P(t)].join("|"), cur = S.ev[t.id];
        if (cur && cur.h === h) continue;
        n++;
        const r = await api("/api/gcal", { method: "POST", body: JSON.stringify({ op: "upsert", task: { id: t.id, t: t.t, date: t.date, time: t.time, min: t.min, sk: t.sk, pri: t.pri, pts: P(t), done: !!t.done, ev: cur && cur.e, tz: TZ } }) });
        const j = await r.json();
        if (j.connected === false) { GCAL = false; break; }
        if (j.ev) S.ev[t.id] = { e: j.ev, h };
      }
      if (n) { lastJson = ""; save(); }
    } catch (e) { /* try again on next save */ }
    syncing = false;
  }

  /* ---------- scheduler: finds a real free slot ---------- */
  const WIN = { morning: [[360, 720]], afternoon: [[720, 1080]], evening: [[1200, 1320], [1080, 1320]], night: [[1260, 1380]] };
  const PREF = { Academics: ["evening", "afternoon"], Fitness: ["morning", "evening"], Communication: ["afternoon", "morning"], Mindset: ["morning", "night"], Personality: ["afternoon", "evening"] };
  function busyOn(d, skip) {
    const b = [];
    S.tasks.forEach((t) => { if (t.id !== skip && t.date === d && t.time && !t.done && !t.fail) b.push([hm(t.time), hm(t.time) + t.min]); });
    (G.busy[d] || []).forEach((x) => b.push(x));
    if (S.rt.busy && isWk(d)) b.push([hm(S.rt.bf), hm(S.rt.bt)]);
    return b.sort((x, y) => x[0] - y[0]);
  }
  function fit(d, min, lo, hi, skip) {
    const BR = 15; let c = Math.ceil(lo / 15) * 15;
    for (const [s, e] of busyOn(d, skip)) {
      if (e + BR <= c) continue;
      if (c + min + BR <= s) break;
      c = Math.max(c, Math.ceil((e + BR) / 15) * 15);
    }
    return c + min <= hi ? c : -1;
  }
  function slot(d, min, sk, win, skip) {
    const ws = hm(S.rt.ws), we = hm(S.rt.we); let lo = ws;
    if (d === TODAY) { const n = new Date(); lo = Math.max(lo, Math.ceil((n.getHours() * 60 + n.getMinutes() + 10) / 15) * 15); }
    for (const w of [win, ...(PREF[sk] || ["afternoon", "evening"])].filter((x) => WIN[x])) {
      for (const [wa, wb] of WIN[w]) {
        const a = Math.max(lo, wa), b = Math.min(we, wb);
        if (b - a >= min) { const c = fit(d, min, a, b, skip); if (c >= 0) return c; }
      }
    }
    return fit(d, min, lo, we, skip);
  }
  function place(t, win) {
    const from = t.date;
    for (let k = 0; k < 21; k++) {
      const d = plusD(from, k);
      // realism: no more than 6h of study (10h of anything) planned on one day
      const load = S.tasks.filter((x) => x.id !== t.id && x.date === d && x.time && !x.done && !x.fail && (t.sk !== "Academics" || x.sk === "Academics")).reduce((a, x) => a + x.min, 0);
      if (load + t.min > (t.sk === "Academics" ? 360 : 600) && t.min < 360) continue;
      const c = slot(d, t.min, t.sk, win, t.id);
      if (c >= 0) { t.date = d; t.time = mh(c); t.due = dueLabel(d); return d !== from; }
    }
    t.date = from; t.time = null; return false;
  }
  window.__rescheduleMissedTask = async function (taskId) {
    const task = S.tasks.find(x => String(x.id) === String(taskId));
    if (!task) return toast("Task no longer exists.");
    const original = { date: task.date, time: task.time, fail: task.fail };
    try {
      if (GCAL) await loadGev(TODAY, plusD(TODAY, 1));
      const days = [TODAY, plusD(TODAY, 1)];
      const min = Math.max(1, Math.min(480, Number(task.min) || 30));
      let picked = null;
      for (const day of days) {
        const start = day === TODAY ? Math.max(hm(S.rt.ws), Math.ceil((new Date().getHours()*60 + new Date().getMinutes() + 10)/15)*15) : hm(S.rt.ws);
        const end = hm(S.rt.we);
        const load = S.tasks.filter(x => String(x.id) !== String(task.id) && x.date === day && x.time && !x.done && !x.fail).reduce((sum,x)=>sum+(Number(x.min)||30),0);
        if (load + min > Math.max(120,(Number(S.planner && S.planner.hours)||4)*60)) continue;
        const slotAt = fit(day, min, start, end, task.id);
        if (slotAt >= 0) { picked = { day, at: slotAt }; break; }
      }
      if (!picked) { toast("No free slot found today or tomorrow. Try editing the time manually."); return; }
      task.date = picked.day; task.time = mh(picked.at); task.due = dueLabel(picked.day); task.fail = false; task.done = false; task.rescheduledAt = new Date().toISOString();
      task.rescheduledFrom = original.date || null; logA("task", "Rescheduled missed task “" + task.t + "” to " + whenText(task)); save();
      await syncCal(); render(); toast("Task rescheduled to " + whenText(task));
    } catch (error) { task.date=original.date; task.time=original.time; task.fail=original.fail; console.warn("Could not reschedule missed task",error); toast("Could not find or save an available slot."); }
  };

  /* ---------- AI ---------- */
  function ctx() {
    const open = S.tasks.filter((t) => !t.done && !t.fail).slice(0, 60).map((t) => ({ id: t.id, t: t.t, sk: t.sk, date: t.date, time: t.time || null, min: t.min, pri: t.pri, due: t.due || null, note: t.note || null }));
    const busyL = []; Object.keys(G.busy).sort().slice(0, 21).forEach((d) => G.busy[d].forEach((x) => busyL.push({ d, from: mh(x[0]), to: mh(Math.min(x[1], 1439)) })));
    const recent = S.tasks.filter((t) => t.done && (t.dd || t.date) >= plusD(TODAY, -6) && (t.dd || t.date) <= TODAY).slice(0, 40).map((t) => ({ t: t.t, sk: t.sk, min: t.min, date: t.dd || t.date }));
    return { name: S.name, skills: Object.keys(SK).map((k) => ({ n: k, w: SK[k].w })), tasks: open, recentCompletedTasks: recent, goals: (S.goals || []).map((g) => ({ name: g.name, date: g.date || null, done: !!g.done })), habits: S.hab.map((h) => ({ n: h.n, sk: h.sk, todayDone: h.d && h.d[td - 1] === 1, streak: streak(h) })), routine: S.rt, googleCalendarConnected: GCAL, googleBusy: busyL.slice(0, 55), doneToday: S.tasks.filter((t) => t.done && (t.dd === TODAY || t.date === TODAY)).length };
  }
  async function askAI(text) {
    await loadGev(TODAY, plusD(TODAY, 21));
    const r = await api("/api/ai", { method: "POST", body: JSON.stringify({ mode: "chat", text, now: nowInfo(), ctx: ctx(), history: S.chat.slice(-8, -2).map((m) => ({ r: m.r, t: m.t })) }) });
    if (!r.ok) throw new Error("ai " + r.status);
    return r.json();
  }
  function plannerSettings() {
    S.planner = { date: TODAY, energy: "normal", hours: 4, start: "08:00", end: "22:00", includeCarryover: true, preview: null, status: "", ...(S.planner || {}) };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(S.planner.date) || S.planner.date < TODAY) S.planner.date = TODAY;
    S.planner.hours = Math.max(2, Math.min(18, Number(S.planner.hours) || 4));
    S.planner.energy = ["low", "normal", "high"].includes(S.planner.energy) ? S.planner.energy : "normal";
    return S.planner;
  }
  function plannerWeekday(d) { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" }); }
  function plannerContext(d, p) {
    const carry = (S.tasks || []).filter(t => !t.done && !t.fail && ((t.date === d && !t.time) || (p.includeCarryover && t.date < d)));
    const fixed = (S.tasks || []).filter(t => !t.done && !t.fail && t.date === d && t.time).map(t => ({ id: t.id, title: t.t, from: t.time, to: mh(Math.min(1439, hm(t.time) + (+t.min || 0))), minutes: t.min }));
    const habits = (S.hab || []).map(h => ({ name: h.n, skill: h.sk, doneToday: h.d && h.d[td - 1] === 1, streak: streak(h) }));
    const recentDone = (S.tasks || []).filter(t => t.done && (t.dd || t.date) >= plusD(TODAY, -6) && (t.dd || t.date) <= TODAY).slice(0, 25).map(t => ({ name: t.t, skill: t.sk, minutes: t.min, date: t.dd || t.date }));
    const busy = [];
    Object.keys(G.busy).forEach(day => (G.busy[day] || []).forEach(([a,b]) => busy.push({ date: day, start: mh(a), end: mh(Math.min(1439,b)) })));
    return {
      name: S.name,
      targetDate: d,
      weekday: plannerWeekday(d),
      plannerPreferences: { energy: p.energy, maxWorkHours: p.hours, startNoEarlierThan: p.start, finishBy: p.end, includeOverdueAndUnscheduled: !!p.includeCarryover },
      skills: Object.keys(SK).map(k => ({ name: k, weight: SK[k].w })),
      candidateTasks: carry.slice(0, 40).map(t => ({ id: t.id, title: t.t, skill: t.sk, date: t.date, time: t.time || null, minutes: t.min, priority: t.pri || "Normal", due: t.due || null, note: t.note || null })),
      alreadyScheduledOnTargetDate: fixed,
      unfinishedGoals: (S.goals || []).filter(g => !g.done).slice(0, 20).map(g => ({ name: g.name, targetDate: g.date || null })),
      habits,
      recentCompletionsLast7Days: recentDone,
      routine: S.rt,
      googleCalendarConnected: GCAL,
      calendarBusy: busy.filter(x => x.date === d).slice(0, 30),
    };
  }
  function localDailyPlan(d, p) {
    const open = (S.tasks || []).filter(t => !t.done && !t.fail && (t.date === d || (p.includeCarryover && t.date < d)) && !(t.date === d && t.time));
    open.sort((a,b) => (a.date < d ? -100 : 0) - (b.date < d ? -100 : 0) || ({High:0,Normal:1,Low:2}[a.pri] ?? 1) - ({High:0,Normal:1,Low:2}[b.pri] ?? 1) || (P(b)-P(a)));
    const busy = busyOn(d).map(x => [x[0], x[1]]), planned = [], actions = [];
    let start = Math.max(hm(p.start || "08:00"), S.rt && S.rt.ws ? hm(S.rt.ws) : 0);
    if (d === TODAY) { const n = new Date(); start = Math.max(start, Math.ceil((n.getHours()*60+n.getMinutes()+10)/15)*15); }
    const end = Math.min(hm(p.end || "22:00"), S.rt && S.rt.we ? hm(S.rt.we) : 1440), budget = Math.max(60, (+p.hours || 4) * 60);
    let used = (S.tasks || []).filter(t => !t.done && !t.fail && t.date === d && t.time).reduce((n,t)=>n+(+t.min||0),0);
    const maxTasks = p.energy === "low" ? 3 : p.energy === "high" ? 7 : 5;
    function placeOne(min) {
      for (let at = Math.ceil(start/15)*15; at + min <= end; at += 15) {
        const collision = [...busy, ...planned].some(([a,b]) => at < b + 10 && at + min + 10 > a);
        if (!collision) return at;
      }
      return -1;
    }
    for (const t of open) {
      if (actions.length >= maxTasks || used + (+t.min || 30) > budget) continue;
      const min = Math.max(15, Math.min(p.energy === "low" ? 60 : 90, +t.min || 30));
      const at = placeOne(min); if (at < 0) continue;
      const time = mh(at); planned.push([at, at + min]); used += min;
      actions.push({ a: "move", id: t.id, date: d, time, win: null });
    }
    // Turn an unfinished goal into one small, explicit next step if the day has room.
    const goals = (S.goals || []).filter(g => !g.done && !(S.tasks || []).some(t => !t.fail && norm(t.t).includes(norm(g.name).slice(0, Math.min(18, norm(g.name).length)))));
    for (const g of goals.slice(0, p.energy === "low" ? 1 : 2)) {
      if (actions.length >= maxTasks || used + 30 > budget) break;
      const at = placeOne(30); if (at < 0) break;
      const nm = String(g.name || "personal goal");
      const skill = taskSkillName("", nm);
      planned.push([at, at + 30]); used += 30;
      actions.push({ a: "add", t: "Goal step: " + nm, sk: skill, pri: "High", min: 30, date: d, time: mh(at), win: null, note: "A small next step toward: " + nm });
    }
    const habitsOpen = (S.hab || []).filter(h => h.d && h.d[td - 1] !== 1).length;
    const reply = actions.length ? `I prioritized ${actions.length} realistic block${actions.length===1?"":"s"} within your ${p.hours}-hour work limit. ${habitsOpen ? `${habitsOpen} habit check-in${habitsOpen===1?" is":"s are"} still open, so leave a little room for them.` : "Your habit check-ins look up to date for today."}` : "I could not fit more work into this window without overloading the day. Check the time window or add tasks and goals first.";
    return { reply, actions };
  }
  async function generateDailyPlan(useAI) {
    const p = plannerSettings(), d = p.date || TODAY;
    if (hm(p.end) <= hm(p.start)) { p.status = "Finish time must be later than the start time."; p.preview = null; save(); render(); return; }
    p.status = "building"; p.preview = null; save(); render();
    try {
      await loadGev(d, d);
      let out = null, source = "local";
      if (useAI) {
        const n = nowInfo();
        const r = await api("/api/ai", { method: "POST", body: JSON.stringify({ mode: "plan", targetDate: d, planner: { energy: p.energy, hours: p.hours, start: p.start, end: p.end, includeCarryover: !!p.includeCarryover }, now: n, ctx: plannerContext(d,p) }) });
        if (!r.ok) throw new Error("AI unavailable");
        out = await r.json();
        if (!out || !Array.isArray(out.actions)) throw new Error("The AI returned an invalid plan");
        // Validate the preview independently of the model: no past/future-day surprises,
        // no overlaps with existing calendar commitments, and no overload beyond the user's limit.
        const validClock = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
        const winStart = Math.max(hm(p.start), S.rt && S.rt.ws ? hm(S.rt.ws) : 0, d === TODAY ? Math.ceil((new Date().getHours()*60 + new Date().getMinutes() + 10)/15)*15 : 0);
        const winEnd = Math.min(hm(p.end), S.rt && S.rt.we ? hm(S.rt.we) : 1440);
        const reserved = busyOn(d).map(([a,b]) => [a,b]);
        let plannedMins = (S.tasks || []).filter(t => !t.done && !t.fail && t.date === d && t.time).reduce((sum,t) => sum + (+t.min || 0), 0);
        const seenIds = new Set(), accepted = [];
        const candidateActions = out.actions.slice().sort((a,b) => String(a && a.time || "99:99").localeCompare(String(b && b.time || "99:99")));
        for (const a of candidateActions) {
          if (!a || !["add","move"].includes(a.a) || !/^\d{4}-\d{2}-\d{2}$/.test(a.date || "") || a.date !== d || !validClock(a.time)) continue;
          const begin = hm(a.time);
          let task = null, duration = Math.max(1, Math.min(240, Math.round(+a.min || 30)));
          if (a.a === "move") {
            task = S.tasks.find(x => String(x.id) === String(a.id));
            if (!task || task.done || task.fail || task.date > d || (task.date === d && task.time) || seenIds.has(String(task.id))) continue;
            duration = Math.max(1, Math.min(480, +task.min || 30));
          } else {
            if (!String(a.t || "").trim() || S.tasks.some(t => !t.fail && norm(t.t) === norm(a.t) && t.date === d)) continue;
            const skill = taskSkillName(a.sk, a.t);
            a.sk = skill; a.min = duration;
            a.pri = ["Low","Normal","High"].includes(a.pri) ? a.pri : "Normal";
          }
          if (begin < winStart || begin + duration > winEnd || plannedMins + duration > p.hours * 60) continue;
          const gap = S.allowBackToBack ? 0 : 10; if (reserved.some(([a0,b0]) => begin < b0 + gap && begin + duration + gap > a0)) continue;
          if (accepted.some(x => { const start = hm(x.time), task0 = x.a === "move" ? S.tasks.find(t => String(t.id) === String(x.id)) : null; const mins = task0 ? (+task0.min || 30) : (+x.min || 30); const gap = S.allowBackToBack ? 0 : 10; return begin < start + mins + gap && begin + duration + gap > start; })) continue;
          accepted.push(a); plannedMins += duration; if (task) seenIds.add(String(task.id));
        }
        out.actions = accepted.slice(0, 12);
        source = "ai";
      }
      if (!out || !out.actions.length) {
        const local = localDailyPlan(d,p);
        if (source === "ai" && out && !out.actions.length && local.actions.length) {
          // Retain a usable result even when the AI has no suitable actions.
          out = { reply: out.reply || local.reply, actions: local.actions };
          source = "local";
        } else if (!out) out = local;
      }
      p.preview = { date: d, source, reply: String(out.reply || "Here is a suggested plan."), actions: out.actions || [], generatedAt: Date.now() };
      p.status = source === "ai" ? "AI plan ready to review." : "Smart local plan ready to review. AI was unavailable or had no suitable actions.";
      logA("planner", "Generated a daily plan for " + d + " with " + p.preview.actions.length + " suggestions");
    } catch (e) {
      const local = localDailyPlan(d,p);
      p.preview = { date: d, source: "local", reply: local.reply, actions: local.actions, generatedAt: Date.now() };
      p.status = "AI is unavailable right now, so a local plan was prepared from your tasks and schedule.";
      logA("planner", "Generated local fallback plan for " + d);
    }
    save(); render();
  }
  async function applyDailyPlan() {
    const p = plannerSettings(), preview = p.preview;
    if (!preview || !Array.isArray(preview.actions) || !preview.actions.length) return toast("There is no plan to apply");
    if (!confirm("Apply these " + preview.actions.length + " suggested changes? Existing tasks may be rescheduled and new goal-step tasks added.")) return;
    p.status = "Applying plan…"; save();
    try {
      const plannedActions = preview.actions.slice();
      const result = await applyActions({ reply: preview.reply || "Daily plan applied.", actions: plannedActions });
      const affected = S.tasks.filter(t => plannedActions.some(a => (a.a === "move" && String(a.id) === String(t.id)) || (a.a === "add" && String(a.t || "").trim().toLowerCase() === String(t.t || "").trim().toLowerCase() && (a.date || preview.date) === t.date)));
      affected.forEach(t => { t.calendarSyncPending = true; });
      p.preview = null; p.status = "Plan applied to your task list."; save();
      const syncConfirmed = GCAL && affected.length && confirm("Sync Schedule to Google Calendar? Choose OK to sync these planned changes, or Cancel to keep them local.");
      if (syncConfirmed) { affected.forEach(t => { delete t.calendarSyncPending; }); save(); await syncCal(); p.status = "Plan applied and confirmed for Google Calendar sync."; }
      else if (affected.length) p.status = "Plan saved locally. Google Calendar sync was not confirmed.";
      save(); toast(syncConfirmed ? "Daily plan applied and calendar sync confirmed" : "Daily plan applied locally"); render();
    } catch (e) { p.status = "Could not apply this plan. Please review your tasks and try again."; save(); render(); }
  }
  async function applyActions(out) {
    const adds = [], notes = [], dels = [], today = TODAY;
    const acts = Array.isArray(out.actions) ? out.actions : [];
    for (const a of acts) {
      try {
        if (a.a === "habit_add") { const r = addHabit(a.n, a.i, skName(a.sk)); if (r) notes.push(r); }
        else if (a.a === "habit_rename") { const h = S.hab.find((x) => x.n.toLowerCase() === String(a.n || "").toLowerCase()); if (h && a.to) { logA("habit", "Renamed " + h.n + " to " + a.to); h.n = String(a.to).trim(); notes.push("Renamed habit to “" + h.n + "”."); } }
        else if (a.a === "habit_remove") { const h = S.hab.find((x) => x.n.toLowerCase() === String(a.n || "").toLowerCase()); if (h) dels.push({ habit: h }); }
        else if (a.a === "add") adds.push(a);
        else if (a.a === "edit") { const t = S.tasks.find((x) => x.id === +a.id); if (t) { if (a.t) t.t = String(a.t); if (a.sk) t.sk = taskSkillName(a.sk, t.t); if (a.pri) t.pri = cap(a.pri, ["Low", "Normal", "High"], t.pri); if (a.min) t.min = Math.min(480, Math.max(1, +a.min)); logA("task", "Edited “" + t.t + "”"); notes.push("Updated “" + t.t + "”."); } }
        else if (a.a === "move") {
          const t = S.tasks.find((x) => x.id === +a.id);
          if (t) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(a.date || "") && a.date >= today) t.date = a.date;
            if (/^\d{1,2}:\d{2}$/.test(a.time || "")) { t.time = mh(hm(a.time)); } else { await loadGev(t.date, plusD(t.date, 21)); t.time = null; place(t, a.win); }
            t.due = dueLabel(t.date); logA("task", "Moved “" + t.t + "” to " + whenText(t)); notes.push("“" + t.t + "”: " + (t.time ? span(t) : dl(t.date)) + ".");
          }
        }
        else if (a.a === "done") { const t = S.tasks.find((x) => x.id === +a.id); if (t && !t.done) { tog(t.id); notes.push("Completed “" + t.t + "”."); } }
        else if (a.a === "delete") { const t = S.tasks.find((x) => x.id === +a.id); if (t) dels.push({ task: t }); }
      } catch (e) { /* skip a bad action */ }
    }
    if (dels.length) {
      const names = dels.map((x) => "“" + (x.task ? x.task.t : x.habit.n) + "”").join(", ");
      if (confirm("Delete " + names + "?")) {
        dels.forEach((x) => { if (x.task) { S.tasks = S.tasks.filter((z) => z !== x.task); logA("task", "Deleted “" + x.task.t + "”"); } else { S.hab = S.hab.filter((z) => z !== x.habit); logA("habit", "Removed habit " + x.habit.n); } });
        notes.push("Deleted " + names + ".");
      } else notes.push("I left " + names + " as it is.");
    }
    if (adds.length) {
      const dates = adds.map((a) => (/^\d{4}-\d{2}-\d{2}$/.test(a.date || "") ? a.date : today)).sort();
      await loadGev(dates[0] < today ? today : dates[0], plusD(dates[dates.length - 1], 21));
      adds.sort((x, y) => String(x.date).localeCompare(String(y.date)));
      const made = [];
      for (const a of adds) {
        let date = /^\d{4}-\d{2}-\d{2}$/.test(a.date || "") ? a.date : today; if (date < today) date = today;
        const t = { id: Date.now() * 1000 + Math.floor(Math.random() * 1000), t: String(a.t || "Task").trim(), sk: taskSkillName(a.sk, a.t), pri: cap(a.pri, ["Low", "Normal", "High"], "Normal"), min: Math.min(480, Math.max(1, Math.round(+a.min) || 30)), date, time: null, due: dueLabel(date), done: false };
        if (a.note) t.note = String(a.note);
        let moved = false, clash = false;
        if (/^\d{1,2}:\d{2}$/.test(a.time || "")) { t.time = mh(hm(a.time)); clash = busyOn(t.date, t.id).some(([s, e]) => hm(t.time) < e && hm(t.time) + t.min > s); }
        else moved = place(t, a.win);
        S.tasks.unshift(t); made.push({ t, moved, clash }); logA("task", "Planned “" + t.t + "” for " + whenText(t));
      }
      const show = made.slice(0, 10).map((m) => "• " + m.t.t + (m.t.time ? " — " + span(m.t) : " — " + dl(m.t.date) + " (no free slot, set a time)") + (m.moved ? " (moved to the next free day)" : "") + (m.clash ? " (overlaps another event)" : ""));
      if (made.length > 10) show.push("…and " + (made.length - 10) + " more.");
      notes.push(...show);
    }
    S.hint = "";
    save();
    return [out.reply || "", ...notes].filter(Boolean).join("\n");
  }
  aiSend = async function (v) {
    v = (v || "").trim(); if (!v || busy) return; busy = true;
    S.chat.push({ r: "u", t: v }); const m = { r: "ai", t: "Thinking…" }; S.chat.push(m); logA("chat", "You asked: “" + v + "”"); render();
    const local = typeof NAVRE !== "undefined" && NAVRE.test(v.trim());
    let out = null;
    if (!local) { try { out = await askAI(v); } catch (e) { out = null; } }
    if (out) { try { m.t = await applyActions(out); } catch (e) { m.t = "Sorry, I couldn't do that. Try rephrasing it."; } }
    else { let r; try { r = aiDo(v); } catch (e) { r = "Sorry, I couldn't do that. Try rephrasing it."; } m.t = local ? r : r + "\n(The AI is offline right now, so I used simple commands.)"; }
    if (S.chat.length > 1000) S.chat.splice(0, S.chat.length - 1000);
    busy = false; render();
  };
  const _addAI = addAI;
  addAI = async function (txt) {
    txt = (txt || "").trim(); if (!txt || busy) return; busy = true;
    S.hint = "Thinking…"; render();
    try { const msg = await applyActions(await askAI(txt)); S.hint = esc(msg).replace(/\n/g, "<br>"); busy = false; beep(660); render(); }
    catch (e) { busy = false; S.hint = ""; _addAI(txt); S.hint = "The AI is offline, so I used the simple parser. " + (S.hint || ""); render(); }
  };
  AIQ.length = 0; AIQ.push("What's next?", "Plan my exam week", "Study DBMS 1hr", "Add habit: Read 20 pages");

  /* ---------- habits ---------- */
  function addHabit(name, icon, sk) {
    name = String(name || "").trim(); if (!name) return "";
    if (S.hab.some((h) => h.n.toLowerCase() === name.toLowerCase())) return "You already have “" + name + "”.";
    sk = ["Fitness","Mindset","Tech","Academics","Communication"].includes(skName(sk)) ? skName(sk) : "Mindset";
    S.hab.push({ hid: "habit-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8), i: "", n: name, sk, ss: ["Mindset", "Fitness"].includes(sk) ? (defaultHabitSubskill({ n: name, sk }) || "") : "", c: COLORS[S.hab.length % 6], d: Array.from({ length: dim }, () => null), cr: TODAY, st: 0, restDays: [], streakShields: 0, shieldedDays: [], streakShieldMilestone: 0, streakShieldRewards: [], streakShieldInitialized: true });
    logA("habit", "Added habit " + name); return "Added habit “" + name + "”. It counts from tomorrow.";
  }
  function habManage() {
    const weekdays = [[0,"S","Sunday"],[1,"M","Monday"],[2,"T","Tuesday"],[3,"W","Wednesday"],[4,"T","Thursday"],[5,"F","Friday"],[6,"S","Saturday"]];
    return `<div class="card"><h2>Manage habits</h2>${S.hab.map((h, i) => {
      h.restDays=Array.isArray(h.restDays)?h.restDays:[];h.streakShields=Math.max(0,Number(h.streakShields)||0);
      const linked=["Mindset","Fitness"].includes(h.sk),selected=h.ss||defaultHabitSubskill(h),active=linked?activeSkillSubskills(h.sk):[];
      return `<div class="item habit-manage-row"><div class="t"><div class="habit-card-title"><i class="dot" style="background:${h.c}"></i>${esc(h.n)}</div><div class="habit-category-row"><span class="tag">${esc(h.sk.toUpperCase())}</span>${linked?`<div class="habit-glass-select" data-habit-subskill-select="${i}" style="--habit-color:${h.c}"><button class="habit-glass-trigger" type="button" data-hsub-open="${i}" aria-expanded="false">${esc(selected||"CHOOSE SUB-SKILL")} <span aria-hidden="true">⌄</span></button><div class="habit-subskill-menu" role="menu">${active.map(n=>`<button type="button" role="menuitem" data-hsub-set="${i}" data-hsub-value="${esc(n)}" aria-selected="${n===selected}">${esc(n)}</button>`).join("")}</div></div>`:`<span class="mu">Task-driven</span>`}</div><div class="habit-rest-control" style="--habit-color:${h.c}"><span class="habit-rest-title">REST DAYS</span><div class="habit-rest-pills" role="group" aria-label="Rest days for ${esc(h.n)}">${weekdays.map(([wd,label,long])=>`<button type="button" class="habit-day-pill" data-hrest-pill="${i}:${wd}" aria-label="${long} rest day" aria-pressed="${h.restDays.includes(wd)}" title="${long}">${label}</button>`).join("")}</div></div><div class="shield-balance" aria-label="${h.streakShields} streak shields"><span class="shield-icon" aria-hidden="true"></span><b>${h.streakShields} SHIELDS</b><small>Earn 1 every 7-day streak</small></div></div><div class="row"><button class="chip" data-hren="${i}">RENAME</button><button class="chip" data-hdel="${i}">DELETE</button></div></div>`;
    }).join("")}<div class="add" style="margin-top:14px"><input id="hn" placeholder="New habit, e.g. Read 20 pages" aria-label="New habit name" autocomplete="off"><select id="hs" aria-label="Skill">${Object.keys(SK).map(k=>`<option>${esc(k)}</option>`).join("")}</select><button class="btn p" data-hadd>Add</button></div><p class="mu" style="margin-top:12px">Mindset and Fitness sub-skill progress comes only from valid habit checkmarks. Rest days are neutral; streak shields preserve continuity without creating fake completions or XP.</p></div>`;
  }

  /* ---------- leaderboard that grows over time ---------- */
  function rivals(off) {
    const now = new Date();
    const elapsedDays = Math.max(0, now.getDate() - 1 + Number(off || 0));
    const monthKey = now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0");
    const ranges = { easy:[400,600], medium:[600,700], hard:[700,900], expert:[900,1000], insane:[1000,1200] };
    const range = ranges[S.simDifficulty || "medium"] || ranges.medium;
    const stableDaily = (name, date) => { let h=2166136261; const value=name+"|"+date+"|"+(S.simDifficulty||"medium"); for(let j=0;j<value.length;j++){h^=value.charCodeAt(j);h=Math.imul(h,16777619)} return range[0]+((h>>>0)%(range[1]-range[0]+1)); };
    return NM.filter(([nme]) => nme !== "Harshit Jadon").map(([nme, r], i) => {
      let dailySimulationRewards = 0;
      for(let day=1;day<=elapsedDays;day++) dailySimulationRewards += stableDaily(nme, monthKey+"-"+String(day).padStart(2,"0"));
      return { n: nme, p: Math.max(0, Math.round(dailySimulationRewards)) };
    });
  }
  const refreshPl = () => { S.pl = [...rivals(0), ...G.real]; };
  genPlayers = function () { return rivals(0); };
  plist = function () {
    refreshPl();
    const q = (S.cq || "").trim().toLowerCase(), me = { n: S.name || "You", p: S.points, me: 1 };
    const all = [...S.pl, me].sort((x, y) => y.p - x.p);
    const yp = new Map(rivals(-1).map((p) => [p.n, p.p]));
    const yr = new Map([...all].map((p) => ({ n: p.n, p: p.me ? (S.py ? S.py.p : p.p) : yp.has(p.n) ? yp.get(p.n) : p.p })).sort((a, b) => b.p - a.p).map((p, i) => [p.n, i + 1]));
    const rows = all.map((p, i) => ({ ...p, r: i + 1, d: (yr.get(p.n) || i + 1) - (i + 1) })).filter((p) => !q || p.n.toLowerCase().includes(q));
    return rows.length ? rows.map((p) => `<div class="pl ${p.me ? "me" : ""}"><span class="pv">#${p.r}<span class="mv ${p.d > 0 ? "up" : p.d < 0 ? "dn" : ""}">${p.d > 0 ? "▲" + p.d : p.d < 0 ? "▼" + -p.d : ""}</span></span>${medal(rankOf(p.p))}<b>${esc(p.n)}${p.me ? " (you)" : ""}${p.real ? " ✦" : ""}</b><span class="mu">${nm(rankOf(p.p))}</span><span class="pv">TROPHIES ${p.p}</span></div>`).join("") : '<div class="empty">No player found.</div>';
  };
  leagueCard = function () {
    refreshPl();
    const cur = TI[rankOf(S.points)].b, sel = S.lgSel == null ? Math.max(0, cur) : S.lgSel;
    const all = [...S.pl, { n: S.name || "You", p: S.points, me: 1 }];
    const inL = all.filter((p) => TI[rankOf(p.p)].b === sel).sort((a, b) => b.p - a.p);
    const prev = new Map(rivals(-1).map((p) => [p.n, TI[rankOf(p.p)].b]));
    const up = S.pl.filter((p) => prev.has(p.n) && prev.get(p.n) < TI[rankOf(p.p)].b).slice(0, 4);
    return `<div class="card" style="margin-bottom:16px"><h2><span>Leagues</span></h2><div class="lgs">${LG.map(([n, lo], k) => `<div class="lgi ${k == cur ? "on" : ""} ${k == sel ? "sel" : ""}" data-lg="${k}" role="button" tabindex="0" aria-label="${n} league, ${all.filter((p) => TI[rankOf(p.p)].b === k).length} players"><svg class="medal" viewBox="0 0 100 100" aria-hidden="true"><image href="${BD[k]}" x="0" y="0" width="100" height="100"/></svg><b>${n}</b><span class="mu">${lo}+ TROPHIES</span></div>`).join("")}</div><div class="lgp"><h2><span>${LG[sel][0]} league · ${inL.length} player${inL.length == 1 ? "" : "s"}</span></h2>${inL.slice(0, 12).map((p) => `<div class="pl ${p.me ? "me" : ""}"><span class="pv"></span>${medal(rankOf(p.p))}<b>${esc(p.n)}${p.me ? " (you)" : ""}</b><span class="mu">${nm(rankOf(p.p))}</span><span class="pv">TROPHIES ${p.p}</span></div>`).join("") || '<div class="empty">Nobody here yet.</div>'}${up.length ? `<p class="mu" style="margin-top:10px">Moved up today: ${up.map((p) => `<b class="mv up">▲ ${esc(p.n)}</b> (${LG[TI[rankOf(p.p)].b][0]})`).join(", ")}</p>` : ""}</div></div>`;
  };

  /* ---------- journal ---------- */
  jl = function () {
    const q = S.jq.toLowerCase(), a = S.jr.filter((e) => !q || e.t.toLowerCase().includes(q));
    return a.length ? a.map((e) => `<div class="msg"><div class="mu">${esc(e.d)} ${["Tired", "Calm", "Focus", "Driven", "Driven"][e.m]} <button class="chip" data-jed="${e.id || ""}">Edit</button> <button class="chip" data-jdl="${e.id || ""}">Delete</button></div><div style="text-transform:none">${esc(e.t)}</div>${e.ai ? `<div class="pos" style="text-transform:none">AI: ${esc(e.ai)}</div>` : ""}</div>`).join("") : '<div class="empty">No entries found.</div>';
  };
  window.__jhelp = async function () {
    const ta = $("#jt"), entry = ta ? ta.value : "";
    toast("Thinking…");
    try {
      const r = await api("/api/ai", { method: "POST", body: JSON.stringify({ mode: "help", mood: S.mood, entry, ctx: { done: S.tasks.filter((t) => t.dd === TODAY).map((t) => t.t).slice(0, 8), open: S.tasks.filter((t) => !t.done && !t.fail && t.date === TODAY).map((t) => t.t).slice(0, 8) } }) });
      if (!r.ok) throw new Error("ai");
      const j = await r.json();
      if (entry.trim()) S.jtip = j.reply; else if (ta) ta.value = j.reply + " ";
    } catch (e) { if (ta && !entry.trim()) ta.value = ["Today I felt ", "The best part of my day was ", "One thing I want to do better tomorrow is "][S.mood % 3]; toast("The AI is offline, here is a simple prompt."); }
    render(); const t2 = $("#jt"); if (t2) t2.focus();
  };

  /* ---------- views: patch pages ---------- */
  const _view = view;
  view = function () {
    let h = _view();
    if (S.page === "prof") {
      h = h.replace("<b>Harshit Jadon</b>", "<b>" + esc(S.name || "You") + "</b>").replace("<b>19 Oct 2026</b>", "<b>" + new Date(S.joined + "T00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) + "</b>").replace(/(<span>Tasks done<\/span><b>)\d+(<\/b>)/, "$1" + doneAll() + "$2");
    }
    if (S.page === "hab") h = h.replace('<div class="card"><h2>Habits done this month</h2>', habManage() + '<div class="card"><h2>Habits done this month</h2>');
    if (S.page === "jr" && S.jtip) h = h.replace('<div class="chips"><button class="btn p" data-js>', `<p class="hint">AI: ${esc(S.jtip)}</p><div class="chips"><button class="btn p" data-js>`);
    if (S.page === "cal") {
      const ev = G.all.filter((e) => !e.app && iso(new Date(e.start)) === S.cd);
      h += `<div class="card"><h2>Google Calendar · ${dl(S.cd)}</h2>${GCAL ? (ev.length ? ev.map((e) => `<div class="item"><div class="t">${esc(e.title)}<div class="mu">${e.allDay ? "All day" : fmtT(pad(new Date(e.start).getHours()) + ":" + pad(new Date(e.start).getMinutes()))}</div></div></div>`).join("") : '<div class="empty">No other events.</div>') : '<div class="empty">Google Calendar is not connected. Open Settings to connect it.</div>'}</div>`;
    }
    if (S.page === "set") {
      const r = { ...DEF_RT, ...(S.rt || {}) };
      const email = U && U.email ? U.email : "No account email available";
      const permission = !window.Notification ? "UNSUPPORTED" : Notification.permission === "granted" ? "ALLOWED" : Notification.permission === "denied" ? "BLOCKED BY BROWSER" : "NOT ENABLED";
      const t = (id, v, l) => `<label class="settings-time-label">${l}<input type="time" id="rt-${id}" value="${esc(v || "08:00")}" aria-label="${l}"></label>`;
      h = `${hero("set","Settings","Account, calendar, reminders, and app preferences.")}
      <div class="settings-layout">
        <section class="card settings-section"><h2>ACCOUNT</h2><div class="settings-kv"><span>Email address</span><b>${esc(email)}</b></div><label class="settings-field">Display name<input id="nm" maxlength="80" value="${esc(S.name || (U && U.user_metadata && (U.user_metadata.full_name || U.user_metadata.name)) || "")}" aria-label="Display name"></label><div class="chips"><button class="btn p" data-save-name>SAVE DISPLAY NAME</button><button class="btn" data-so>SIGN OUT</button></div></section>
        <section class="card settings-section"><h2>GOOGLE CALENDAR</h2><div class="settings-status-row"><span class="status-dot ${GCAL?"is-on":"is-off"}"></span><span class="settings-status-copy">${GCAL?"Connected. Tasks with a time appear in your calendar with reminders.":("Not connected. " + (esc(gcalWhy(GCAL_WHY)) || "Connect Google Calendar so scheduled tasks can appear in your calendar."))}</span><span class="tag">${GCAL?"CONNECTED":"NOT CONNECTED"}</span></div><div class="chips"><button class="btn p" data-gc>${GCAL?"RECONNECT":"CONNECT"}</button><button class="btn" data-calendar-refresh>REFRESH STATUS</button></div></section>
        <section class="card settings-section"><h2>REMINDERS & PUSH NOTIFICATIONS</h2><div class="settings-status-grid"><div class="settings-status-row"><span class="status-dot ${permission==="ALLOWED"?"is-on":permission==="BLOCKED BY BROWSER"?"is-bad":"is-off"}"></span><span>Browser notifications</span><span id="notification-permission-status" class="tag">${permission}</span></div><div class="settings-status-row"><span class="status-dot is-off" id="background-push-dot"></span><span>Background push</span><span id="background-push-status" class="tag">CHECKING</span></div></div>${remindersPanel()}</section>
        <section class="card settings-section"><h2>DAILY ROUTINE</h2><p class="mu">The AI planner uses these times to suggest realistic open blocks. Time zone: ${esc(TZ)}.</p><div class="settings-fields-grid">${t("wake",r.wake,"Wake up")}${t("sleep",r.sleep,"Sleep")}${t("ws",r.ws,"Plan tasks from")}${t("we",r.we,"Plan tasks until")}${t("bf",r.bf,"Busy from")}${t("bt",r.bt,"Busy until")}</div><label class="settings-check"><input type="checkbox" id="rt-busy" ${r.busy?"checked":""}> I am usually busy on weekdays (college or work)</label></section>
        <section class="card settings-section"><h2>LOOK & SOUND</h2><p class="mu">Theme</p><div class="seg"><button data-th="1" aria-pressed="${S.dark}">DARK</button><button data-th="0" aria-pressed="${!S.dark}">LIGHT</button></div><p class="mu" style="margin-top:14px">Accent colour</p><div class="row">${["#b8c4ff","#5fc3d4","#ff7a9c","#efe6d2"].map(c=>`<button class="sw" data-ac="${c}" style="background:${c}" aria-label="Accent ${c}" aria-pressed="${document.documentElement.style.getPropertyValue("--ac")==c}"></button>`).join("")}</div><p class="mu" style="margin-top:14px">Sound effects</p><div class="seg"><button data-sn="1" aria-pressed="${S.snd}">ON</button><button data-sn="0" aria-pressed="${!S.snd}">OFF</button></div></section>
        <section class="card settings-section"><h2>DATA MANAGEMENT</h2><p class="mu">Download a portable backup of tasks, habits, goals, journal entries, activity, and skill progress. Reset is destructive and requires confirmation.</p><div class="chips"><button class="btn" data-export-data>EXPORT MY DATA</button><button class="btn" data-rs>DELETE ALL MY DATA</button></div></section>
      </div>`;
    }
    return h;
  };

  /* ---------- clicks and inputs for the new controls ---------- */
  document.addEventListener("click", async (e) => {
    const lg = e.target.closest("[data-lg]"); if (lg) { S.lgSel = +lg.dataset.lg; return render(); }
    if (!e.target.closest(".habit-glass-select")) document.querySelectorAll(".habit-glass-select.open").forEach(x => { x.classList.remove("open"); x.querySelector("[data-hsub-open]")?.setAttribute("aria-expanded","false"); });
    const b = e.target.closest("button"); if (!b) return; const D = b.dataset;
    if (D.hsubOpen !== undefined) { const host = b.closest(".habit-glass-select"); if (host) { const open = !host.classList.contains("open"); document.querySelectorAll(".habit-glass-select.open").forEach(x => x.classList.remove("open")); host.classList.toggle("open", open); b.setAttribute("aria-expanded", open ? "true" : "false"); } return; }
    if (D.hsubSet !== undefined) { const h = S.hab[Number(D.hsubSet)], value = String(D.hsubValue || ""); if (h && ["Mindset", "Fitness"].includes(h.sk) && activeSkillSubskills(h.sk).includes(value)) { h.ss = value; save(); toast("Habit sub-skill updated"); } return render(); }
    if (D.hrestPill !== undefined) { const [hi, wd] = String(D.hrestPill).split(":").map(Number), h = S.hab[hi]; if (h && Number.isFinite(wd) && wd >= 0 && wd <= 6) { h.restDays = Array.isArray(h.restDays) ? h.restDays : []; h.restDays = h.restDays.includes(wd) ? h.restDays.filter(x => Number(x) !== wd) : [...new Set([...h.restDays, wd])]; save(); toast("Rest days updated"); return render(); } }
    if (D.journalPrev !== undefined || D.journalNext !== undefined) { /* handled by the main journal event handler */ return; }
    if (D.calendarRefresh !== undefined) { await loadGev(TODAY, plusD(TODAY, 21)); toast(GCAL ? "Google Calendar is connected" : "Google Calendar is not connected"); return render(); }
    if (D.saveName !== undefined) { const input = document.querySelector("#nm"), name = String(input && input.value || "").trim().slice(0,80); if (!name) return toast("Display name cannot be empty"); S.name = name; if (SB && SESSION) { try { const { error } = await SB.auth.updateUser({ data: { display_name: name, full_name: name, name } }); if (error) throw error; if (U) U.user_metadata = { ...(U.user_metadata || {}), display_name:name, full_name:name, name }; } catch (error) { console.warn("Display name metadata update failed", error); toast("Saved locally; account profile could not be updated right now"); save(); await flush(); return render(); } } save(); await flush(); toast("Display name saved"); return render(); }

    if (D.planGenerate !== undefined) { e.preventDefault(); return generateDailyPlan(true); }
    if (D.planLocal !== undefined) { e.preventDefault(); return generateDailyPlan(false); }
    if (D.planApply !== undefined) { e.preventDefault(); return applyDailyPlan(); }
    if (D.planDiscard !== undefined) { const p = plannerSettings(); p.preview = null; p.status = "Preview discarded. Your tasks have not been changed."; save(); return render(); }
    if (D.hadd !== undefined) { const m = addHabit($("#hn").value, "", $("#hs").value); if (m) toast(m); return render(); }
    if (D.hren !== undefined) { const h = S.hab[+D.hren], n = prompt("Rename habit", h.n); if (n && n.trim()) { logA("habit", "Renamed " + h.n + " to " + n.trim()); h.n = n.trim(); } return render(); }
    if (D.hdel !== undefined) { const h = S.hab[+D.hdel]; if (confirm("Delete the habit “" + h.n + "” and its history?")) { S.hab.splice(+D.hdel, 1); logA("habit", "Removed habit " + h.n); } return render(); }
    if (D.jdl !== undefined) { if (confirm("Delete this entry?")) { S.jr = S.jr.filter((x) => String(x.id) !== D.jdl); } return render(); }
    if (D.jed !== undefined) { const x = S.jr.find((z) => String(z.id) === D.jed); if (x) { S.jr = S.jr.filter((z) => z !== x); S.mood = x.m; render(); $("#jt").value = x.t; $("#jt").focus(); toast("Edit it, then save again."); } return; }
    if (D.so !== undefined) { await flush(); await SB.auth.signOut(); return location.reload(); }
    if (D.gc !== undefined) return window.__login();
    if (D.nt !== undefined) { e.preventDefault(); return enablePushNotifications(); }
    if (D.tour !== undefined) return tour(+D.tour);
    if (D.tourBack !== undefined) return tour(Math.max(0, Number(document.querySelector("#onboarding .onboarding-step")?.textContent.match(/STEP (\d+)/)?.[1] || 1)-2));
    if (D.tourSkip !== undefined) return finishOnboarding();
    if (D.tourDot !== undefined) return tour(Number(D.tourDot));
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.getElementById("onboarding")) { finishOnboarding(); return; } if (e.key === "Escape") document.querySelectorAll(".habit-glass-select.open").forEach(x => x.classList.remove("open")); if ((e.key === "Enter" || e.key === " ") && e.target.dataset && e.target.dataset.lg !== undefined) { e.preventDefault(); S.lgSel = +e.target.dataset.lg; render(); } });
  document.addEventListener("change", (e) => {
    if (e.target.dataset && e.target.dataset.hrest !== undefined) { const [hi, wd] = String(e.target.dataset.hrest).split(":").map(Number), h = S.hab[hi]; if (h && Number.isFinite(wd) && wd >= 0 && wd <= 6) { h.restDays = Array.isArray(h.restDays) ? h.restDays : []; h.restDays = e.target.checked ? [...new Set([...h.restDays, wd])] : h.restDays.filter(x => Number(x) !== wd); save(); toast("Habit rest days updated"); return render(); } }
    if (e.target.dataset && e.target.dataset.hsub !== undefined) { const h = S.hab[Number(e.target.dataset.hsub)]; if (h && ["Mindset", "Fitness"].includes(h.sk)) { h.ss = activeSkillSubskills(h.sk).includes(e.target.value) ? e.target.value : defaultHabitSubskill(h); save(); toast("Habit skill link updated"); return render(); } }
    const id = e.target.id || "";
    if (["planner-date","planner-energy","planner-hours","planner-start","planner-end","planner-carry","planner-back-to-back"].includes(id)) {
      const p = plannerSettings();
      if (id === "planner-date") p.date = e.target.value >= TODAY ? e.target.value : TODAY;
      if (id === "planner-energy") p.energy = ["low","normal","high"].includes(e.target.value) ? e.target.value : "normal";
      if (id === "planner-hours") p.hours = Math.max(2, Math.min(18, +e.target.value || 4));
      if (id === "planner-start") p.start = e.target.value || "08:00";
      if (id === "planner-end") p.end = e.target.value || "22:00";
      if (id === "planner-carry") p.includeCarryover = !!e.target.checked;
      if (id === "planner-back-to-back") S.allowBackToBack = !!e.target.checked;
      p.preview = null; p.status = "Settings updated. Generate a new plan to use them."; save(); return render();
    }
    if (id.startsWith("rt-")) { const k = id.slice(3); S.rt[k] = k === "busy" ? (e.target.checked ? 1 : 0) : e.target.value; save(); }
    if (id === "nm") { S.name = e.target.value.trim().slice(0, 40) || S.name; save(); }
  });

  /* ---------- tour, notifications, auth ---------- */
  const TOUR = [
    "Add tasks in plain words, like 'study DBMS 1hr'. The AI finds a free slot and puts it in your calendar.",
    "Track your progress across 6 core skill nodes: Academics, Tech, Communication, Mindset, Fitness, and Personality.",
    "Complete To-Do tasks and habit ticks to gain rank trophies, extend daily streaks, and prevent missed penalties.",
    "Level up sub-skills to automatically scale your overall profile rank from Bronze to higher tiers!"
  ];
  function finishOnboarding() {
    try { localStorage.setItem("hasSeenOnboarding", "true"); } catch (_) {}
    S.tour = true; save();
    const d = document.getElementById("onboarding");
    if (d) { d.classList.add("onboarding-closing"); setTimeout(() => { if (d.isConnected) d.remove(); document.body.classList.remove("onboarding-open"); }, 340); }
    else document.body.classList.remove("onboarding-open");
  }
  function tour(i) {
    if (i >= TOUR.length || i < 0) return finishOnboarding();
    const existing = document.getElementById("onboarding"); if (existing) existing.remove();
    document.body.classList.add("onboarding-open");
    const titles = ["PLAN YOUR DAY", "BUILD SIX CORE SKILLS", "TRACK HABITS & EARN REWARDS", "LEVEL UP YOUR PROFILE"];
    const d = document.createElement("div"); d.id = "onboarding"; d.className = "onboarding-overlay"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("aria-label", `Onboarding step ${i+1} of 4`);
    d.innerHTML = `<div class="onboarding-panel"><div class="onboarding-brand"><span class="onboarding-star">★</span> LEVEL UP</div><div class="onboarding-step">STEP ${i+1} OF 4</div><h1 class="onboarding-title">${titles[i]}</h1><p class="onboarding-copy">${esc(TOUR[i])}</p><div class="onboarding-dots" role="group" aria-label="Tutorial steps">${TOUR.map((_,n)=>`<button type="button" data-tour-dot="${n}" aria-label="Go to step ${n+1}" aria-current="${n===i?"true":"false"}"></button>`).join("")}</div><div class="onboarding-actions"><button type="button" class="onboarding-quiet" data-tour-skip>SKIP TUTORIAL</button><div class="row"><button type="button" class="onboarding-quiet" data-tour-back ${i===0?"disabled":""}>BACK</button><button type="button" class="btn p onboarding-next" data-tour="${i+1}">${i===TOUR.length-1?"GET STARTED":"NEXT →"}</button></div></div></div>`;
    document.body.append(d); d.querySelector("[data-tour]").focus();
  }
  function pushKeyBytes(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  async function enablePushNotifications() {
    if (!("Notification" in window)) return toast("This browser does not support notifications.");
    let permission;
    try { permission = await Notification.requestPermission(); }
    catch { return toast("Could not request notification permission."); }
    if (permission !== "granted") return toast("Notifications were not allowed in browser settings.");
    S.reminderSettings = { leadMinutes: 10, dailyEnabled: false, dailyTime: "20:00", ...(S.reminderSettings || {}), enabled: true };
    save();
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast("Notifications are enabled while Level Up is open; this browser does not support background push.");
      return;
    }
    try {
      const keyResult = await fetch("/api/push/key", { cache: "no-store" });
      const pushConfig = await keyResult.json();
      if (!pushConfig.publicKey) {
        toast("Browser alerts enabled. Add VAPID keys on the server to enable background reminders.");
        render();
        return;
      }
      await navigator.serviceWorker.register("/sw.js");
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: pushKeyBytes(pushConfig.publicKey),
        });
      }
      const saved = await api("/api/push/subscribe", { method: "POST", body: JSON.stringify({ subscription: subscription.toJSON(), timezone: TZ }) });
      if (!saved.ok) {
        let problem = {}; try { problem = await saved.json(); } catch {}
        throw new Error(problem.error || "Could not save background notification settings.");
      }
      if (!pushConfig.configured) {
        toast("Push subscription saved. Finish server VAPID and scheduler setup to receive reminders while closed.");
        render();
        return;
      }
      const test = await api("/api/push/test", { method: "POST", body: "{}" });
      if (test.ok) toast("Background notifications enabled. A test notification is on its way.");
      else toast("Subscription saved, but the test push failed. Check server VAPID settings.");
      render();
    } catch (error) {
      console.error("Could not enable background notifications.", error);
      toast(error && error.message ? String(error.message).slice(0, 160) : "Could not enable background notifications.");
    }
  }

  async function disablePushNotifications() {
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (!subscription) { toast("No background push subscription is active on this browser."); return; }
      const removed = await api("/api/push/subscribe?endpoint=" + encodeURIComponent(subscription.endpoint), { method: "DELETE" });
      if (!removed.ok) throw new Error("Could not remove the server subscription.");
      await subscription.unsubscribe();
      toast("Background push disabled. In-browser reminders are unchanged.");
      render();
    } catch (error) {
      console.error("Could not disable background notifications.", error);
      toast(error && error.message ? String(error.message).slice(0, 160) : "Could not disable background push.");
    }
  }
  window.__enablePushNotifications = enablePushNotifications;
  window.__disablePushNotifications = disablePushNotifications;

  function notifTick() {
    if (!("Notification" in window) || Notification.permission !== "granted" || S.scr !== "app") return;
    const n = new Date(), nmin = n.getHours() * 60 + n.getMinutes(), rs = S.reminderSettings || {};
    if (rs.enabled) {
      const lead = [0, 5, 10, 15, 30].includes(Number(rs.leadMinutes)) ? Number(rs.leadMinutes) : 10;
      S.tasks.forEach((t) => {
        if (t.done || t.fail || t.date !== TODAY || !t.time) return;
        const offsets = [...new Set([lead, 0])];
        offsets.forEach((k) => { const key = t.id + ":" + k + ":" + TODAY; if (nmin === hm(t.time) - k && !NF.has(key)) { NF.add(key); new Notification(k && k > 0 ? "In " + k + " min: " + t.t : "Now: " + t.t, { body: span(t) }); } });
      });
    }
    if (rs.dailyEnabled) {
      const dailyTime = typeof rs.dailyTime === "string" && /^\d{2}:\d{2}$/.test(rs.dailyTime) ? hm(rs.dailyTime) : 1200;
      if (nmin === dailyTime && S.ms !== TODAY) { S.ms = TODAY; new Notification("Level Up daily check-in", { body: agendaText(TODAY).replace(/\n/g, " ") }); save(); }
    }
  }
  setInterval(notifTick, 30000);
  setInterval(() => { if (iso(new Date()) !== TODAY) location.reload(); }, 60000);

  window.__login = async function () {
    if (!SB) return toast("Not connected to the server yet.");
    await SB.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + "/", scopes: "https://www.googleapis.com/auth/calendar", queryParams: { access_type: "offline", prompt: "consent" } } });
  };
  window.__reset = async function () {
    if (!confirm("Delete ALL your tasks, habits, journal and progress? This cannot be undone.")) return;
    try {
      const { error } = await SB.from("user_state").delete().eq("user_id", U.id);
      if (error) throw error;
      const xpResponse = await api("/api/xp/profile", { method: "DELETE", body: JSON.stringify({}) });
      if (!xpResponse.ok) throw new Error("Could not reset your secure XP profile");
    } catch (e) {
      console.error("Level Up data reset failed.", e);
      return toast("Could not reset all data. Check your connection and try again.");
    }
    try { const key = pendingKey(); if (key) localStorage.removeItem(key); } catch (e) {}
    READY = false; location.reload();
  };
  async function saveToken(s) {
    if (!s || !s.provider_refresh_token || !SESSION || !SESSION.access_token) return;
    try {
      const r = await api("/api/gcal/token", { method: "POST", body: JSON.stringify({
        refresh_token: s.provider_refresh_token,
        access_token: s.provider_token || null,
        expires_at: new Date(Date.now() + 3300e3).toISOString()
      }) });
      if (!r.ok) {
        const detail = await r.json().catch(() => ({}));
        console.warn("Google Calendar credentials could not be stored on the server:", detail.error || r.status);
      }
    } catch (e) { console.warn("Google Calendar credential save failed.", e); }
  }
  async function loadReal() {
    if (!SB || !SESSION || !U) return;
    try {
      const response = await api("/api/xp/leaderboard", { method: "GET" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Leaderboard is unavailable");
      G.real = Array.isArray(result.players) ? result.players.map((r) => ({ n: String(r.n || "Player"), p: Math.max(0, Number(r.p) || 0), real: 1 })) : [];
      const changed = applyXpProfile(result.me, true);
      if (S.scr === "app" && (S.page === "rk" || changed)) render();
    } catch (e) { console.warn("Secure leaderboard load failed.", e); }
  }

  async function afterLogin() {
    U = SESSION.user;
    S.name = (U.user_metadata && (U.user_metadata.full_name || U.user_metadata.name)) || (U.email || "").split("@")[0];
    await saveToken(SESSION);
    let row = null, loadFailed = false;
    try {
      const r = await SB.from("user_state").select("state,revision,updated_at").eq("user_id", U.id).maybeSingle();
      if (r.error) throw r.error;
      row = r.data || null;
    } catch (e) {
      // Keep older deployments readable until the user applies the revised SQL migration.
      console.warn("Revision column unavailable; trying the existing state schema", e);
      try {
        const legacy = await SB.from("user_state").select("state,updated_at").eq("user_id", U.id).maybeSingle();
        if (!legacy.error) row = legacy.data ? { ...legacy.data, revision: 1 } : null;
        else { loadFailed = true; console.warn("Could not load saved state", legacy.error); }
      } catch (legacyError) { loadFailed = true; console.warn("Could not load saved state", legacyError); }
    }
    const googleName = S.name, pending = readPending();
    if (row && row.state && row.state.S) {
      refreshSyncBase(row.state, row.revision || 1);
      if (pending && pending.state && pending.state.S) applyRemoteState(merge3(pending.base || row.state, pending.state, row.state));
      else applyState(row.state);
    } else if (pending && pending.state && pending.state.S) {
      // Restore a locally cached draft first if the server is unavailable or the first save never completed.
      applyRemoteState(pending.state);
      BASE = pending.base ? clone(pending.base) : null;
      REV = Number(pending.revision) || 0;
      lastJson = BASE ? stableStringify(BASE) : "";
    } else { freshState(); REV = 0; BASE = null; lastJson = ""; }
    if (loadFailed) console.warn("Using cached progress until the server is reachable.");
    if (!S.name || (row && row.state && !row.state.S.name)) S.name = googleName;
    normalise(); closeDays();
    READY = true;
    // Load the server-authoritative XP profile before the initial state save.
    await loadReal();
    // closeDays/normalise can make intentional local changes; the first save uses the row revision.
    save(); flush(); startStateSync(); setInterval(loadReal, 120000);
    loadGev(TODAY, plusD(TODAY, 21)).then(() => { if (S.scr === "app") render(); syncCal(); });
  }
  async function boot() {
    const t0 = Date.now(); let cfg = {};
    try { cfg = await (await fetch("/api/config")).json(); } catch (e) {}
    if (cfg.url && window.supabase) {
      SB = window.supabase.createClient(cfg.url, cfg.anon, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } });
      SB.auth.onAuthStateChange((ev, s) => { SESSION = s; if (s && s.provider_refresh_token) saveToken(s); });
      try { const { data } = await SB.auth.getSession(); SESSION = data.session; } catch (e) {}
      if (SESSION) { try { await afterLogin(); } catch (e) { console.error(e); } }
    }
    setTimeout(() => {
      S.scr = SESSION && READY ? "app" : "login";
      let showTour = false;
      if (S.scr === "app") { let seen = false; try { seen = localStorage.getItem("hasSeenOnboarding") === "true"; } catch (_) { seen = !!S.tour; } if (!seen) { showTour = true; tour(0); } }
      // body.onboarding-open hides #app so a first-time user sees the tutorial before the dashboard.
      render();
      if (showTour) { const first = document.querySelector("#onboarding [data-tour]"); if (first) first.focus(); }
    }, Math.max(0, 1500 - (Date.now() - t0)));
  }

  const st = document.createElement("style");
  st.textContent = ".lgi[data-lg]{cursor:pointer;transition:transform .2s,box-shadow .2s}.lgi[data-lg]:hover{transform:translateY(-4px) scale(1.05)}.lgi.sel{outline:2px solid var(--ac);outline-offset:3px}.lgp{margin-top:16px}.mv{font-size:11px;margin-left:6px}.mv.up{color:var(--good)}.mv.dn{color:var(--bad)}.settings-layout{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}.settings-section{min-width:0;border-radius:12px;background:rgba(15,14,23,.62);border:1px solid var(--bd);box-shadow:0 10px 30px rgba(0,0,0,.12)}.settings-kv,.settings-status-row{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--ln)}.settings-kv span{color:var(--mu)}.settings-kv b{overflow-wrap:anywhere}.settings-field,.settings-time-label{display:block;margin-top:14px;color:var(--mu);font-size:12px}.settings-field input,.settings-time-label input{display:block;width:100%;margin-top:6px}.settings-fields-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 14px}.settings-check{display:flex;gap:8px;align-items:center;margin-top:14px;color:var(--mu);font-size:13px}.settings-check input{width:16px;accent-color:var(--ac)}.settings-status-grid{display:grid;gap:4px}.settings-status-row .tag{margin-left:auto}.status-dot{width:8px;height:8px;border-radius:50%;background:#656172;box-shadow:0 0 0 3px rgba(101,97,114,.12);flex:0 0 8px}.status-dot.is-on{background:#6fd3a0;box-shadow:0 0 10px rgba(111,211,160,.5)}.status-dot.is-off{background:#8f8a9d}.status-dot.is-bad{background:#ff7075;box-shadow:0 0 10px rgba(255,112,117,.4)}.settings-status-copy{flex:1;min-width:160px}.settings-section> .card{background:rgba(255,255,255,.025);border-radius:9px}.settings-section select{width:100%!important}@media(max-width:760px){.settings-layout{grid-template-columns:1fr}.settings-fields-grid{grid-template-columns:1fr}}";
  document.head.append(st);
  render = (function (r) { return function () { if (READY) refreshPl(); return r.apply(this, arguments); }; })(render);
  async function refreshSettingsStatus() {
    const perm = document.getElementById("notification-permission-status");
    if (perm) { const v = !window.Notification ? "UNSUPPORTED" : Notification.permission === "granted" ? "ALLOWED" : Notification.permission === "denied" ? "BLOCKED BY BROWSER" : "NOT ENABLED"; perm.textContent = v; }
    const badge = document.getElementById("background-push-status"), dot = document.getElementById("background-push-dot");
    if (!badge) return;
    let label = "NOT ENABLED", on = false;
    try { if ("serviceWorker" in navigator && "PushManager" in window) { const reg = await navigator.serviceWorker.getRegistration("/"); const sub = reg && await reg.pushManager.getSubscription(); on = !!sub; label = on ? "ENABLED" : "NOT ENABLED"; } else label = "UNSUPPORTED"; } catch (_) { label = "UNAVAILABLE"; }
    if (document.getElementById("background-push-status") !== badge) return;
    badge.textContent = label; if (dot) dot.className = "status-dot " + (on ? "is-on" : label === "UNSUPPORTED" ? "is-bad" : "is-off");
  }
  const _renderSettingsStatus = render;
  render = function () { const result = _renderSettingsStatus.apply(this, arguments); if (S.page === "set") setTimeout(refreshSettingsStatus, 80); return result; };
  boot();
})();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
