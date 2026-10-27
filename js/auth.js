// ============================================================
//  AUTH  ·  Supabase email login — OWNER ONLY
// ============================================================
import { db } from "./supabase.js";
import { CONFIG } from "./config.js";

const $ = (id) => document.getElementById(id);
let shown = null;

function setMsg(text, kind = "") {
  const m = $("login-msg");
  m.textContent = text;
  m.className = "msg " + kind;
}

const isOwner = (s) => !!(s && s.user && s.user.id === CONFIG.OWNER_ID);

function showApp(session) {
  if (shown === "app") return;
  shown = "app";
  $("login-screen").classList.add("hidden");
  $("app").classList.remove("hidden");
  document.dispatchEvent(new CustomEvent("app:ready", { detail: { session } }));
}

function showLogin() {
  if (shown === "login") return;
  shown = "login";
  $("app").classList.add("hidden");
  $("login-screen").classList.remove("hidden");
}

let rejecting = false;
async function rejectStranger() {
  if (rejecting) return;
  rejecting = true;
  showLogin();
  setMsg("This app is private to its owner.", "err");
  try { await db.auth.signOut(); } catch (_) {}
  rejecting = false;
}

function route(session) {
  if (!session) { showLogin(); return; }
  if (isOwner(session)) showApp(session); else rejectStranger();
}

export async function initAuth() {
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("login-email").value.trim();
    const password = $("login-password").value;
    if (!email || !password) { setMsg("Enter email and password.", "err"); return; }
    $("login-submit").disabled = true;
    setMsg("Working…");
    const { error } = await db.auth.signInWithPassword({ email, password });
    $("login-submit").disabled = false;
    if (error) setMsg(error.message, "err"); else setMsg("");
  });
  $("logout-btn").addEventListener("click", async () => { await db.auth.signOut(); });
  db.auth.onAuthStateChange((_e, session) => route(session));
  const { data } = await db.auth.getSession();
  route(data.session);
}
