// ============================================================
//  FOREMAN  ·  app.js
//  Month / Week / Day calendar · Work / Home / Both · skinny rail that
//  widens on click · quick add (type or speak) · Tomorrow pencil-in.
//  Data: Supabase tables fm_tasks / fm_jobs (RLS, owner only).
// ============================================================
import { db } from "./supabase.js";
import { CONFIG } from "./config.js";
import { initAuth } from "./auth.js";

// ---------- tiny helpers ----------
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const todayISO = () => iso(new Date());
const daysBetween = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 86400000);
const fmtLong = (s) => fromISO(s).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
const fmtShort = (s) => fromISO(s).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const PRI = {
  urgent: { mark: "!!", label: "Urgent" },
  high:   { mark: "▲",  label: "High" },
  normal: { mark: "●",  label: "Normal" },
  low:    { mark: "–",  label: "Low" },
};
const PRI_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
const STATUS = { not_started: "Not started", working: "Working", waiting: "Waiting on", done: "Done" };
const SIZE = { "15m": "15 min", "1h": "1 hr", half: "Half day", full: "Full day" };

// ---------- state ----------
const state = {
  bucket: localStorage.getItem("fm.bucket") || "work",   // work | home | both
  view:   localStorage.getItem("fm.view")   || "month",  // month | week | day
  cursor: new Date(),                                    // which month/week/day we're looking at
  selected: null,                                        // ISO date opened in the rail
  panel: null,                                           // 'day' | 'unscheduled' | 'tomorrow' | null
  openId: null,                                          // expanded task id
  editId: null,                                          // task in edit mode
  tasks: [],
  jobs: [],
  showDone: false,
};

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), 2200);
}

// ---------- data ----------
async function loadAll() {
  const [t, j] = await Promise.all([
    db.from("fm_tasks").select("*").order("sort").order("created_at"),
    db.from("fm_jobs").select("*").eq("active", true).order("bucket").order("sort"),
  ]);
  if (t.error) { toast("Load failed: " + t.error.message); return; }
  state.tasks = t.data || [];
  state.jobs = j.data || [];
  render();
}

async function saveTask(id, patch) {
  const { error } = await db.from("fm_tasks").update(patch).eq("id", id);
  if (error) { toast("Save failed: " + error.message); return false; }
  const t = state.tasks.find((x) => x.id === id);
  if (t) Object.assign(t, patch);
  render();
  return true;
}

async function insertTask(row) {
  const { data, error } = await db.from("fm_tasks").insert(row).select().single();
  if (error) { toast("Add failed: " + error.message); return null; }
  state.tasks.push(data);
  render();
  return data;
}

async function deleteTask(id) {
  const { error } = await db.from("fm_tasks").delete().eq("id", id);
  if (error) { toast("Delete failed: " + error.message); return; }
  state.tasks = state.tasks.filter((t) => t.id !== id);
  if (state.openId === id) state.openId = null;
  render();
}

// realtime: if Claude (or another window) changes a task, this window follows
let liveChannel = null;
let refreshQueued = false;
let lastRefresh = 0;

// don't redraw under Adam's fingers: skip while he is editing or typing
function userIsTyping() {
  if (state.editId != null) return true;
  const a = document.activeElement;
  return !!a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && a.type !== "checkbox" && a.value));
}

async function refresh() {
  if (document.hidden) return;
  if (userIsTyping()) { refreshQueued = true; return; }
  refreshQueued = false;
  lastRefresh = Date.now();
  await loadAll();
}

function subscribe() {
  if (liveChannel) { try { db.removeChannel(liveChannel); } catch (e) {} }
  liveChannel = db.channel("fm_tasks_live_" + Date.now())
    .on("postgres_changes", { event: "*", schema: "public", table: "fm_tasks" }, () => refresh())
    .subscribe((status) => {
      if (status === "SUBSCRIBED") refresh();
      if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") setTimeout(subscribe, 3000);
    });
}

// belt and braces: catch up when the tab wakes, the network returns, and every 30 s
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
window.addEventListener("focus", () => refresh());
window.addEventListener("online", () => { subscribe(); refresh(); });
setInterval(() => { if (!document.hidden && (Date.now() - lastRefresh) > 25000) refresh(); }, 30000);
setInterval(() => { if (refreshQueued && !userIsTyping()) refresh(); }, 2000);

// ---------- derived ----------
const inBucket = (t) => state.bucket === "both" || t.bucket === state.bucket;
const visible = (t) => inBucket(t) && (state.showDone || t.status !== "done");
const tasksOn = (dateISO) => state.tasks.filter((t) => visible(t) && t.scheduled_date === dateISO).sort(byPriority);
const unscheduled = () => state.tasks.filter((t) => visible(t) && !t.scheduled_date).sort(byPriority);
function byPriority(a, b) {
  return (PRI_ORDER[a.priority] - PRI_ORDER[b.priority]) || (a.sort - b.sort) || (a.id - b.id);
}

// one short status line per task: never color alone
function statusLine(t) {
  const today = todayISO();
  if (t.status === "done") return { text: "Done", cls: "" };
  if (t.dropdead_date && t.dropdead_date < today) return { text: `Overdue ${daysBetween(t.dropdead_date, today)}d`, cls: "overdue" };
  if (t.status === "waiting") return { text: `Waiting on ${t.waiting_on || "…"}`, cls: "warn" };
  if (t.target_date && t.target_date < today) return { text: "Target missed", cls: "warn" };
  if (t.planned) return { text: "Planned", cls: "" };
  return { text: STATUS[t.status] || "Not started", cls: "" };
}

function tooltip(t) {
  const parts = [`${PRI[t.priority].label}`, STATUS[t.status]];
  if (t.job) parts.push(t.job);
  if (t.target_date) parts.push("Target " + fmtShort(t.target_date));
  if (t.dropdead_date) parts.push("Drop-dead " + fmtShort(t.dropdead_date));
  if (t.promised_to) parts.push("Promised to " + t.promised_to);
  return parts.join(" · ");
}

// ---------- render ----------
function render() {
  renderTop();
  renderCalendar();
  renderRail();
  $("layout").classList.toggle("wide", !!state.panel);
}

function renderTop() {
  document.querySelectorAll("#bucket-seg button").forEach((b) => b.classList.toggle("on", b.dataset.bucket === state.bucket));
  document.querySelectorAll("#view-seg button").forEach((b) => b.classList.toggle("on", b.dataset.view === state.view));
}

function renderCalendar() {
  const body = $("cal-body");
  body.innerHTML = "";
  if (state.view === "month") renderMonth(body);
  else if (state.view === "week") renderWeek(body);
  else renderDay(body);
}

function chipFor(t) {
  const c = el("span", `chip p-${t.priority}` + (t.planned ? " planned" : "") + (t.bucket === "home" && state.bucket === "both" ? " bucket-home" : "") + (t.status === "done" ? " is-done" : ""));
  c.textContent = `${PRI[t.priority].mark} ${t.title}`;
  c.title = tooltip(t);
  c.draggable = true;
  c.dataset.id = t.id;
  c.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", String(t.id)); e.dataTransfer.effectAllowed = "move"; });
  c.addEventListener("click", (e) => { e.stopPropagation(); openDay(t.scheduled_date, t.id); });
  return c;
}

function dayCell(d, { other = false, max = 4 } = {}) {
  const dISO = iso(d);
  const cell = el("div", "day");
  if (other) cell.classList.add("other");
  if (d.getDay() === 0 || d.getDay() === 6) cell.classList.add("weekend");
  if (dISO === todayISO()) cell.classList.add("today");
  if (dISO === state.selected && state.panel === "day") cell.classList.add("selected");

  const items = tasksOn(dISO);
  const num = el("div", "num");
  num.append(el("span", "", String(d.getDate())));
  if (items.length) num.append(el("span", "count", `${items.length}`));
  cell.append(num);
  items.slice(0, max).forEach((t) => cell.append(chipFor(t)));
  if (items.length > max) cell.append(el("div", "more", `+${items.length - max} more`));

  cell.addEventListener("click", () => openDay(dISO));
  cell.addEventListener("dragover", (e) => { e.preventDefault(); cell.classList.add("drop"); });
  cell.addEventListener("dragleave", () => cell.classList.remove("drop"));
  cell.addEventListener("drop", async (e) => {
    e.preventDefault(); cell.classList.remove("drop");
    const id = Number(e.dataTransfer.getData("text/plain"));
    if (id) { await saveTask(id, { scheduled_date: dISO, planned: false }); toast("Moved to " + fmtShort(dISO)); }
  });
  return cell;
}

function renderMonth(body) {
  const c = state.cursor;
  $("cal-title").textContent = c.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const grid = el("div", "month");
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((d) => grid.append(el("div", "dow", d)));
  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  const lastDay = new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate();
  const rows = Math.ceil((first.getDay() + lastDay) / 7);
  grid.style.setProperty("--rows", rows);
  for (let i = 0; i < rows * 7; i++) {
    const d = addDays(start, i);
    grid.append(dayCell(d, { other: d.getMonth() !== c.getMonth(), max: rows >= 6 ? 3 : 4 }));
  }
  body.append(grid);
}

function weekStart(d) { return addDays(d, -d.getDay()); }

function renderWeek(body) {
  const s = weekStart(state.cursor), e = addDays(s, 6);
  $("cal-title").textContent = `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  const grid = el("div", "week");
  for (let i = 0; i < 7; i++) {
    const d = addDays(s, i);
    grid.append(el("div", "dow", d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" })));
  }
  for (let i = 0; i < 7; i++) grid.append(dayCell(addDays(s, i), { max: 12 }));
  body.append(grid);
}

function renderDay(body) {
  const dISO = iso(state.cursor);
  $("cal-title").textContent = fmtLong(dISO);
  const wrap = el("div", "dayview");
  const items = tasksOn(dISO);
  if (!items.length) wrap.append(el("div", "empty", "Nothing on this day. Drag something here or use Quick add."));
  items.forEach((t) => wrap.append(itemCard(t)));
  body.append(wrap);
}

// ---------- rail ----------
function renderRail() {
  const r = $("rail-body");
  r.innerHTML = "";
  if (state.panel === "day" && state.selected) return renderDayPanel(r);
  if (state.panel === "unscheduled") return renderUnscheduledPanel(r);
  if (state.panel === "tomorrow") return renderTomorrowPanel(r);
  if (state.panel === "brain") return renderBrainPanel(r);
  renderSkinny(r);
}

// ---------- Foreman brain (Supabase edge function foreman-brain) ----------
const brain = { busy: false, log: [], history: [], batch: null, questions: null, lastBatch: null };

async function askBrain(text) {
  if (!text || brain.busy) return;
  brain.busy = true; brain.questions = null;
  brain.log.push({ who: "you", text });
  state.panel = "brain"; state.openId = null; state.editId = null; render();
  const { data: s } = await db.auth.getSession();
  const now = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  try {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/foreman-brain`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CONFIG.SUPABASE_KEY, Authorization: `Bearer ${s.session.access_token}` },
      body: JSON.stringify({ text, today: todayISO(), now, history: brain.history, batch_id: brain.batch }),
    });
    const out = await res.json();
    brain.history.push({ role: "user", content: text });
    if (out.reply) brain.history.push({ role: "assistant", content: out.reply });
    brain.history = brain.history.slice(-10);
    brain.log.push({ who: "foreman", text: out.reply || "(no reply)", actions: out.actions || [], questions: out.questions || null });
    if (out.pending) { brain.batch = out.batch_id; brain.questions = out.questions; }
    else { brain.batch = null; if ((out.actions || []).length) brain.lastBatch = out.batch_id; }
  } catch (e) {
    brain.log.push({ who: "foreman", text: "Couldn't reach the brain: " + (e.message || e) });
  }
  brain.busy = false;
  await loadAll();
}

function answerQuestions(answers) {
  const text = "My answers: " + answers.map((a) => `${a.q} → ${a.a}`).join("; ") + ". Go ahead and file it.";
  askBrain(text);
}

async function undoLastBatch() {
  if (!brain.lastBatch) return;
  const { data: moves, error } = await db.from("fm_moves").select("*").eq("batch_id", brain.lastBatch).order("id", { ascending: false });
  if (error || !moves?.length) { toast("Nothing to undo"); return; }
  for (const m of moves) {
    if (m.kind === "add" && m.task_id) await db.from("fm_tasks").delete().eq("id", m.task_id);
    else if ((m.kind === "move" || m.kind === "update" || m.kind === "complete") && m.task_id && m.before) {
      const b = { ...m.before }; delete b.id; if (m.kind === "complete") b.done_at = null;
      await db.from("fm_tasks").update(b).eq("id", m.task_id);
    } else if (m.kind === "delete" && m.before) {
      const b = { ...m.before }; delete b.id; await db.from("fm_tasks").insert(b);
    }
  }
  await db.from("fm_moves").delete().eq("batch_id", brain.lastBatch);
  brain.log.push({ who: "foreman", text: `Undid ${moves.length} change${moves.length === 1 ? "" : "s"}.` });
  brain.lastBatch = null;
  await loadAll();
}

function renderBrainPanel(r) {
  panelHeader(r, "Foreman", brain.busy ? "thinking…" : "");
  const box = el("div", "brain");
  brain.log.slice(-8).forEach((m) => {
    const b = el("div", "bubble " + (m.who === "you" ? "you" : "fm"));
    b.append(el("div", "who", m.who === "you" ? "You" : "Foreman"));
    b.append(el("div", "txt", m.text));
    if (m.actions && m.actions.length) {
      const ul = el("ul", "acts");
      m.actions.forEach((a) => {
        let line = "";
        if (a.kind === "add") line = `Added "${a.title}"${a.to ? " on " + fmtShort(a.to) : " (unscheduled)"}`;
        else if (a.kind === "move") line = `Moved "${a.title}" ${a.from ? fmtShort(a.from) : "unscheduled"} → ${a.to ? fmtShort(a.to) : "unscheduled"}${a.reason ? ": " + a.reason : ""}`;
        else if (a.kind === "update") line = `Updated "${a.title}"${a.reason ? ": " + a.reason : ""}`;
        else if (a.kind === "complete") line = `Done: "${a.title}"`;
        else if (a.kind === "delete") line = `Deleted "${a.title}"`;
        ul.append(el("li", "", line));
      });
      b.append(ul);
    }
    box.append(b);
  });
  if (brain.busy) box.append(el("div", "hint", "Working on it…"));
  r.append(box);

  if (brain.questions && !brain.busy) {
    const qwrap = el("div", "questions");
    const picks = {};
    brain.questions.forEach((q) => {
      const card = el("div", "q");
      card.append(el("div", "qt", q.question));
      const opts = el("div", "opts");
      q.options.forEach((o) => {
        const b = el("button", "btn sm", o);
        b.addEventListener("click", () => { picks[q.id] = { q: q.question, a: o }; opts.querySelectorAll("button").forEach((x) => x.classList.remove("primary")); b.classList.add("primary"); });
        opts.append(b);
      });
      card.append(opts); qwrap.append(card);
    });
    const go = el("button", "btn primary", "Send answers");
    go.addEventListener("click", () => { const a = Object.values(picks); if (a.length < brain.questions.length) { toast("Answer each one"); return; } answerQuestions(a); });
    qwrap.append(go);
    r.append(qwrap);
  }

  const foot = el("div", "actions");
  const inp = el("input"); inp.type = "text"; inp.placeholder = "Say more…"; inp.className = "brain-input";
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && inp.value.trim()) { const v = inp.value.trim(); inp.value = ""; askBrain(v); } });
  const mic = el("button", "mic"); mic.type = "button"; mic.innerHTML = MIC_SVG; mic.title = "Speak";
  attachMic(mic, (v) => askBrain(v), (v) => { inp.value = v; });
  foot.append(inp, mic);
  if (brain.lastBatch && !brain.busy) { const u = el("button", "btn sm", "Undo last"); u.addEventListener("click", undoLastBatch); foot.append(u); }
  r.append(foot);
}

function miniRow(t) {
  const row = el("div", `row p-${t.priority}` + (t.planned ? " planned" : ""));
  const s = statusLine(t);
  row.innerHTML = `${esc(PRI[t.priority].mark)} ${esc(t.title)}<small>${esc(s.text)}${t.job ? " · " + esc(t.job) : ""}</small>`;
  row.title = tooltip(t);
  row.addEventListener("click", () => t.scheduled_date ? openDay(t.scheduled_date, t.id) : openUnscheduled(t.id));
  return row;
}

function renderSkinny(r) {
  const today = todayISO();
  // Today
  const h = el("h3"); h.append("Today", el("span", "muted", fmtShort(today)));
  r.append(h);
  const todayItems = tasksOn(today);
  const box = el("div", "mini");
  todayItems.forEach((t) => box.append(miniRow(t)));
  if (!todayItems.length) box.append(el("div", "empty", "Nothing scheduled today."));
  r.append(box);

  // Overdue / at risk (anywhere)
  const risky = state.tasks.filter((t) => visible(t) && t.scheduled_date !== today && (
    (t.dropdead_date && t.dropdead_date < today) || (t.target_date && t.target_date < today)
  )).sort(byPriority);
  if (risky.length) {
    r.append(el("h3", "", "Needs attention"));
    const b2 = el("div", "mini");
    risky.slice(0, 6).forEach((t) => b2.append(miniRow(t)));
    r.append(b2);
  }

  // This week counts
  const ws = iso(weekStart(new Date())), we = iso(addDays(weekStart(new Date()), 6));
  const wk = state.tasks.filter((t) => visible(t) && t.scheduled_date && t.scheduled_date >= ws && t.scheduled_date <= we);
  const n = (p) => wk.filter((t) => t.priority === p).length;
  const promises = wk.filter((t) => t.promised_to).length;
  r.append(el("h3", "", "This week"));
  const c = el("div", "counts");
  c.innerHTML = `${n("urgent")} urgent · ${n("high")} high · ${n("normal")} normal · ${n("low")} low<br>${promises} promise${promises === 1 ? "" : "s"} to people`;
  r.append(c);

  // Unscheduled
  const un = unscheduled();
  const h3 = el("h3"); h3.append("Unscheduled", el("span", "muted", String(un.length)));
  r.append(h3);
  const b3 = el("div", "mini");
  un.slice(0, 6).forEach((t) => b3.append(miniRow(t)));
  if (un.length > 6) { const more = el("button", "btn sm", `See all ${un.length}`); more.addEventListener("click", () => openUnscheduled()); b3.append(more); }
  if (!un.length) b3.append(el("div", "empty", "Nothing waiting to be scheduled."));
  r.append(b3);

  const sd = el("label", "hint");
  const cb = el("input"); cb.type = "checkbox"; cb.checked = state.showDone;
  cb.addEventListener("change", () => { state.showDone = cb.checked; render(); });
  sd.append(cb, " Show done items");
  r.append(sd);
}

function panelHeader(r, title, sub) {
  const h = el("h3"); h.append(title);
  if (sub) h.append(el("span", "muted", sub));
  const x = el("button", "btn ghost sm close", "✕"); x.title = "Close (Esc)";
  x.addEventListener("click", closePanel);
  h.append(x);
  r.append(h);
}

function renderDayPanel(r) {
  const d = state.selected;
  const items = tasksOn(d);
  panelHeader(r, fmtLong(d), `${items.length} item${items.length === 1 ? "" : "s"}`);
  if (!items.length) r.append(el("div", "empty", "Nothing here yet. Quick add puts new things on this day."));
  items.forEach((t) => r.append(itemCard(t)));
  // coming up (next 5 days)
  const soon = [];
  for (let i = 1; i <= 5; i++) { const dd = iso(addDays(fromISO(d), i)); tasksOn(dd).forEach((t) => soon.push(t)); }
  if (soon.length) {
    r.append(el("h3", "", "Coming up"));
    const c = el("div", "counts");
    c.innerHTML = soon.slice(0, 8).map((t) => `${esc(fmtShort(t.scheduled_date).split(" ")[0])} ${esc(PRI[t.priority].mark)} ${esc(t.title)}`).join("<br>");
    r.append(c);
  }
}

function renderUnscheduledPanel(r) {
  const items = unscheduled();
  panelHeader(r, "Unscheduled", String(items.length));
  r.append(el("div", "hint", "Give each one a day: open it and set Scheduled, or drag its chip onto the calendar from the day panel."));
  items.forEach((t) => r.append(itemCard(t)));
}

function renderTomorrowPanel(r) {
  const tmr = iso(addDays(new Date(), 1));
  panelHeader(r, "Tomorrow", fmtShort(tmr));
  const wrap = el("div", "tomorrow");
  wrap.append(el("div", "hint", "What do you want to work on tomorrow? One per line. They land as Planned (dashed) on tomorrow; the 5:30 a.m. plan builds the day around them."));
  const ta = el("textarea"); ta.placeholder = "Miner L2 leave-outs\nC1 DWG export\n…";
  const taWrap = el("div", "ta-wrap"); taWrap.append(ta);
  const mic = el("button", "mic"); mic.type = "button"; mic.title = "Speak it"; mic.setAttribute("aria-label", "Speak tomorrow's list");
  mic.innerHTML = MIC_SVG;
  attachMic(mic, (text) => { ta.value = (ta.value ? ta.value.replace(/\s*$/, "\n") : "") + text; });
  taWrap.append(mic);
  wrap.append(taWrap);
  const act = el("div", "actions");
  const plan = el("button", "btn primary", "Plan it with Foreman");
  plan.addEventListener("click", () => {
    const v = ta.value.trim(); if (!v) return;
    ta.value = "";
    askBrain(`Tomorrow (${tmr}) I want to work on: ${v}. Pencil these in on tomorrow as planned, and reshuffle anything else on tomorrow that no longer fits.`);
  });
  const save = el("button", "btn", "Just pencil in (no reshuffle)");
  save.addEventListener("click", async () => {
    const lines = ta.value.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return;
    for (const line of lines) {
      const p = parseQuick(line);
      await insertTask({ title: p.title, priority: p.priority, bucket: p.bucket || (state.bucket === "both" ? "work" : state.bucket), scheduled_date: tmr, planned: true, job: p.job, source: "tomorrow" });
    }
    ta.value = "";
    toast(`${lines.length} penciled in for tomorrow`);
  });
  act.append(plan, save);
  wrap.append(act);
  r.append(wrap);

  const existing = tasksOn(tmr);
  r.append(el("h3", "", "Already on tomorrow"));
  if (!existing.length) r.append(el("div", "empty", "Nothing yet."));
  existing.forEach((t) => r.append(itemCard(t)));
}

// ---------- item card ----------
function itemCard(t) {
  const card = el("div", `item p-${t.priority}` + (t.planned ? " planned" : "") + (t.status === "done" ? " is-done" : ""));
  card.dataset.id = t.id;
  const head = el("div", "head");
  const chip = el("span", `chip p-${t.priority}`, `${PRI[t.priority].mark} ${PRI[t.priority].label}`);
  const title = el("span", "title", t.title);
  const s = statusLine(t);
  const st = el("span", `status-pill ${s.cls}`, s.text);
  const caret = el("span", "caret", state.openId === t.id ? "▴" : "▾");
  head.append(chip, title, st, caret);
  head.addEventListener("click", () => { state.openId = state.openId === t.id ? null : t.id; state.editId = null; render(); });
  card.append(head);

  if (state.openId === t.id) {
    if (state.editId === t.id) card.append(editForm(t));
    else {
      const d = el("div", "detail");
      const bits = [];
      if (t.job) bits.push(`<b>Job:</b> ${esc(t.job)}`);
      if (t.size) bits.push(`<b>Size:</b> ${esc(SIZE[t.size])}`);
      bits.push(`<b>Calendar:</b> ${t.bucket === "home" ? "Home" : "Work"}`);
      d.innerHTML = bits.join(" · ") + "<br>"
        + `<b>Scheduled:</b> ${t.scheduled_date ? esc(fmtShort(t.scheduled_date)) : "—"} · `
        + `<b>Target:</b> ${t.target_date ? esc(fmtShort(t.target_date)) : "—"} · `
        + `<b>Drop-dead:</b> ${t.dropdead_date ? esc(fmtShort(t.dropdead_date)) : "—"}`
        + (t.promised_to ? `<br><b>Promised to:</b> ${esc(t.promised_to)}` : "")
        + (t.nag_hours ? `<br><b>Nag:</b> every ${t.nag_hours} hr${t.nag_hours === 1 ? "" : "s"} until done` : "")
        + (t.notes ? `<br><b>Notes:</b> ${esc(t.notes)}` : "");
      card.append(d);

      const a = el("div", "actions");
      const btn = (label, fn, cls = "btn sm") => { const b = el("button", cls, label); b.addEventListener("click", fn); return b; };
      if (t.status !== "done") a.append(btn("✓ Done", () => saveTask(t.id, { status: "done", done_at: new Date().toISOString() })));
      else a.append(btn("Reopen", () => saveTask(t.id, { status: "not_started", done_at: null })));
      if (t.status === "not_started" || t.status === "waiting") a.append(btn("Working", () => saveTask(t.id, { status: "working" })));
      if (t.planned) a.append(btn("Make it real", () => saveTask(t.id, { planned: false })));
      a.append(btn("Tomorrow", () => saveTask(t.id, { scheduled_date: iso(addDays(new Date(), 1)) })));
      a.append(btn("+1 wk", () => saveTask(t.id, { scheduled_date: iso(addDays(t.scheduled_date ? fromISO(t.scheduled_date) : new Date(), 7)) })));
      a.append(btn("Edit", () => { state.editId = t.id; render(); }));
      a.append(btn("Delete", async () => { if (confirm(`Delete "${t.title}"?`)) await deleteTask(t.id); }, "btn sm danger"));
      card.append(a);
    }
  }
  return card;
}

function editForm(t) {
  const f = el("form", "form");
  const field = (label, name, type = "text", value = "", full = false) => {
    const l = el("label", full ? "full" : "", label);
    const i = el("input"); i.type = type; i.name = name; i.value = value ?? "";
    l.append(i); return l;
  };
  const sel = (label, name, opts, value, full = false) => {
    const l = el("label", full ? "full" : "", label);
    const s = el("select"); s.name = name;
    opts.forEach(([v, txt]) => { const o = el("option", "", txt); o.value = v; if (v === (value ?? "")) o.selected = true; s.append(o); });
    l.append(s); return l;
  };
  f.append(field("Title", "title", "text", t.title, true));
  f.append(sel("Priority", "priority", Object.entries(PRI).map(([k, v]) => [k, `${v.mark} ${v.label}`]), t.priority));
  f.append(sel("Calendar", "bucket", [["work", "Work"], ["home", "Home"]], t.bucket));
  f.append(sel("Job", "job", [["", "—"], ...state.jobs.map((j) => [j.name, j.name])], t.job || ""));
  f.append(sel("Size", "size", [["", "—"], ...Object.entries(SIZE)], t.size || ""));
  f.append(field("Scheduled (on calendar)", "scheduled_date", "date", t.scheduled_date || ""));
  f.append(sel("Status", "status", Object.entries(STATUS), t.status));
  f.append(field("Target date (want it done by)", "target_date", "date", t.target_date || ""));
  f.append(field("Drop-dead date (must be done by)", "dropdead_date", "date", t.dropdead_date || ""));
  f.append(field("Promised to", "promised_to", "text", t.promised_to || ""));
  f.append(field("Waiting on (if status is Waiting)", "waiting_on", "text", t.waiting_on || ""));
  f.append(sel("Nag until done", "nag_hours", [["0", "No nag"], ["1", "Every hour"], ["2", "Every 2 hrs"], ["4", "Every 4 hrs"], ["24", "Once a day"]], String(t.nag_hours || 0)));
  const notes = el("label", "full", "Notes"); const ta = el("textarea"); ta.name = "notes"; ta.value = t.notes || ""; notes.append(ta); f.append(notes);
  const a = el("div", "actions");
  const save = el("button", "btn primary sm", "Save"); save.type = "submit";
  const cancel = el("button", "btn sm", "Cancel"); cancel.type = "button";
  cancel.addEventListener("click", () => { state.editId = null; render(); });
  a.append(save, cancel); f.append(a);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const g = (k) => (fd.get(k) || "").toString().trim();
    const patch = {
      title: g("title") || t.title, priority: g("priority"), bucket: g("bucket"), job: g("job") || null,
      size: g("size") || null, scheduled_date: g("scheduled_date") || null, status: g("status"),
      target_date: g("target_date") || null, dropdead_date: g("dropdead_date") || null,
      promised_to: g("promised_to") || null, waiting_on: g("waiting_on") || null,
      nag_hours: Number(g("nag_hours") || 0), notes: g("notes") || null,
    };
    if (patch.status === "done" && !t.done_at) patch.done_at = new Date().toISOString();
    if (patch.status !== "done") patch.done_at = null;
    if (patch.scheduled_date) patch.planned = t.planned && patch.scheduled_date === t.scheduled_date ? t.planned : false;
    state.editId = null;
    if (await saveTask(t.id, patch)) toast("Saved");
  });
  return f;
}

// ---------- panels ----------
function openDay(dateISO, taskId = null) {
  if (!dateISO) return openUnscheduled(taskId);
  state.selected = dateISO; state.panel = "day"; state.openId = taskId; state.editId = null;
  render();
}
function openUnscheduled(taskId = null) { state.panel = "unscheduled"; state.openId = taskId; state.editId = null; render(); }
function openTomorrow() { state.panel = "tomorrow"; state.openId = null; state.editId = null; render(); }
function closePanel() { state.panel = null; state.openId = null; state.editId = null; render(); }

// ---------- quick add parsing ----------
// "Send James layout fri !!"  → title, priority urgent, date next Friday
// "#home" → home calendar · "@miner" → job · "tomorrow"/"today"/"mon".."sun"/"10/30"
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function parseQuick(text) {
  let t = " " + text.trim() + " ";
  const out = { priority: "normal", bucket: null, job: null, date: null };
  if (/\s!!\s|\burgent\b/i.test(t)) { out.priority = "urgent"; t = t.replace(/\s!!\s/g, " ").replace(/\burgent\b/ig, " "); }
  else if (/\s!\s|\bhigh\b/i.test(t)) { out.priority = "high"; t = t.replace(/\s!\s/g, " ").replace(/\bhigh\b/ig, " "); }
  else if (/\blow\b/i.test(t)) { out.priority = "low"; t = t.replace(/\blow\b/ig, " "); }
  const bm = t.match(/#(work|home)\b/i); if (bm) { out.bucket = bm[1].toLowerCase(); t = t.replace(bm[0], " "); }
  const jm = t.match(/@([\w&-]+)/); if (jm) {
    const j = state.jobs.find((x) => x.name.toLowerCase().startsWith(jm[1].toLowerCase()));
    out.job = j ? j.name : jm[1]; t = t.replace(jm[0], " ");
  }
  const today = new Date();
  if (/\btomorrow\b/i.test(t)) { out.date = iso(addDays(today, 1)); t = t.replace(/\btomorrow\b/ig, " "); }
  else if (/\btoday\b/i.test(t)) { out.date = todayISO(); t = t.replace(/\btoday\b/ig, " "); }
  else {
    const dm = t.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i);
    if (dm) { const want = DOW.indexOf(dm[1].toLowerCase()); let d = addDays(today, 1); while (d.getDay() !== want) d = addDays(d, 1); out.date = iso(d); t = t.replace(dm[0], " "); }
    const nm = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
    if (nm) { const d = new Date(today.getFullYear(), Number(nm[1]) - 1, Number(nm[2])); if (d < today) d.setFullYear(d.getFullYear() + 1); out.date = iso(d); t = t.replace(nm[0], " "); }
  }
  out.title = t.replace(/\s+/g, " ").trim();
  return out;
}

async function quickAdd(text) {
  const p = parseQuick(text);
  if (!p.title) return;
  const date = p.date || (state.panel === "day" && state.selected ? state.selected : (state.view === "day" ? iso(state.cursor) : todayISO()));
  const row = { title: p.title, priority: p.priority, bucket: p.bucket || (state.bucket === "both" ? "work" : state.bucket), job: p.job, scheduled_date: date, source: "quick" };
  const t = await insertTask(row);
  if (!t) return;
  toast(`Added to ${fmtShort(date)} — set target and drop-dead if it has them`);
  // open it in edit mode so target / drop-dead get asked right away
  state.selected = date; state.panel = "day"; state.openId = t.id; state.editId = t.id;
  render();
}

// ---------- voice (Web Speech API) ----------
const MIC_SVG = '<svg class="mic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>';

// attach push-to-talk to a button; onFinal(text) fires once when listening stops
function attachMic(btn, onFinal, onInterim) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { btn.title = "Voice needs Chrome or Edge"; btn.disabled = true; return; }
  let rec = null, heard = "";
  btn.addEventListener("click", () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = "en-US"; rec.interimResults = true; heard = "";
    btn.classList.add("listening");
    rec.onresult = (e) => { heard = Array.from(e.results).map((r) => r[0].transcript).join(""); if (onInterim) onInterim(heard); };
    rec.onend = () => { btn.classList.remove("listening"); rec = null; const v = heard.trim(); if (v) onFinal(v); };
    rec.onerror = () => { btn.classList.remove("listening"); rec = null; };
    rec.start();
  });
}

function initMic() {
  // the mic goes straight to Foreman's brain: brain-dump, it sorts it out
  attachMic($("mic-btn"), (v) => { $("quick-input").value = ""; askBrain(v); }, (v) => { $("quick-input").value = v; });
  $("tell-btn").addEventListener("click", () => { const v = $("quick-input").value.trim(); if (!v) { $("quick-input").focus(); return; } $("quick-input").value = ""; askBrain(v); });
}

// ---------- full screen ----------
function initFullscreen() {
  const btn = $("full-btn");
  const sync = () => { btn.textContent = document.fullscreenElement ? "⛶ Exit full screen" : "⛶ Full screen"; };
  btn.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => toast("Full screen not available here"));
  });
  document.addEventListener("fullscreenchange", sync);
  sync();
}

// ---------- nav ----------
function shift(n) {
  const c = state.cursor;
  if (state.view === "month") state.cursor = new Date(c.getFullYear(), c.getMonth() + n, 1);
  else if (state.view === "week") state.cursor = addDays(c, 7 * n);
  else state.cursor = addDays(c, n);
  render();
}

function wire() {
  $("bucket-seg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; state.bucket = b.dataset.bucket; localStorage.setItem("fm.bucket", state.bucket); render(); });
  $("view-seg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; state.view = b.dataset.view; localStorage.setItem("fm.view", state.view); if (state.view === "day" && state.selected) state.cursor = fromISO(state.selected); render(); });
  $("prev-btn").addEventListener("click", () => shift(-1));
  $("next-btn").addEventListener("click", () => shift(1));
  $("today-btn").addEventListener("click", () => { state.cursor = new Date(); render(); });
  $("tomorrow-btn").addEventListener("click", openTomorrow);
  $("quick-add").addEventListener("submit", async (e) => { e.preventDefault(); const v = $("quick-input").value.trim(); if (!v) return; $("quick-input").value = ""; await quickAdd(v); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (state.editId) { state.editId = null; render(); } else if (state.panel) closePanel(); }
    if (e.key === "/" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") { e.preventDefault(); $("quick-input").focus(); }
  });
  initMic();
  initFullscreen();
}

// ---------- boot ----------
document.addEventListener("app:ready", async () => {
  await loadAll();
  subscribe();
});
wire();
initAuth();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
