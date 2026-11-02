# Level Up — Requested UI and Workflow Update

This release starts from the Secure XP & Leaderboard project and applies the requested UI/workflow refinements while preserving the existing dark textured background, fonts, and blue-lavender accent theme.

## Included changes

- Removed the Focus Timer and timer-specific history, analytics, rewards, and session-related UI/logic.
- Kept Journal accessible through the Profile menu (no main top-level Journal tab). The Journal screen itself remains unchanged pending the replacement design/files from the user.
- Skill chart labels use uppercase, non-handwritten text; node dots are smaller with no overdraw glow/shadow spill. Clicking the main radar chart opens Skills.
- Main skill cards open category-specific sub-skill pages with a six-axis radar, progress cards, and add/remove controls. The six main categories remain Tech, Fitness, Mindset, Academics, Personality, and Communication. Academics begins with Database, Data Structures, Software Engineering, Mathematics, and Computer Networks.
- Monthly Habits uses a sticky, opaque first column and colored category dots without leading habit emojis.
- To-Do supports AI and manual task creation, plus editing a task's scheduled date, start time, and duration. Calendar sync is triggered when the state is saved.
- Removed the Easy/Medium/Hard difficulty system. Priority remains available; old saved `diff` fields are discarded as the app loads state.
- Planner workload choices run from 2 through 18 hours; dropdown foreground/backgrounds use high-contrast theme-aware styling.
- The custom cursor follower has been fully removed; the standard browser cursor is used. The logo star uses a continuous 18-second cycle: 15 seconds clockwise in its default color, followed by a 3-second fast counter-clockwise pink/cyan-gradient burst.
- Main navigation shows Home, To-do, Calendar, Planner, Habits, Skills, and Ranks. The Profile dropdown opens Profile, Insights, Journal, AI, and Settings with the existing uppercase navigation styling.

## Upgrade notes

1. Keep your old project folder as a backup.
2. Extract this ZIP into a new folder and copy your existing `.env.local` into its root beside `package.json`. Do not put `.env.local` in a shared ZIP or share any secret values.
3. Open the new folder in VS Code and run `npm install`, then `npm run dev`.
4. The UI changes in this release add no new database tables. If the Secure XP & Leaderboard schema migration has already been applied, no new SQL migration is required just for these UI changes.
5. Google Calendar task updates require Calendar to be connected. Automatic background reminders still require the local server/scheduler or deployed app/scheduler setup previously configured.

## Validation

The main inline JavaScript and `public/integration.js` passed `node --check`. A full Next.js build could not be run in this environment because dependency installation timed out. Run `npm install` and test the app locally before replacing or deleting your backup. The Journal visual redesign remains pending the user's future uploaded frontend design.


## Changes 15–24

See `CHANGELOG-CHANGES-15-24.md` for the follow-on progression and chart changes: dynamic sub-skill polygons, completion/restoration state, orange Tech/Academics progress rings, habit-only Mindset/Fitness progression, passive/direct Personality progression, and sub-skill-scaled Academics/Tech time thresholds.

## Follow-up fix — 1 Nov 2026

- Fixed a syntax error in `public/app.html` on the Habits page: the template literal closed before the "Monthly Habit History" card, which stopped the main script from loading. The card now sits inside the template.
- Re-ran syntax checks on the inline script, `integration.js`, `sw.js` and all TypeScript routes: no errors.

- Google Calendar: the server now refreshes the Google token and retries once when Google answers 401 (a stale token was being cached as valid for 55 minutes after every reload). `/api/gcal` also returns a `reason`, and Settings > Google Calendar shows why it is not connected.
