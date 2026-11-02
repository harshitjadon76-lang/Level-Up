# Level Up — Changes 15–24

This update is based on the project containing Changes 1–14. It preserves the previous app theme and background.

## Included changes

- Removed the custom cursor follower completely; kept the normal system cursor and background parallax.
- Header star animation is an 18-second loop: 15 seconds smooth clockwise in the default color, then a 3-second counter-clockwise reverse burst with the pink/cyan gradient.
- Sub-skill radar uses a dynamic number of axes/vertices, with even angular spacing and wrapped uppercase labels.
- Sub-skill cards support Mark Complete, a 100% Completed Sub-Skills area, and Restore.
- Tech and Academic sub-skill cards have an orange circular level ring and keep the existing horizontal progress bar.
- Mindset and Fitness sub-skills progress only through Monthly Habit Tracker ticks. The later Changes 25–33 update supersedes the earlier 5, 6, 7… tick target with the requested XP thresholds of 8, 10, 12, 14… XP per level; each valid habit tick grants 1 XP. Habit Manager allows the linked sub-skill to be selected.
- Personality supports direct tasks and passive +1 XP progress events / +10 XP sub-skill-level-up bonuses from Academics, Tech, Communication, Mindset, and Fitness. Server event keys deduplicate awards.
- Academics and Tech main levels use cumulative study-minute thresholds based on `N_eff = max(active sub-skills, 4)` and `N_eff × (30 + 15 × (L − 2))` minutes for Level L≥2. Historical study hours are kept in the state migration.
- Dropdowns have theme-aware high-contrast options.

## Setup

1. Keep the previous project as a backup.
2. Extract this project and copy your existing `.env.local` into the project root beside `package.json`. Do not share it or include it in an uploaded ZIP.
3. Run `npm install`, then `npm run dev`.
4. Run the complete `supabase/schema.sql` in the Supabase SQL Editor after backing up important data. The script is idempotent for existing objects.
5. Test a task with a known duration, habit ticks in Fitness/Mindset, sub-skill completion/restoration, and background push notifications.

## Notes

- Journal remains accessible only through Profile; its visual redesign remains pending the separate frontend files the user plans to upload later.
- The previous Focus Timer removal, priority field, existing task/manual AI creation, and task time/duration editor are preserved. Easy/Medium/Hard difficulty logic stays removed.
- Full production build could not be verified in the offline environment; local verification is required.
