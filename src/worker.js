import { CARDS } from "./cards.js";

const CARD_BY_ID = new Map(CARDS.map((c) => [c.id, c]));

// Leitner boxes: how long until a card comes back after you get it right at this level.
// A miss drops the card to box 0, which brings it back within a couple of cards.
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const INTERVALS = [1 * MIN, 10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY];
const MAX_BOX = INTERVALS.length - 1;
const MASTERED_BOX = 4;

const SESSION_DAYS = 90;
const MAX_FAILS = 5;
const LOCK_MS = 5 * MIN;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, url);
    } catch (err) {
      console.error(err);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  },
};

async function route(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/signup" && method === "POST") return signup(request, env);
  if (path === "/api/login" && method === "POST") return login(request, env);
  if (path === "/api/logout" && method === "POST") return logout(request, env);

  const user = await currentUser(request, env);
  if (!user) return json({ error: "Not signed in." }, 401);

  if (path === "/api/me" && method === "GET") return json({ name: user.name, sets: setList(), score: await score(env, user.id) });
  if (path === "/api/next" && method === "GET") return nextCard(env, user, url);
  if (path === "/api/review" && method === "POST") return review(request, env, user);
  if (path === "/api/stats" && method === "GET") return stats(env, user, url);
  if (path === "/api/reset" && method === "POST") {
    await env.DB.prepare("DELETE FROM progress WHERE user_id = ?").bind(user.id).run();
    await env.DB.prepare("UPDATE users SET xp = 0, run_streak = 0, best_streak = 0 WHERE id = ?").bind(user.id).run();
    return json({ ok: true });
  }
  return json({ error: "Not found." }, 404);
}

/* ---------- profiles ---------- */

function cleanName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 40);
}
function validPin(pin) {
  return /^\d{4,8}$/.test(String(pin || ""));
}

async function signup(request, env) {
  const body = await request.json().catch(() => ({}));
  const name = cleanName(body.name);
  if (name.length < 2) return json({ error: "Please enter a name (at least 2 letters)." }, 400);
  if (!validPin(body.pin)) return json({ error: "PIN must be 4 to 8 digits." }, 400);

  const existing = await env.DB.prepare("SELECT id FROM users WHERE name = ?").bind(name).first();
  if (existing) return json({ error: "That name is taken. Try signing in, or pick another name." }, 409);

  const salt = randomHex(16);
  const pinHash = await hashPin(String(body.pin), salt);
  const res = await env.DB.prepare(
    "INSERT INTO users (name, pin_hash, salt, created_at) VALUES (?, ?, ?, ?)"
  ).bind(name, pinHash, salt, Date.now()).run();

  return startSession(env, res.meta.last_row_id, name);
}

async function login(request, env) {
  const body = await request.json().catch(() => ({}));
  const name = cleanName(body.name);
  const user = await env.DB.prepare(
    "SELECT id, name, pin_hash, salt, failed_attempts, locked_until FROM users WHERE name = ?"
  ).bind(name).first();
  if (!user) return json({ error: "No profile with that name. Create one first." }, 404);

  const now = Date.now();
  if (user.locked_until > now) {
    const mins = Math.ceil((user.locked_until - now) / MIN);
    return json({ error: `Too many wrong PINs. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` }, 429);
  }

  const hash = await hashPin(String(body.pin || ""), user.salt);
  if (!timingSafeEqual(hash, user.pin_hash)) {
    const fails = user.failed_attempts + 1;
    const locked = fails >= MAX_FAILS ? now + LOCK_MS : 0;
    await env.DB.prepare("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?")
      .bind(locked ? 0 : fails, locked, user.id).run();
    return json({ error: "Wrong PIN." }, 401);
  }

  await env.DB.prepare("UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE id = ?").bind(user.id).run();
  return startSession(env, user.id, user.name);
}

async function startSession(env, userId, name) {
  const token = randomHex(32);
  await env.DB.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)")
    .bind(token, userId, Date.now()).run();
  return json({ name, sets: setList(), score: await score(env, userId) }, 200, {
    "Set-Cookie": `sid=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
  });
}

async function logout(request, env) {
  const token = getCookie(request, "sid");
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return json({ ok: true }, 200, { "Set-Cookie": "sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });
}

async function currentUser(request, env) {
  const token = getCookie(request, "sid");
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT u.id, u.name, s.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?"
  ).bind(token).first();
  if (!row) return null;
  if (Date.now() - row.created_at > SESSION_DAYS * DAY) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return null;
  }
  return { id: row.id, name: row.name };
}

/* ---------- practice ---------- */

function lessonNum(set) {
  const m = /(\d+)/.exec(set || "");
  return m ? Number(m[1]) : 0;
}

function setList() {
  const counts = new Map();
  for (const c of CARDS) counts.set(c.set || "All", (counts.get(c.set || "All") || 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count, num: lessonNum(name) }))
    .sort((a, b) => a.num - b.num);
}

// "Lesson 5" = that lesson only; "range:3-7" = Lessons 3 through 7; "upto:5" = Lessons 1 through 5.
function cardsInScope(set) {
  if (!set) return CARDS;
  const range = /^range:(\d+)-(\d+)$/.exec(set);
  if (range) {
    const lo = Math.min(Number(range[1]), Number(range[2]));
    const hi = Math.max(Number(range[1]), Number(range[2]));
    return CARDS.filter((c) => lessonNum(c.set) >= lo && lessonNum(c.set) <= hi);
  }
  if (set.startsWith("upto:")) {
    const max = Number(set.slice(5));
    return CARDS.filter((c) => lessonNum(c.set) <= max);
  }
  return CARDS.filter((c) => (c.set || "All") === set);
}

async function progressMap(env, userId) {
  const { results } = await env.DB.prepare(
    "SELECT card_id, box, correct, missed, streak, due_at, last_seen FROM progress WHERE user_id = ?"
  ).bind(userId).all();
  return new Map(results.map((r) => [r.card_id, r]));
}

// How much a card needs practice: misses push it up, correct answers pull it down.
function difficulty(p) {
  return p.missed * 2 - p.correct - p.box;
}

async function nextCard(env, user, url) {
  const set = url.searchParams.get("set") || "";
  const skip = url.searchParams.get("skip") || ""; // the card just shown, so it doesn't repeat back-to-back
  const extra = url.searchParams.get("extra") === "1";
  const scope = cardsInScope(set);
  if (!scope.length) return json({ done: true, empty: true });

  const prog = await progressMap(env, user.id);
  const now = Date.now();

  const seen = [];
  const unseen = [];
  for (const c of scope) (prog.has(c.id) ? seen : unseen).push(c);

  // 1. Cards that are due, hardest first.
  const due = seen
    .filter((c) => prog.get(c.id).due_at <= now && c.id !== skip)
    .sort((a, b) => difficulty(prog.get(b.id)) - difficulty(prog.get(a.id)) || prog.get(a.id).due_at - prog.get(b.id).due_at);

  let pick = due.length ? pickFromTop(due, 3) : null;

  // 2. Otherwise introduce a new card, in deck order.
  if (!pick && unseen.length) pick = unseen.find((c) => c.id !== skip) || unseen[0];

  // 3. Nothing due: either report "caught up" or, for extra practice, drill the weakest cards.
  if (!pick) {
    if (!extra) {
      const nextDue = Math.min(...seen.map((c) => prog.get(c.id).due_at));
      return json({ done: true, nextDue });
    }
    const weakest = seen
      .filter((c) => c.id !== skip || seen.length === 1)
      .sort((a, b) => difficulty(prog.get(b.id)) - difficulty(prog.get(a.id)) || prog.get(a.id).due_at - prog.get(b.id).due_at);
    pick = pickFromTop(weakest, 2);
  }

  const p = prog.get(pick.id);
  return json({
    card: pick,
    isNew: !p,
    record: p ? { correct: p.correct, missed: p.missed, box: p.box } : null,
    dueCount: due.length,
    newCount: unseen.length,
  });
}

function pickFromTop(list, n) {
  const top = list.slice(0, Math.min(n, list.length));
  return top[Math.floor(Math.random() * top.length)];
}

async function review(request, env, user) {
  const body = await request.json().catch(() => ({}));
  const card = CARD_BY_ID.get(body.cardId);
  if (!card) return json({ error: "Unknown card." }, 400);
  const right = body.result === "right";
  const now = Date.now();

  const p = (await env.DB.prepare(
    "SELECT box, correct, missed, streak FROM progress WHERE user_id = ? AND card_id = ?"
  ).bind(user.id, card.id).first()) || { box: 0, correct: 0, missed: 0, streak: 0 };

  let box, streak;
  if (right) {
    streak = p.streak + 1;
    box = Math.min(MAX_BOX, p.box + 1);
  } else {
    streak = 0;
    box = 0;
  }
  // A card missed often stays on a short leash: cap its box until it earns its way back.
  const troubled = p.missed + (right ? 0 : 1) >= 3 && streak < 3;
  if (troubled) box = Math.min(box, 2);
  const dueAt = now + INTERVALS[box];

  await env.DB.prepare(
    `INSERT INTO progress (user_id, card_id, box, correct, missed, streak, due_at, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, card_id) DO UPDATE SET
       box = excluded.box, correct = excluded.correct, missed = excluded.missed,
       streak = excluded.streak, due_at = excluded.due_at, last_seen = excluded.last_seen`
  ).bind(user.id, card.id, box, p.correct + (right ? 1 : 0), p.missed + (right ? 0 : 1), streak, dueAt, now).run();

  // Points: 10 per right answer plus a bonus that grows with your run of right answers (max +10).
  // A miss still earns 1 point for effort and resets the run.
  const u = await env.DB.prepare("SELECT run_streak FROM users WHERE id = ?").bind(user.id).first();
  const run = right ? (u?.run_streak || 0) + 1 : 0;
  const gained = right ? 10 + Math.min(run - 1, 10) : 1;
  await env.DB.prepare(
    "UPDATE users SET xp = xp + ?, run_streak = ?, best_streak = MAX(best_streak, ?) WHERE id = ?"
  ).bind(gained, run, run, user.id).run();

  return json({ box, dueAt, streak, gained, score: await score(env, user.id) });
}

const LEVEL_XP = 250;
async function score(env, userId) {
  const u = await env.DB.prepare("SELECT xp, run_streak, best_streak FROM users WHERE id = ?").bind(userId).first();
  const t = await env.DB.prepare(
    `SELECT COALESCE(SUM(correct),0) AS right, COALESCE(SUM(missed),0) AS missed,
            COALESCE(SUM(CASE WHEN box >= ${MASTERED_BOX} THEN 1 ELSE 0 END),0) AS mastered
     FROM progress WHERE user_id = ?`
  ).bind(userId).first();
  const xp = u?.xp || 0;
  return {
    xp,
    level: Math.floor(xp / LEVEL_XP) + 1,
    levelProgress: (xp % LEVEL_XP) / LEVEL_XP,
    toNextLevel: LEVEL_XP - (xp % LEVEL_XP),
    run: u?.run_streak || 0,
    best: u?.best_streak || 0,
    right: t.right,
    missed: t.missed,
    mastered: t.mastered,
    total: CARDS.length,
  };
}

async function stats(env, user, url) {
  const set = url.searchParams.get("set") || "";
  const scope = cardsInScope(set);
  const prog = await progressMap(env, user.id);
  const now = Date.now();

  let mastered = 0, learning = 0, fresh = 0, due = 0;
  const trouble = [];
  for (const c of scope) {
    const p = prog.get(c.id);
    if (!p) { fresh++; continue; }
    if (p.due_at <= now) due++;
    if (p.box >= MASTERED_BOX) mastered++;
    else learning++;
    if (p.missed > 0 && (p.missed >= p.correct || p.box <= 1)) {
      trouble.push({ ...c, missed: p.missed, correct: p.correct });
    }
  }
  trouble.sort((a, b) => b.missed - a.missed || a.correct - b.correct);
  return json({ total: scope.length, mastered, learning, fresh, due, trouble: trouble.slice(0, 25) });
}

/* ---------- helpers ---------- */

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function randomHex(bytes) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPin(pin, saltHex) {
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
