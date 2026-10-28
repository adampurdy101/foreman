# FOREMAN — technical notes

Foreman is a personal organizer: a month-first calendar with a Claude "brain" that files,
schedules and reshuffles tasks. This file is the technical reference for the repo. The
owner's operating rulebook (how the assistant manages him) is private and lives in the
Supabase table `fm_rules`, not here.

## Pieces
| Piece | Does | Lives |
|---|---|---|
| App | Month/Week/Day, Work/Home/Both, rail, Quick add, Tell Foreman, Tomorrow | `index.html`, `css/app.css`, `js/app.js` → GitHub Pages |
| Brain | Instant filing and reshuffle from the mic | Supabase edge function `foreman-brain` (`supabase/functions/foreman-brain`) |
| Scheduled runs | Morning plan, end of day | Claude scheduled tasks (read `fm_rules` for the rulebook) |
| Meetings | Reads the owner's published work calendar (ICS) every 15 min; writes titles + times only | Supabase edge function `foreman-meetings` + pg_cron job `foreman-meetings-sync` |
| Data | Tasks, jobs, moves, brain log, rules, meetings | Supabase tables `fm_tasks`, `fm_jobs`, `fm_moves`, `fm_brain_log`, `fm_rules`, `fm_meetings`, `fm_meeting_rules` (RLS, owner only); `fm_settings` (service role only: calendar link, cron key) |

The Supabase URL and publishable key in `js/config.js` are public by design; Row Level
Security plus the owner-only login protect the data. No secrets live in this repo.

## Data model (fm_tasks)
| field | meaning |
|---|---|
| title, notes | what it is |
| bucket | `work` or `home` |
| priority | `urgent` !! · `high` ▲ · `normal` ● · `low` – |
| status | `not_started` · `working` · `waiting` (+ `waiting_on`) · `done` (+ `done_at`) |
| job | name from `fm_jobs` |
| size | `15m` · `1h` · `half` · `full` (default `1h`) |
| scheduled_date | the day it sits on. NULL = unscheduled (inbox) |
| target_date | would like it done by |
| dropdead_date | must be done by; never schedule past it |
| planned | true = penciled in from Tomorrow (dashed) |
| promised_to | a person this is owed to; never moved without the owner's say-so |
| nag_hours | 0 = none; else nag every N hours until done |
| source | `app` · `quick` · `tomorrow` · `brain` · `claude` · `morning` · `eod` · `imported` · `gmail` |

Every change the brain or a scheduled run makes is logged in `fm_moves` (batch_id, kind
add/move/update/complete/delete, before, after, reason) so the app's Undo works.

## Scheduling rules (summary)
1. Nothing goes in without bucket, priority, size and a day.
2. A day holds 8 working hours (7–4 with lunch). Over that, something moves.
3. Order: urgent → promises due → drop-deads within 2 days → planned → high → normal → low.
4. Move first, show, undo. Every move carries a one-line reason.
5. Never past a drop-dead. Never move a promised item unless told. Urgent stays on today.
6. Push LOW then NORMAL toward their targets when a day is full.
7. Home calendar: same filing, lighter touch.
8. Done is done; delete only when told or for an exact duplicate.

## Meetings (fm_meetings)
- Source: the owner's published Outlook calendar (ICS). The link is stored in `fm_settings`, never in this repo.
- `foreman-meetings` expands recurrences (ical.js, the feed's own VTIMEZONEs), keeps 14 days back / 90 ahead,
  upserts by `source + uid|start`, and deletes rows in the window that left the feed. Titles and times only.
- `attending` comes from `fm_meeting_rules` (title contains). The app's "I go to this" / "I don't go" buttons
  write that rule for the whole series.
- App: ■ solid = you go (counts against the 8 h day) · ◌ dashed = invited (not counted) · ◇ = all day / holiday.
  Month cells show `hours/8` (work tasks + meetings you attend); `!!` when over 8 h. Work view only.

## Brain tools
`list_jobs`, `list_tasks`, `day_load`, `add_task`, `update_task` (moves need a reason;
refuses promised items and past-drop-dead), `complete_task`, `delete_task`, `ask_adam`
(max 3 A/B/C questions, then stop). Model from the `FOREMAN_MODEL` secret
(default `claude-sonnet-4-5`). Anthropic key in Supabase Edge Function secrets only.

## Quick-add grammar
`!!` or "urgent" · `!` or "high" · "low" · `#home` / `#work` · `@<job prefix>` ·
"today" / "tomorrow" / "fri" / "10/30". Example: `Send James layout fri !! @miner`

## Shipping a change
Bump `?v=N` on `css/app.css` and `js/app.js` in `index.html` and `VERSION` in `sw.js` together. GitHub Pages caches files for 10 minutes; the query string makes the browser fetch the new copy right away.

## Stages
1. Calendar, rail, quick add + mic, Tomorrow, brain, undo — done
2. Scheduled runs (morning, end of day) — done
3. Meetings on the calendar — done (Outlook feed direct, every 15 min). Still to do: dated tasks → Google Calendar alerts
4. Jobs tab with timeline bars; Gmail asks → unscheduled; hourly nudge
5. Phone-first polish
