# Level Up — Hackathon polish update

This update focuses only on the two unfinished presentation items: helping a first-time user understand the dashboard and making realistic sample data available for a live demo.

## What's included

- A responsive quick-start panel on Home explaining the three main actions: plan tasks, check habits, and review progress.
- Direct buttons from the guide to To-do, Habits, and Insights.
- A dismissible guide; the preference is saved in the browser.
- A `Load demo data` action that requires confirmation before replacing the current in-memory app state.
- Demo data for tasks, habits, goals, trophies, skill progress, recent activity, and a coach message.
- A visible `DEMO MODE ACTIVE` label while sample data is being shown.
- A `Restore my data` action that restores the browser's pre-demo state from a dedicated local backup.

## Using demo mode

1. Open Level Up and go to Home.
2. Click **Load demo data** and confirm.
3. Use the sample data for your hackathon walkthrough.
4. Click **Restore my data** when finished and confirm.

Demo mode stores its backup in the same browser's local storage. Keep the demo and restoration on the same browser/profile. Clearing browser storage while demo mode is active will also remove the backup.

## Safety and scope

- No API routes, database schema, authentication, task reward formulas, habit streak formulas, ranks, or unrelated features were intentionally changed.
- The project ZIP intentionally excludes `.env.local`, `node_modules`, and `.next` generated output. Keep secrets in deployment environment settings.
- The inline frontend JavaScript was syntax-checked and the ZIP was integrity-checked. Run the normal Next.js build in the project environment before deploying.
