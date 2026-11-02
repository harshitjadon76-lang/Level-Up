# Level Up — Changes 25–33

This release is based on the user's existing Changes 15–24 ZIP and adds the following requested changes. The existing visual theme and other features are preserved.

## Skill progression

- Communication now tracks completed-task duration in minutes with dynamic cumulative thresholds matching Academics/Tech: `N_eff = max(active sub-skills, 4)` and `target(L) = N_eff × [30 + 15 × (L − 2)]` minutes for `L ≥ 2`. Communication main and sub-skill cards keep a circular level ring and a linear progress bar. Academic/Tech progress rings now show progress within the current threshold interval.
- Mindset and Fitness progress only from valid Monthly Habit Tracker ticks. Each tick adds 1 XP; per-level targets are 8, 10, 12, 14… XP, with chunked progress shown on cards. This later formula supersedes older 5, 6, 7… tick documentation.
- Personality accepts direct tasks and receives +1 passive XP per valid event from Academics, Tech, Communication, Mindset, and Fitness. On a sub-skill level-up, its source category adds a further +10 XP the first time that category levels up each calendar day, then +5 for subsequent same-category level-ups on that day. Server ledger event keys are idempotent.
- Academic, Tech, and Communication main-skill levels use cumulative minute thresholds with the four-active-sub-skill minimum; active sub-skill changes adjust targets without removing logged minutes.
- Habit configuration supports assigned Mindset/Fitness sub-skills, weekly rest days, and streak shields (1 for each 7-day streak milestone). Rest days are neutral and do not award tick XP; a shield maintains streak continuity without inventing a completion.

## Skill, radar, rank, and settings UI

- Main and sub-skill radar charts use dynamic polygon vertex counts, even angular spacing, normalized visual level scaling, spring-like point morphing, gradient motion, per-category node glow, and hover node/ring effects. Chart clicking still navigates to Skills.
- All six main skill cards synchronize the SVG level ring and linear bar, with bar shimmer, color-matched glow, counter animation, hover tilt, floating progress cues, and genuine level-up burst effects.
- Rank cards on Home, Ranks, and Profile share emblem float/glow/shine, progress sheen, rolling trophy display, and rank-up effects.
- Profile dropdown Settings is functional and includes theme/accent/sound, local and background reminders, daily check-in timing, data export, and reset-progress access. Export downloads a JSON backup of the saved in-memory state.
- Normal browser cursor is used; no custom cursor follower is present. Header star runs a continuous 18-second cycle: 15 seconds clockwise in its default color and a 3-second reverse pink/cyan burst.

## Validation and setup

1. Keep the previous project as a backup. Extract the ZIP and copy `.env.local` from your current project into the project root. The ZIP intentionally excludes credentials and build/dependency caches.
2. Run `npm install`, then `npm run dev`. Keep the same project folder path or update the Windows Task Scheduler path for `scripts/push-dispatch.ps1`.
3. This release adds no destructive database migration. Keep the secure XP schema migration already applied by the Changes 15–24 project. If you have not applied the latest schema from that project, back up important data and follow its `SETUP.md` instructions before relying on protected XP/leaderboards.
4. Browser-based smoke tests exercised Home, all main navigation views, Settings, manual task creation, the six main skill cards, Academics' five-sided radar, adding a sub-skill, and completing/restoring one. JavaScript and service-worker syntax checks, TypeScript route transpilation, and formula smoke checks passed.

A full Next.js build could not be run in this environment because dependency installation could not reach the npm registry. Test locally before deleting your backup.

## Follow-up fixes — 22 Oct 2026

- Fixed the task edit panel being rendered twice by removing the duplicate action-column copy.
- Restricted task category selection and task-creation parsing to Tech, Academics, and Communication. Task actions produced by the AI integration now normalize unsupported task categories to an allowed task skill.
- Added deterministic task trophy awards based on duration (2 trophies per minute), including a correct fallback display for older completed tasks.
- Added a local earliest-free-slot scheduler for missing task times and missed-task rescheduling; saving an edited schedule clears missed status and restores the task to active.
- Reworked Habits page order to daily checklist, consistency analytics, and habit management; added eligible skill selection, sub-skill pills, circular rest-day toggles, streak and shield text badges.
- Added habit streak-based rewards capped at 7 per day and a 50-trophy failure penalty, with per-habit/day reward de-duplication.
- Added passive Personality level scaling based on active skill level gains and prestige tiers at 25,000 / 30,000 / 35,000 trophies.
- Added monthly season archival and a rank-history carousel, plus prestige badge assets supplied with the request.
- Updated the Journal module with parchment-book styling, text-only mood choices, daily thought and task overview, prompt starters, past-entry access, non-resizable lined writing area, and daily archive maintenance.
- Added a planner option for back-to-back tasks and an explicit Google Calendar confirmation gate for planner-applied changes.
- Removed emoji characters from the visible app/integration UI strings touched by this update.

## Validation notes

- `node --check` passed for the inline JavaScript extracted from `public/app.html` and for `public/integration.js`.
- `npm ci --ignore-scripts --no-audit --no-fund` timed out in the execution environment, so a full Next.js production build and browser-level interaction test could not be completed here. Run `npm ci` and `npm run build` locally before deployment.
