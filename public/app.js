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
  const sel = $("set-select");
  sel.innerHTML = "";
  const total = me.sets.reduce((n, s) => n + s.count, 0);
  sel.append(new Option(`All cards (${total})`, ""));
  for (const s of me.sets) sel.append(new Option(`${s.name} (${s.count})`, s.name));
  sel.hidden = me.sets.length <= 1;
  try { state.set = localStorage.getItem("set") || ""; } catch {}
  if (![...sel.options].some((o) => o.value === state.set)) state.set = "";
  sel.value = state.set;
  show("practice");
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
$("set-select").addEventListener("change", (e) => {
  state.set = e.target.value;
  state.extra = false;
  try { localStorage.setItem("set", state.set); } catch {}
  loadNext();
});

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
    await api("/api/review", { cardId: state.card.id, result });
    state.lastId = state.card.id;
    await loadNext();
  } catch (err) {
    if (err.message !== "signed out") $("record").textContent = err.message;
  } finally {
    state.busy = false;
  }
}

$("card").addEventListener("click", flip);
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
