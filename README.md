# Foreman

Adam's organizer. One month calendar always on screen, two calendars (Work / Home) you can
toggle or overlay, priority shown by shape and color, a skinny side rail that opens into full
detail on click, quick add by typing or speaking, and an end-of-day "Tomorrow" pencil-in.

Vanilla HTML/CSS/JS PWA on GitHub Pages. Data in Supabase (Row Level Security, owner only).
No build step. Push to `main` and it deploys.

- App: https://adampurdy101.github.io/foreman/
- Rules Claude follows when working in it: [FOREMAN.md](FOREMAN.md)

## Files
- `index.html` — shell
- `css/app.css` — light theme, priority colors, layout
- `js/app.js` — calendar, rail, quick add, Tomorrow
- `js/auth.js` — owner-only email login
- `js/config.js` — public Supabase URL + publishable key (safe by design)
- `sw.js`, `manifest.webmanifest` — installable app
