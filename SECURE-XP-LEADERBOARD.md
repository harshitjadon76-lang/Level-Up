# Secure XP & Leaderboard — installation and test

This upgrade is integrated into the Background Notifications project and keeps the existing page design and navigation.

## Install safely

1. Keep your working project as a backup. Extract this ZIP to a separate folder first. This version also includes `scripts/push-dispatch.ps1`; if you replace the folder, keep its original absolute path or update the Task Scheduler action path.
2. Copy your existing `.env.local` into the extracted `Level-Up` folder. Never include or share `.env.local` in a ZIP. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only.
3. Back up important Supabase data. Open `supabase/schema.sql` from this project and run the **complete file** in Supabase Dashboard → SQL Editor. This is an additive migration; it imports existing points as a starting balance, seeds legacy activity keys so old activity is not awarded twice, and removes direct browser access to the legacy `scores` table and XP tables.
4. Open the extracted folder in VS Code and run:

   ```bash
   npm install
   npm run dev
   ```

5. Open `http://localhost:3000`, sign in, and open **Ranks**.

## How secure XP works

- `xp_profiles` is the canonical points, skill-XP, and leaderboard profile table. It is accessed through authenticated server routes, not directly from browser code.
- `xp_events` has a unique event key per account. A database function applies a batch of events exactly once even if the browser saves the same state repeatedly.
- Completing a saved task earns the point value calculated server-side from priority and capped skill weight. The Easy/Medium/Hard task difficulty system is not used.
- The Focus Timer and timer-specific rewards/history have been removed.
- A checked habit day earns 1 point and 1 skill XP. Repeated saves or toggling the same day off and back on cannot award that same habit-day event twice.
- Old points are imported as the starting balance for continuity. Historical scores cannot be independently verified retroactively.
- Task lists remain user-managed, so this prevents direct browser score writes and duplicate rewards; it cannot prove a user physically performed a self-created task. This version only adds positive unique activity rewards; misses/reopening do not deduct from the canonical lifetime total.

## Test it

1. Create a new test task and mark it complete.
2. Wait for the saved-state sync, then open **Ranks** or refresh the page. Your authoritative points should update.
3. Refresh again. The same completed task must not earn points a second time.
5. Check a habit day and verify it adds a single point; save/refresh again to confirm no duplicate.

If a reward does not sync, open the browser console and the VS Code terminal. Look for `Secure XP sync` or `XP reconciliation` errors. Make sure the complete current `supabase/schema.sql` migration ran successfully and `SUPABASE_SERVICE_ROLE_KEY` is set in `.env.local`.
