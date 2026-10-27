# FOREMAN — operating rules for Claude

Foreman is Adam's organizer. One calendar, one plan, one place. Its job is to keep Adam
organized, focused and on track, and to keep things from getting cluttered. Adam has ADD:
sparse by default, full detail on click, one clear next thing. This file is the standing
prompt Claude reads before touching Foreman data or code.

## Where things live
- App: https://adampurdy101.github.io/foreman/
- Code: github.com/adampurdy101/foreman (push to `main` deploys)
- Data: Supabase project `fzsfizqkolkxkorgvtcl`, tables `fm_tasks`, `fm_jobs`, `fm_moves`
- Owner user_id: 30cbcbfa-7261-47de-8c91-3d97557fc5f9 (every row needs it)
- Board (decisions and status): "Get Organized — Board" Claude doc

## The data model (fm_tasks)
| field | meaning |
|---|---|
| title, notes | what it is |
| bucket | `work` or `home` (two calendars) |
| priority | `urgent` !! · `high` ▲ · `normal` ● · `low` – |
| status | `not_started` · `working` · `waiting` (+ `waiting_on`) · `done` |
| job | name from fm_jobs (Miner, MML 1 & 2, Rosey, Alaska C1, EvergreenHealth bid, WSH, Dusty / layout, Title blocks, Mom, Japan trip, House, Kids) |
| size | `15m` · `1h` · `half` · `full` |
| scheduled_date | the day it sits on the calendar. NULL = unscheduled (inbox) |
| target_date | when Adam would like it done |
| dropdead_date | must be done by. Never schedule past this |
| planned | true = penciled in from the end-of-day "Tomorrow" check-in (dashed) |
| promised_to | a person Adam owes this to. Never move these without telling him |
| nag_hours | 0 = no nag; otherwise nag every N hours until done |
| source | `app` · `quick` · `tomorrow` · `claude` · `imported` · `gmail` |

## Rules Claude follows
1. **Nothing goes in without a date, a bucket and a priority.** If Adam gives a task in chat
   and any of those is missing, ask ONE question, then file it. Default bucket = work.
2. **Two dates.** Always ask for target and drop-dead when a task clearly has a deadline.
   Drop-dead may be blank. Target may be blank.
3. **Reshuffle rule** (end-of-day and morning plan): push Low and Normal toward their target,
   never past a drop-dead, leave anything with `promised_to` where it is, keep Urgent on
   today. Log every move in `fm_moves` with a reason and show Adam "what moved and why"
   before it sticks. He approves or undoes.
4. **Planned items** (dashed) are Adam's intent for tomorrow. The morning plan builds the day
   around them and flags anything it had to bump. Turn `planned` off once the day starts.
5. **Status differs by shape and words, never color alone.** Keep it that way in any UI change.
6. **Light background, dark text, no scanlines.** Always.
7. **Keep it sparse.** Month view shows chips only. Detail lives behind a click.
8. **Done is done.** Mark `status='done'`, set `done_at`. Don't delete history.
9. Reading "what's on my plate" = unscheduled + today + overdue (dropdead < today) +
   anything with target < today. Lead with Urgent, then promises to people.
10. Foreman is standalone and travels with Adam. Never move its data into PCI systems.

## Quick-add grammar (app and chat)
`!!` or "urgent" · `!` or "high" · "low" · `#home` / `#work` · `@miner` (job prefix) ·
"today" / "tomorrow" / "fri" / "10/30". Example: `Send James layout fri !! @miner`

## Stages
1. Month/Week/Day, Work/Home/Both, rail, quick add + mic, Tomorrow pencil-in — DONE
2. Google Calendar sync (tasks with dates → events with alerts; meetings shown in Foreman)
3. Jobs tab with timeline bars; drag between days (drag is already in)
4. Nag engine (scheduled task reads nag_hours, pings phone), Gmail asks → unscheduled
5. Morning plan reads Foreman, reshuffle with approval, phone-first polish
