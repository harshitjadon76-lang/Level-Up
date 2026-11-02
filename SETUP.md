# Level Up: setup (about 15 minutes)

Your frontend is `public/app.html` (design unchanged). `public/integration.js` connects it to
Supabase (login + saved data + leaderboard), Google Calendar and Gemini.

## 1. Run the database script
Supabase > SQL Editor > paste `supabase/schema.sql` > Run. (Old tables are left alone.)

**When updating an existing deployment, rerun this script once.** It safely adds a `revision` column and the `save_user_state` RPC used for conflict-safe saves. It also removes direct browser access to `google_tokens`; Google refresh/access tokens are now stored and refreshed only by server routes using `SUPABASE_SERVICE_ROLE_KEY`. Multi-device sync will not use the older unsafe upsert path if this migration has not been applied.

## 2. Supabase URLs
Authentication > URL Configuration:
- Site URL: `http://localhost:3000`
- Redirect URLs: `http://localhost:3000/**` (add your Vercel address with `/**` later)

## 3. Google Cloud (project `level-up`)
- Google Auth Platform > Data Access: add scope `https://www.googleapis.com/auth/calendar`
- Audience: add each friend's Gmail as a test user (limit 100).
- Credentials > your OAuth client: redirect URI must be `https://<your-ref>.supabase.co/auth/v1/callback`
- Before friends join: set Publishing status to "In production" (stays unverified, shows a warning screen).
  In "Testing" Google expires the Calendar token after 7 days.

## 4. Environment
Copy `.env.example` to `.env.local` and fill all values (never share this file).
In Supabase > Project Settings > API Keys, copy the server-only `service_role` key into `SUPABASE_SERVICE_ROLE_KEY`. If the dashboard shows a server-side secret key instead, you may use that key only if it has the service-role permissions for your project. Never prefix it with `NEXT_PUBLIC_`, put it in browser code, or share it.
Use NEW values for anything that appeared in screenshots: Google client secret and Gemini key. Put the same new Google secret in Supabase > Authentication > Providers > Google.

## 5. Run
```
npm install
npm run dev
```
Open http://localhost:3000, sign in with Google, allow Calendar.

## 6. Deploy (Vercel)
Import the folder, add the 6 env vars (+ `GEMINI_MODEL`), deploy, then add the Vercel address to
Supabase redirect URLs and to Google (no change needed for the Google redirect URI).

## How it works
- Tasks, habits, goals, journal, sub-skills, planner preferences and settings remain in the per-user `user_state` document. XP totals and real leaderboard profiles are stored separately in `xp_profiles`; immutable, deduplicated reward events are stored in `xp_events`.
- Legacy daily-history logic still marks missed tasks/habits and calculates local streak bonuses. The authoritative XP ledger awards unique positive task/habit events; reopening tasks or missing habits does not deduct from the server-managed lifetime leaderboard total.
- Tasks with a time become Google Calendar events (title starts with a lightning bolt, done = check mark),
  with reminders at 15, 5 and 0 minutes (phone) and an email 15 minutes before.
- Browser reminders can be enabled in Settings for tasks with a scheduled date and time, with a 0/5/10/15/30-minute lead time and an optional daily check-in. They use browser notifications and a service-worker notification click handler. The page checks local reminders every 30 seconds while the app is open. Web Push can deliver while the tab is closed when subscription, VAPID configuration, and a trusted scheduler are all set up.
- The AI Daily Planner builds a proposed schedule for a selected date using unfinished tasks, goals, recent task history, routine hours, and Google Calendar busy times when Calendar is connected. Choose your energy level, work-hour budget, start/end time, and whether to carry overdue work forward. Review the proposed time slots before applying them; nothing is changed until you confirm. If Gemini is unavailable, use the local smart planner.
- The AI (Gemini) returns actions; server-side validation filters malformed actions, limits request sizes, matches referenced task IDs against the task context supplied for that request, and the app finds free slots using your routine (Settings) and Google events.
- Google OAuth tokens are no longer readable/writable directly with the browser Supabase client. A signed-in server endpoint saves the current user's token; server-only Supabase credentials are required for Calendar token storage and refresh.
- Baseline response headers protect against MIME sniffing, framing, over-sharing referrers, and unnecessary browser permissions.
  If Gemini is unavailable, the old simple commands still work.

## Known limits
- Multi-device sync uses revision-checked saves, realtime updates, and a 20-second polling fallback. Independent edits to tasks, goals, journal entries, sub-skills, and activity records are merged before saving. If the exact same field is edited differently on two devices at the same time, the device performing the conflict merge keeps its field value; review that field if it matters.
- A per-account local recovery copy protects pending edits if the connection drops or the page reloads. Once online, edits retry on the next save action or when the app returns online/visible. Avoid editing the same field on two devices simultaneously; independent records/fields are merged automatically.
- Dates use the device clock; the time zone in Settings is shown, not changeable yet.
- The AI throttle is an in-memory per-process limit (30 requests per 10 minutes per user); multi-instance production hosting should also enforce provider-side quotas or a shared rate limiter.
- XP and leaderboard totals are now server-authoritative after the Secure XP migration. Historical balances are imported as a starting balance; the system cannot retroactively prove that old client-stored points were legitimate. New task rewards and habit check-ins are derived by the server from saved activity and deduplicated in `xp_events`. Client-side edits to `S.points`/`S.xp` no longer write the authoritative leaderboard. This discourages direct score editing but does not prove that a user physically performed an activity; the task list itself remains user-managed.

## 7. Background push notifications

The Notifications card now has **Enable background push**. This uses Web Push and the service worker, so the browser does not need to keep the app tab open. Local browser reminders continue to work as before.

1. Install the updated dependencies with `npm install`.
2. Generate VAPID keys from the project folder: `npx web-push generate-vapid-keys`. Copy the public and private keys into `.env.local` as `PUSH_VAPID_PUBLIC_KEY` and `PUSH_VAPID_PRIVATE_KEY`. Set `PUSH_VAPID_SUBJECT` to a contact URI such as `mailto:you@example.com`.
3. Set `CRON_SECRET` to a long random secret. The scheduled dispatcher compares this value against the `Authorization: Bearer <CRON_SECRET>` header. Keep it private.
4. Run the updated `supabase/schema.sql` once. The `push_subscriptions` and `push_delivery_log` tables intentionally have no browser access; authenticated API routes use the server-only Supabase service-role key.
5. Add the four push variables to your deployment environment and redeploy. In Settings → Reminders, click **Enable background push** and allow browser notifications. When configuration is complete, Level Up sends a test push.
6. Configure a trusted scheduler to request `GET https://YOUR-APP-DOMAIN/api/push/dispatch` every minute (recommended) with header `Authorization: Bearer YOUR_CRON_SECRET`. The endpoint only accepts the matching secret. On Vercel Pro, a per-minute Vercel Cron can call it; Vercel Hobby cron jobs run only once per day, which is too infrequent for task reminders. An external scheduler can be used instead. Do not put the secret in the URL.

Push subscriptions are tied to the signed-in account and browser. Each subscription stores its time zone so reminders use the timezone active when notifications were enabled. Re-enable push after changing browsers or clearing site data. Push delivery still depends on the browser and push provider, and operating-system notification settings may suppress alerts.

The included `scripts/push-dispatch.ps1` can be used by Windows Task Scheduler to call the local dispatcher every minute while your PC is awake and `npm run dev` is running. If you replace the extracted folder, keep the same absolute folder path or update the Task Scheduler action path. The dispatcher sends the selected lead-time task reminder and an optional daily check-in, and uses a database delivery log to avoid duplicate sends if the scheduler calls it more than once. It returns aggregate counts only, not task text or subscription secrets. During local `npm run dev`, background notifications can be tested, but scheduled reminders will not run until a scheduler is configured to call the local endpoint.


## 8. Secure XP & leaderboard

This version adds server-managed `xp_profiles` and an idempotent `xp_events` ledger. The schema imports each existing account's current point/skill total once and records existing completed activities as legacy events so they are not awarded twice. It then disables browser access to the legacy `scores` table and the new XP tables; reads and awards go through authenticated server API routes using the server-only Supabase key.

1. Back up important data first. In Supabase > SQL Editor, run the complete `supabase/schema.sql` from this version. It is designed to be rerun safely and does not delete existing tasks or profile rows.
2. Restart the app with `npm run dev`.
3. Sign in, complete a newly created test task, and wait for the save/sync to finish. The server calculates the task reward from its saved priority and skill weight. The XP API also awards 1 point per checked habit day. Duplicate saves cannot award the same event twice.
4. Open Ranks/Leaderboard and refresh. The real leaderboard rows and your own total are loaded from the protected server API.

The starting balance is preserved for continuity, so historical client-calculated points are not audited retroactively. The authoritative ledger secures new awards from direct score writes; it cannot verify that a user actually performed a self-created task, and it does not remove user control over their personal task list. Habit misses/reopened tasks do not deduct from the authoritative lifetime total in this version; the ledger only awards unique positive activity.



## Changes 25–33 — Communication, habit progression, and skill/rank animations

This update extends the Changes 15–24 build while retaining the existing theme and background.

- Communication joins Academics and Tech in minutes-based progression. Its main/sub-skill thresholds use cumulative targets `N_eff × [30 + 15 × (L − 2)]` minutes for level `L ≥ 2`, with `N_eff = max(active sub-skills, 4)`. Communication cards show minutes and keep both a circular level badge and linear progress bar.
- Mindset and Fitness continue to advance only through Monthly Habit Tracker checkmarks. Their per-level XP targets are 8, 10, 12, 14… XP (starting at 8 XP for Level 1 → Level 2), with each valid habit tick granting 1 XP. This supersedes any older 5, 6, 7… tick-per-level description.
- Personality receives +1 passive XP per valid progress event and +10 XP when a contributing sub-skill levels up. The first level-up in a source category on a local calendar day receives the full +10 bonus; subsequent level-ups in that same source category/day receive +5. Direct Personality tasks remain supported. Event keys and saved activity prevent duplicate awards.
- Academics, Tech, and Communication retain total logged minutes when active sub-skills change. Their thresholds recalculate from the current active sub-skill count and a minimum effective count of four.
- Habit settings support designated weekly rest days and streak shields. Rest days do not grant XP; valid habit ticks update their selected Mindset/Fitness sub-skill. Shield protection preserves a streak without inventing a checkmark or reward.
- Radar charts dynamically change their polygon vertex count, use normalized level scaling, and animate the chart/nodes while preserving axis alignment. All six main skill cards have synchronized ring/bar progress, shimmer, hover tilt, rolling counters, progress popups, and level-up cues. The rank card adds emblem idle/shimmer, progress sheen, trophy counter, and rank-up effects.
- Settings in the Profile dropdown opens a functional settings view with preferences and JSON data export. The custom cursor follower remains removed; the normal browser cursor is used.

### Installation and verification

1. Keep the previous working folder as a backup. Extract this ZIP into a new folder, then copy your existing `.env.local` beside `package.json`; the archive intentionally does not include secrets.
2. Run `npm install` and `npm run dev`.
3. Use the existing secured Supabase schema migration only if it has not already been applied for the Changes 15–24 build; back up data before running schema changes. Changes 25–33 do not require deleting tables or dropping the user's stored task/habit data.
4. Test Communication minute counters/level thresholds, Mindset/Fitness tick XP and rest/shield behavior, Personality direct/passive progression, daily trophy rollover/deduplication, Settings data export, and the radar/skill/rank interactions.

## User-requested interface updates
- The Focus Timer and all timer-specific UI, history, analytics and XP rewards are removed. General uses of the word “focus” in AI/study language are unrelated.
- Journal is accessible through the Profile dropdown only and uses the pixel-art open-book layout with aged parchment pages, leather spine, golden accents, retro typography and animated page turns. Existing journal entries remain in the synced journal state.
- The Skills page keeps six main categories (Tech, Fitness, Mindset, Academics, Personality, Communication), uppercase non-handwritten chart labels, smaller nodes without spillover glow, clickable radar navigation, category-specific sub-skill pages and add/remove sub-skills. Each sub-skill chart dynamically adapts its polygon and evenly spaced axes to the active sub-skill count.
- Monthly Habits shows only colored category dots and habit names; its sticky left column has a fixed opaque width to prevent overlap with the checkbox grid.
- To-Do supports AI and manual creation plus editing scheduled date, time and duration. The Easy/Medium/Hard difficulty system has been removed.
- Planner workload options range from 2 to 18 hours. Dropdown text/background contrast is explicitly styled for both themes.
- The top navigation contains Home, To-do, Calendar, Planner, Habits, Skills and Ranks. Profile opens Profile, Insights, Journal, AI and Settings. The logo star runs an 18-second loop: 15 seconds clockwise in its default color, then a 3-second fast counter-clockwise pink/cyan-gradient burst. The custom cursor follower has been removed; the standard browser cursor is used.
- Task scheduling changes trigger the existing Google Calendar upsert sync when Calendar is connected.

## Late UI integrations (Changes 34–41)

- A first-run, four-step onboarding wizard is shown until `localStorage.hasSeenOnboarding` is set. To show it again, clear that key in the browser for this origin.
- Settings include account, Google Calendar, reminders/push, daily routine, theme/sound, export and reset controls. The controls depend on configured Supabase/Google credentials and browser notification permissions.
- MISSED tasks provide edit, delete, smart reschedule and partial-time logging actions. Smart rescheduling checks today's and tomorrow's schedule/calendar; the Next.js server must be running.
- Journal uses a two-page parchment book layout with page-turn overlay animations; entries remain in the existing synced journal state.
- Habit manager uses glass-style sub-skill selection, day pills, rest-day scheduling and per-habit streak shield balances.

Run `npm install` and `npm run dev` locally, then test login, Calendar OAuth, Settings save/sign-out, task completion/rewards, habit ticks/rest days/shields, MISSED actions and Journal navigation before removing your backup.

