# Change 38 — Rank Up Celebration Overlay

Implemented in `public/app.html`:

- Rank changes now open a full-screen celebration modal with a dark navy/purple sunburst using `#0d0c1d` and `#1a1738`.
- Sunburst rays rotate continuously every 30 seconds via `rotateSunburst`.
- The rank-up view shows a glowing `RANK UP!` heading, centered current rank emblem, old-rank → new-rank text, and current total trophies.
- The shield/emblem springs from scale 0.3 through 1.15 and settles at 1.0.
- Golden sparks burst radially behind the emblem when the rank increases.
- `CLAIM REWARD` dismisses the overlay, returns the app to Home, and scrolls to the top. Rank reductions display `RANK UPDATE` and `CONTINUE`.
- Escape also dismisses the overlay using the same close behavior.
- Reduced-motion preferences disable the animated effects and particle burst.

The overlay is triggered by `setPoints()` when the total trophies cross a rank boundary. It displays the prior rank, resulting rank, and updated trophy total.
