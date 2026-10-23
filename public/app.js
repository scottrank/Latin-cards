const $ = (id) => document.getElementById(id);

const state = {
  mode: "login",
  set: "",
  card: null,
  flipped: false,
  busy: false,
  extra: false,
  lastId: "",
};

/* ---------- api ---------- */
async function api(path, body) {
  const res = await fetch(path, body === undefined
    ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("/api/login")) { showAuth(); throw new Error("signed out"); }
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

/* ---------- views ---------- */
function show(view) {
  for (const v of ["auth", "practice", "progress"]) $("view-" + v).hidden = v !== view;
  document.querySelectorAll("nav [data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view === "practice") loadNext();
  if (view === "progress") loadStats();
}

function showAuth() {
  $("nav").hidden = true;
  show("auth");
  $("auth-name").focus();
}

function enterApp(me) {
  $("nav").hidden = false;
  $("who").textContent = me.name;
  state.user = me.name;
  state.lessons = me.sets.map((s) => s.num).filter(Boolean);
  state.minLesson = Math.min(...state.lessons);
  state.maxLesson = Math.max(...state.lessons);
  for (const el of [$("range-from"), $("range-to")]) { el.min = state.minLesson; el.max = state.maxLesson; }
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("range") || "null"); } catch {}
  setRange(saved?.from ?? state.minLesson, saved?.to ?? state.maxLesson, false);
  renderScore(me.score);
  show("practice");
}

/* ---------- lesson range ---------- */
function setRange(from, to, reload = true) {
  const clamp = (n) => Math.min(state.maxLesson, Math.max(state.minLesson, Math.round(Number(n)) || state.minLesson));
  let a = clamp(from), b = clamp(to);
  if (a > b) [a, b] = [b, a];
  $("range-from").value = a;
  $("range-to").value = b;
  state.set = `range:${a}-${b}`;
  const any = state.lessons.some((n) => n >= a && n <= b);
  $("range-note").textContent = any ? "" : (a === b ? `There are no cards for Lesson ${a}.` : `There are no cards in Lessons ${a}–${b}.`);
  try { localStorage.setItem("range", JSON.stringify({ from: a, to: b })); } catch {}
  state.extra = false;
  if (reload) loadNext();
}

let rangeTimer;
function rangeChanged() {
  clearTimeout(rangeTimer);
  rangeTimer = setTimeout(() => {
    if ($("range-from").value === "" || $("range-to").value === "") return;
    setRange($("range-from").value, $("range-to").value);
  }, 500);
}
$("range-from").addEventListener("input", rangeChanged);
$("range-to").addEventListener("input", rangeChanged);
$("range-form").addEventListener("submit", (e) => {
  e.preventDefault();
  setRange($("range-from").value, $("range-to").value);
  document.activeElement?.blur();
});
for (const el of [$("range-from"), $("range-to")]) {
  el.addEventListener("blur", () => setRange($("range-from").value, $("range-to").value, false));
}
$("range-all").addEventListener("click", () => setRange(state.minLesson, state.maxLesson));

/* ---------- score / tally ---------- */
function todayKey() {
  return `today:${state.user}:${new Date().toLocaleDateString()}`;
}
function getToday() {
  try { return JSON.parse(localStorage.getItem(todayKey()) || "null") || { right: 0, missed: 0 }; }
  catch { return state.today || { right: 0, missed: 0 }; }
}
function bumpToday(result) {
  const t = getToday();
  t[result === "right" ? "right" : "missed"]++;
  state.today = t;
  try { localStorage.setItem(todayKey(), JSON.stringify(t)); } catch {}
  return t;
}
function renderScore(sc) {
  if (!sc) return;
  const prevLevel = state.level;
  state.level = sc.level;
  $("t-level").textContent = `Lv ${sc.level}`;
  $("t-xpfill").style.width = `${Math.round(sc.levelProgress * 100)}%`;
  $("t-xp").textContent = `${sc.xp} XP · ${sc.toNextLevel} to Lv ${sc.level + 1}`;
  $("t-streak").textContent = sc.run;
  $("t-best").textContent = sc.best;
  $("t-mastered").textContent = `${sc.mastered}/${sc.total}`;
  const t = getToday();
  $("t-right").textContent = t.right;
  $("t-missed").textContent = t.missed;
  $("tally").classList.toggle("hot", sc.run >= 5);
  if (prevLevel && sc.level > prevLevel) toast(`Level up! You're now level ${sc.level} 🎉`, "level");
}

let toastTimer;
function toast(text, kind = "") {
  const el = $("toast");
  el.textContent = text;
  el.className = "toast show " + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), 2200);
}

/* ---------- auth ---------- */
document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    state.mode = tab.dataset.mode;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    $("pin2-wrap").hidden = state.mode !== "signup";
    $("auth-submit").textContent = state.mode === "signup" ? "Create profile" : "Sign in";
    $("auth-error").textContent = "";
  })
);

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("auth-name").value.trim();
  const pin = $("auth-pin").value;
  $("auth-error").textContent = "";
  if (state.mode === "signup" && pin !== $("auth-pin2").value) {
    $("auth-error").textContent = "The two PINs don't match.";
    return;
  }
  $("auth-submit").disabled = true;
  try {
    const me = await api(state.mode === "signup" ? "/api/signup" : "/api/login", { name, pin });
    $("auth-pin").value = $("auth-pin2").value = "";
    enterApp(me);
  } catch (err) {
    $("auth-error").textContent = err.message;
  } finally {
    $("auth-submit").disabled = false;
  }
});

$("logout").addEventListener("click", async () => {
  await api("/api/logout", {}).catch(() => {});
  showAuth();
});

document.querySelectorAll("nav [data-view]").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));

/* ---------- practice ---------- */
async function loadNext() {
  const qs = new URLSearchParams({ set: state.set, skip: state.lastId, extra: state.extra ? "1" : "0" });
  let data;
  try { data = await api("/api/next?" + qs); } catch { return; }

  if (data.done) return showEmpty(data);
  $("empty").hidden = true;
  $("study").hidden = false;

  state.card = data.card;
  state.flipped = false;
  $("card").classList.remove("flipped");
  $("answer").classList.remove("show");
  // Swap text after the card has turned back to the front, so the answer never flashes.
  setTimeout(() => {
    $("card-front").textContent = data.card.front;
    $("card-front-echo").textContent = data.card.front;
    $("card-back").textContent = data.card.back;
    $("card-detail").textContent = data.card.detail || "";
    $("card-grammar").textContent = data.card.tag || "";
    $("card-lesson").textContent = data.card.set || "";
    const long = data.card.front.length > 60 || data.card.front.split("\n").length > 3;
    $("card-front").classList.toggle("dense", long);
    $("card-back").classList.toggle("dense", data.card.back.length > 60 || data.card.back.split("\n").length > 3);
  }, $("card").dataset.used ? 180 : 0);
  $("card").dataset.used = "1";
  $("card-tag").textContent = data.isNew ? "New" : state.extra ? "Extra practice" : "";
  $("record").textContent = data.record
    ? `You've got this one right ${data.record.correct}× and missed it ${data.record.missed}×`
    : "";
  $("counts").innerHTML = state.extra
    ? "Extra practice on your weakest cards"
    : `<b>${data.dueCount}</b> due · <b>${data.newCount}</b> new`;
}

function showEmpty(data) {
  $("study").hidden = true;
  const el = $("empty");
  el.hidden = false;
  $("counts").textContent = "";
  if (data.empty) {
    el.innerHTML = `<div class="empty-title">No cards yet</div><p class="sub">The deck is being prepared. Check back soon.</p>`;
    return;
  }
  const when = data.nextDue ? timeUntil(data.nextDue) : "later";
  el.innerHTML = `<div class="empty-title">Optimē! All caught up.</div>
    <p class="sub">Your next card is due ${when}. You can keep going with extra practice on the cards you find hardest.</p>
    <button class="primary" id="extra-btn">Extra practice</button>`;
  $("extra-btn").addEventListener("click", () => { state.extra = true; loadNext(); });
}

function timeUntil(ts) {
  const mins = Math.max(1, Math.round((ts - Date.now()) / 60000));
  if (mins < 60) return `in ${mins} minute${mins === 1 ? "" : "s"}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs} hour${hrs === 1 ? "" : "s"}`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

function flip() {
  if (!state.card) return;
  state.flipped = !state.flipped;
  $("card").classList.toggle("flipped", state.flipped);
  if (state.flipped) $("answer").classList.add("show");
}

async function answer(result) {
  if (!state.card || !state.flipped || state.busy) return;
  state.busy = true;
  try {
    const r = await api("/api/review", { cardId: state.card.id, result });
    state.lastId = state.card.id;
    bumpToday(result);
    renderScore(r.score);
    const when = timeUntil(r.dueAt).replace(/^in /, "");
    toast(result === "right"
      ? `+${r.gained} XP · see it again ${when === "tomorrow" ? "tomorrow" : "in " + when}`
      : `+1 XP for trying · it'll come back soon`, result === "right" ? "good" : "bad");
    await loadNext();
  } catch (err) {
    if (err.message !== "signed out") $("record").textContent = err.message;
  } finally {
    state.busy = false;
  }
}

$("card").addEventListener("click", () => { document.activeElement?.blur(); flip(); });
$("btn-miss").addEventListener("click", () => answer("missed"));
$("btn-hit").addEventListener("click", () => answer("right"));

document.addEventListener("keydown", (e) => {
  if ($("view-practice").hidden || e.target.matches("input, select")) return;
  if (e.key === " " || e.key === "Enter") { e.preventDefault(); flip(); }
  else if (e.key === "1" || e.key === "ArrowLeft") answer("missed");
  else if (e.key === "2" || e.key === "ArrowRight") answer("right");
});

/* ---------- progress ---------- */
async function loadStats() {
  let s;
  try { s = await api("/api/stats?" + new URLSearchParams({ set: state.set })); } catch { return; }
  const tiles = [
    ["Mastered", s.mastered, "var(--good)"],
    ["Learning", s.learning, "var(--accent)"],
    ["Not seen yet", s.fresh, "var(--line)"],
    ["Due now", s.due, null],
  ];
  $("stats").innerHTML = tiles.map(([l, n]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("");
  $("bar").innerHTML = s.total
    ? tiles.slice(0, 3).map(([, n, c]) => `<span style="width:${(n / s.total) * 100}%;background:${c}"></span>`).join("")
    : "";
  const list = $("trouble");
  list.innerHTML = "";
  if (!s.trouble.length) {
    list.innerHTML = `<li><span class="a">No trouble cards. Bene factum!</span></li>`;
    return;
  }
  for (const c of s.trouble) {
    const li = document.createElement("li");
    li.innerHTML = `<div><div class="q"></div><div class="a"></div></div><span class="m"></span>`;
    li.querySelector(".q").textContent = c.front;
    li.querySelector(".a").textContent = c.back;
    li.querySelector(".m").textContent = `missed ${c.missed}× · right ${c.correct}×`;
    list.append(li);
  }
}

$("reset").addEventListener("click", async () => {
  if (!confirm("Erase all your practice history? Your profile stays, but every card starts over.")) return;
  await api("/api/reset", {}).catch(() => {});
  loadStats();
});

/* ---------- boot ---------- */
api("/api/me").then(enterApp).catch(() => {});
