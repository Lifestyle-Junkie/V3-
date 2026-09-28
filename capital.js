/* ── Capital HUD ─────────────────────────────────────────────────────── */
const WARN_ICO = "<svg viewBox='0 0 24 24'><path d='M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 22c-5.518 0-10-4.482-10-10s4.482-10 10-10 10 4.482 10 10-4.482 10-10 10zm-1-16h2v6h-2zm0 8h2v2h-2z'></path></svg>";
const DOWN_ICO = "<svg viewBox='0 0 24 24'><path fill-rule='evenodd' clip-rule='evenodd' d='M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zm4.28 10.28a.75.75 0 000-1.06l-3-3a.75.75 0 10-1.06 1.06l1.72 1.72H8.25a.75.75 0 000 1.5h5.69l-1.72 1.72a.75.75 0 101.06 1.06l3-3z'></path></svg>";
const UP_ICO = "<svg viewBox='0 0 24 24'><path d='M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zm-.75 14.25v-6h1.5v6h-1.5zm0-8.25v-1.5h1.5v1.5h-1.5z'></path></svg>";
const SHEET_ID = "1eVbAcpz_rGbZ0hXdA3Bleibzj_RfvFB3zkyhT6bgOpk";
const SHEET_ACCOUNTS_CSV = "https://docs.google.com/spreadsheets/d/" + SHEET_ID + "/gviz/tq?tqx=out:csv&sheet=Accounts";
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DUMMY_MONTHS = { Apr: 2000, May: 2200, Jun: 1200, Jul: 1800, Aug: 1500, Sep: 1500 };
let liveRhTotal = 3948.34, liveCash = 2500, CAP_BILLS = [], holdings = [];
let CAP_GOAL = { goal: 25000, monthly: 2200, includeCash: true, monthKey: "", monthStartPile: null, months: [] };

function money(n) {
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function moneyShort(n) { return money(n).replace(/\.00$/, ""); }
function parseMoney(str) { return Number(String(str == null ? "" : str).replace(/[^0-9.\-]/g, "")); }
function monthKey() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
function monthName(d) { return MONTH_NAMES[(d || new Date()).getMonth()]; }
function pileNow() { const c = getCashFromDom(); return CAP_GOAL.includeCash ? liveRhTotal + c : liveRhTotal; }
function getCashFromDom() {
  const n = parseMoney((document.getElementById("capCashVal") || {}).textContent);
  return isFinite(n) ? n : liveCash;
}
function cleanMonths(arr) {
  return (arr || []).filter(function (m) {
    return m && m.m && !(DUMMY_MONTHS[m.m] != null && Number(m.v) === DUMMY_MONTHS[m.m]);
  });
}
async function api(path, body) {
  const opt = body == null
    ? { cache: "no-store" }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const res = await fetch(path + (path.indexOf("?") >= 0 ? "&" : "?") + "_=" + Date.now(), opt);
  const data = await res.json().catch(function () { return {}; });
  return { ok: res.ok, data: data };
}

function goalSnapshot() {
  const saved = pileNow(), goal = Number(CAP_GOAL.goal) || 0, monthly = Number(CAP_GOAL.monthly) || 0;
  const gap = Math.max(0, goal - saved), pct = goal > 0 ? (saved / goal) * 100 : 0;
  let monthsLeft = 0, hitLabel = "Now";
  if (gap <= 0) hitLabel = "Hit";
  else if (monthly > 0) {
    monthsLeft = Math.ceil(gap / monthly);
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + monthsLeft);
    hitLabel = monthName(d) + " " + d.getFullYear();
  } else hitLabel = "Set monthly";
  const start = CAP_GOAL.monthStartPile, added = start == null ? 0 : saved - start;
  const behindBy = monthly > 0 ? monthly - added : 0;
  return {
    goal: goal, monthly: monthly, includeCash: !!CAP_GOAL.includeCash, saved: saved,
    rh: liveRhTotal, cash: getCashFromDom(), gap: gap, pct: pct, monthsLeft: monthsLeft,
    hitLabel: hitLabel, month: monthName(), monthKey: monthKey(), monthStartPile: start,
    addedThisMonth: added, behindBy: behindBy > 0 ? behindBy : 0,
    pace: start == null ? "—" : (added >= monthly ? "On pace" : "Behind")
  };
}

function saveCashToServer(n) { api("/api/cash", { cash: n }).catch(function () {}); }
function saveGoalToServer() { api("/api/goal", CAP_GOAL).catch(function () {}); }
function saveHoldingsToServer() {
  api("/api/holdings", { holdings: holdings.map(function (h) {
    return { t: h.t, name: h.name || h.t, price: h.price, chg: h.chg };
  }) }).catch(function () {});
}

async function fetchCashFromServer() {
  try {
    const out = await api("/api/cash");
    if (!out.ok || !isFinite(out.data.cash)) return;
    liveCash = out.data.cash;
    const el = document.getElementById("capCashVal");
    if (el) el.textContent = money(liveCash);
    updateNetWorthUI(liveRhTotal, liveCash);
  } catch (e) {}
}
function applyGoalPayload(data) {
  if (!data || typeof data !== "object") return;
  if (isFinite(data.goal)) CAP_GOAL.goal = Number(data.goal);
  if (isFinite(data.monthly)) CAP_GOAL.monthly = Number(data.monthly);
  if (typeof data.includeCash === "boolean") CAP_GOAL.includeCash = data.includeCash;
  if (data.monthKey) CAP_GOAL.monthKey = data.monthKey;
  if (isFinite(data.monthStartPile)) CAP_GOAL.monthStartPile = Number(data.monthStartPile);
  if (Array.isArray(data.months)) CAP_GOAL.months = cleanMonths(data.months);
}
async function fetchGoalFromServer() {
  try {
    const out = await api("/api/goal");
    if (out.ok) applyGoalPayload(out.data.goal || out.data);
  } catch (e) {}
  rollGoalMonth();
  renderGoal();
}

function rollGoalMonth() {
  const key = monthKey(), saved = pileNow();
  CAP_GOAL.months = cleanMonths(CAP_GOAL.months);
  if (!CAP_GOAL.monthKey || CAP_GOAL.monthKey === key) {
    if (!CAP_GOAL.monthKey) CAP_GOAL.monthKey = key;
    if (CAP_GOAL.monthStartPile == null) CAP_GOAL.monthStartPile = saved;
    return;
  }
  const parts = String(CAP_GOAL.monthKey).split("-");
  const oldName = MONTH_NAMES[Math.max(0, (Number(parts[1]) || 1) - 1)] || "Prev";
  const added = saved - (CAP_GOAL.monthStartPile || saved);
  CAP_GOAL.months = CAP_GOAL.months.concat([{ m: oldName, v: Math.round(added), ok: added >= (Number(CAP_GOAL.monthly) || 0) }]).slice(-6);
  CAP_GOAL.monthKey = key;
  CAP_GOAL.monthStartPile = saved;
  saveGoalToServer();
}

function updateNetWorthUI(rh, cash) {
  const net = rh + cash;
  const set = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("capRhVal", money(rh));
  set("capNet", money(net));
  set("capPieTotal", money(net));
  renderAlloc(rh, cash, net);
  renderGoal();
}

function parseCsvLine(line) {
  return (line.match(/(".*?"|[^,]*)/g) || []).map(function (c) {
    return c.replace(/^"|"$/g, "").replace(/""/g, '"').trim();
  });
}
async function fetchRobinhoodTotal() {
  try {
    const out = await api("/api/sheet/robinhood");
    if (out.ok && isFinite(out.data.current_balance)) {
      liveRhTotal = out.data.current_balance;
      updateNetWorthUI(liveRhTotal, getCashFromDom());
      return;
    }
  } catch (e) {}
  try {
    const res = await fetch(SHEET_ACCOUNTS_CSV + "&_=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return;
    const csv = await res.text();
    if (csv.trim().startsWith("<!")) return;
    const lines = csv.trim().split(/\r?\n/);
    if (lines.length < 2) return;
    const headers = parseCsvLine(lines[0]);
    const nameIdx = headers.findIndex(function (h) { return /^name$/i.test(h); });
    const bankIdx = headers.findIndex(function (h) { return /bank\s*connection$/i.test(h); });
    const balIdx = headers.findIndex(function (h) { return /current\s*balance/i.test(h); });
    if (balIdx < 0) return;
    let found = null;
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      const name = (nameIdx >= 0 ? cells[nameIdx] : cells[1] || "").trim().toLowerCase();
      const bank = (bankIdx >= 0 ? cells[bankIdx] : "").trim().toLowerCase();
      const bal = parseMoney(cells[balIdx]);
      if (!isFinite(bal)) continue;
      if (name === "robinhood individual") { found = bal; break; }
      if (found == null && (name.indexOf("robinhood") >= 0 || bank === "robinhood")) found = bal;
    }
    if (found != null) { liveRhTotal = found; updateNetWorthUI(liveRhTotal, getCashFromDom()); }
  } catch (e) {}
}

function dueLabel(bill) {
  if (bill && bill.cycleEnd) {
    const d = new Date(String(bill.cycleEnd).slice(0, 10) + "T00:00:00");
    if (!isNaN(d.getTime())) return monthName(d) + " " + d.getDate();
  }
  return monthName() + " " + (Number(bill && bill.dueDay != null ? bill.dueDay : bill) || 1);
}
function statusLabel(st) { return st === "paid" ? "Paid" : st === "over" ? "Unpaid" : "Upcoming"; }

async function fetchBillsFromServer() {
  try {
    const out = await api("/api/bills");
    const next = out.ok && Array.isArray(out.data.bills) ? out.data.bills : null;
    if (next == null || (!next.length && CAP_BILLS.length)) return;
    CAP_BILLS = next;
    renderBills();
  } catch (e) {}
}
function addBillViaEdit() {
  const phrase = prompt("Add bill  (name amount due day)\ne.g. rent 1450 due 1");
  if (!phrase || !phrase.trim()) return;
  api("/api/bills", { phrase: phrase.trim() }).then(function (out) {
    if (!out.ok) alert(out.data.error || "Could not add bill");
    else fetchBillsFromServer();
  }).catch(function () { alert("Could not add bill"); });
}
function editBill(b) {
  const name = prompt("Name", b.name || ""); if (name == null) return;
  const amt = prompt("Amount", String(b.amt != null ? b.amt : "")); if (amt == null) return;
  const due = prompt("Due day (1–31)", String(b.dueDay || 1)); if (due == null) return;
  const st = prompt("Status: paid / upcoming / unpaid", statusLabel(b.st)); if (st == null) return;
  api("/api/bills/update", {
    id: b.id || b.name, name: name.trim(), amount: isFinite(parseMoney(amt)) ? parseMoney(amt) : b.amt,
    due_day: Number(due) || b.dueDay || 1, status: st
  }).then(function (out) {
    if (!out.ok) alert(out.data.error || "Could not update bill");
    else fetchBillsFromServer();
  }).catch(function () { alert("Could not update bill"); });
}

function ensureHeadBtn(id, selector, label, fn) {
  let btn = document.getElementById(id);
  if (btn) { btn.onclick = fn; return; }
  const card = document.querySelector(selector);
  const head = card && card.querySelector(".cap-card-h");
  if (!head) return;
  btn = document.createElement("button");
  btn.type = "button"; btn.id = id; btn.className = "cap-edit"; btn.textContent = label;
  btn.addEventListener("click", fn);
  head.appendChild(btn);
}
function renderBills() {
  const box = document.getElementById("capBills");
  if (!box) return;
  ensureHeadBtn("capBillEdit", "#capBills", "Edit", addBillViaEdit);
  const card = box.closest(".cap-card");
  if (card) card.querySelectorAll("button.cap-edit, button.cap-bill-edit").forEach(function (b) {
    if (b.id !== "capBillEdit" && (b.closest(".cap-bill-h") || !b.closest(".cap-card-h"))) b.remove();
  });
  let total = 0;
  if (!CAP_BILLS.length) {
    box.innerHTML = '<div class="cap-bill-empty">No bills yet — tap Edit or tell Hope in chat</div>';
  } else {
    box.innerHTML = '<div class="cap-bill-h"><span>Bill</span><span>Amount</span><span>Due</span><span>Type</span><span>Status</span></div>' +
      CAP_BILLS.map(function (b) {
        total += Number(b.amt) || 0;
        return '<div class="cap-bill" data-bill-id="' + (b.id || "") + '" style="cursor:pointer" title="Click to edit">' +
          "<span>" + b.name + "</span><span>" + money(b.amt) + "</span><span>" + dueLabel(b) + "</span>" +
          "<span>" + (b.type || "Recurring") + '</span><span class="st ' + b.st + '">' + statusLabel(b.st) + "</span></div>";
      }).join("");
    box.querySelectorAll(".cap-bill[data-bill-id]").forEach(function (row) {
      row.addEventListener("click", function () {
        const bill = CAP_BILLS.find(function (x) { return String(x.id) === String(row.getAttribute("data-bill-id")); });
        if (bill) editBill(bill);
      });
    });
  }
  const tot = document.getElementById("capBillTotal");
  if (tot) tot.textContent = money(total).replace(".00", "");
}

function editGoal() {
  const g = prompt("Target goal", String(CAP_GOAL.goal)); if (g == null) return;
  const goal = parseMoney(g); if (!isFinite(goal) || goal <= 0) return;
  const m = prompt("Save per month", String(CAP_GOAL.monthly)); if (m == null) return;
  const monthly = parseMoney(m); if (!isFinite(monthly) || monthly < 0) return;
  const inc = prompt("Count cash on hand? yes / no", CAP_GOAL.includeCash ? "yes" : "no"); if (inc == null) return;
  CAP_GOAL.goal = goal; CAP_GOAL.monthly = monthly; CAP_GOAL.includeCash = !/^n/i.test(String(inc).trim());
  rollGoalMonth(); saveGoalToServer(); renderGoal();
}
function renderGoal() {
  rollGoalMonth();
  ensureHeadBtn("capGoalEdit", "#capGoalNote", "Edit Goal", editGoal);
  const s = goalSnapshot();
  const set = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("capGoal", moneyShort(s.goal));
  set("capGoalNeed", moneyShort(s.monthly));
  set("capGoalHave", moneyShort(s.saved));
  const bar = document.getElementById("capGoalBar");
  if (bar) bar.style.width = Math.max(0, Math.min(100, s.pct)) + "%";
  const note = document.getElementById("capGoalNote");
  if (note) {
    const pace = s.pace === "Behind" ? "Behind by " + moneyShort(s.behindBy)
      : s.pace === "On pace" ? "On pace · " + s.month : s.pace;
    note.textContent = s.pct.toFixed(0) + "% · " + pace + " · Hit " + s.hitLabel;
  }
  renderMonths(s);
}

function logoUrl(t) { return "https://financialmodelingprep.com/image-stock/" + t.toUpperCase() + ".png"; }
function sparkHtml() {
  let h = '<span class="cap-spark"><span class="candle-chart">';
  for (let i = 0; i < 12; i++) h += '<span class="candle"></span>';
  return h + "</span></span>";
}

async function fetchHoldingsFromServer() {
  try {
    const out = await api("/api/holdings");
    if (!out.ok || !Array.isArray(out.data.holdings)) return;
    holdings = out.data.holdings.map(function (h) {
      return { t: String(h.t || "").toUpperCase(), name: h.name || h.t, price: h.price, chg: Number(h.chg) || 0 };
    }).filter(function (h) { return h.t; });
    renderHolds();
    fetchQuotes();
  } catch (e) {}
}
function renderHolds() {
  const box = document.getElementById("capHolds");
  if (!box) return;
  let html = '<div class="cap-ticker-search"><input id="capTickerInput" type="text" placeholder="Add ticker (e.g. AAPL)" maxlength="10" autocomplete="off" /><button type="button" id="capTickerAdd">Add</button></div>' +
    '<div class="cap-hold cap-hold-h"><span></span><span>Ticker</span><span>Price</span><span>Change</span><span></span></div>';
  html += holdings.length ? holdings.map(function (h, idx) {
    const chg = Number(h.chg) || 0;
    return '<div class="cap-hold" draggable="true" data-idx="' + idx + '">' +
      '<img class="tlogo" alt="' + h.t + '" src="' + logoUrl(h.t) + '" />' +
      '<span class="tk">' + h.t + '</span><span class="pv">' + (h.price != null ? money(h.price) : "—") + "</span>" +
      '<span class="chg ' + (chg >= 0 ? "up" : "down") + '">' + (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%</span>" +
      sparkHtml() + '<button type="button" class="cap-hold-rm" data-t="' + h.t + '" title="Remove">×</button></div>';
  }).join("") : '<div class="cap-hold-empty">No tickers yet — search above to add</div>';
  box.innerHTML = html;
  box.querySelectorAll("img.tlogo").forEach(function (img) {
    img.addEventListener("error", function () {
      const s = document.createElement("span"); s.className = "tlogo tlogo-fallback"; s.textContent = (img.alt || "?").slice(0, 1); img.replaceWith(s);
    });
  });
  const input = document.getElementById("capTickerInput");
  function tryAdd() {
    const sym = ((input && input.value) || "").trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
    if (!sym) return;
    addTicker(sym); if (input) { input.value = ""; input.focus(); }
  }
  const addBtn = document.getElementById("capTickerAdd");
  if (addBtn) addBtn.addEventListener("click", tryAdd);
  if (input) input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); tryAdd(); } });
  box.querySelectorAll(".cap-hold-rm").forEach(function (btn) {
    btn.addEventListener("click", function (e) { e.stopPropagation(); removeTicker(btn.getAttribute("data-t")); });
  });
  let dragIdx = null;
  box.querySelectorAll(".cap-hold[draggable]").forEach(function (row) {
    row.addEventListener("dragstart", function (e) { dragIdx = Number(row.getAttribute("data-idx")); row.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
    row.addEventListener("dragend", function () { row.classList.remove("dragging"); dragIdx = null; });
    row.addEventListener("dragover", function (e) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; });
    row.addEventListener("drop", function (e) {
      e.preventDefault();
      const toIdx = Number(row.getAttribute("data-idx"));
      if (dragIdx == null || dragIdx === toIdx) return;
      holdings.splice(toIdx, 0, holdings.splice(dragIdx, 1)[0]);
      saveHoldingsToServer(); renderHolds();
    });
  });
}
function addTicker(symbol) {
  const t = symbol.toUpperCase();
  if (holdings.some(function (h) { return h.t === t; })) return;
  holdings.push({ t: t, name: t, price: null, chg: 0 });
  saveHoldingsToServer(); renderHolds(); fetchQuotes();
}
function removeTicker(symbol) {
  holdings = holdings.filter(function (h) { return h.t !== symbol.toUpperCase(); });
  saveHoldingsToServer(); renderHolds();
}
async function fetchQuotes() {
  if (!holdings.length) return;
  const results = await Promise.all(holdings.map(async function (h) {
    try {
      const out = await api("/api/quote?symbol=" + encodeURIComponent(h.t));
      if (!out.ok) return null;
      return { t: h.t, price: out.data.regularMarketPrice, chg: out.data.regularMarketChangePercent || 0, name: out.data.shortName || h.t };
    } catch (e) { return null; }
  }));
  let changed = false;
  results.forEach(function (q) {
    if (!q) return;
    const h = holdings.find(function (x) { return x.t === q.t; });
    if (!h) return;
    if (q.price != null) { h.price = q.price; changed = true; }
    if (q.chg != null) { h.chg = q.chg; changed = true; }
    if (q.name) h.name = q.name;
  });
  if (changed) { renderHolds(); saveHoldingsToServer(); }
}

function drawCapChart() {
  const el = document.getElementById("capChart"); if (!el) return;
  const pts = [6,8,7,9,8,11,10,13,12,16,15,18,20,19,22,24], w = 520, h = 140, max = 24, step = w / (pts.length - 1);
  const path = pts.map(function (p, i) {
    return (i ? "L" : "M") + (i * step).toFixed(1) + "," + (h - 16 - (p / max) * (h - 28)).toFixed(1);
  }).join(" ");
  const last = pts.length - 1, lx = last * step, ly = h - 16 - (pts[last] / max) * (h - 28);
  el.innerHTML = '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" width="100%" height="140">' +
    '<path d="' + path + " L" + w + "," + h + " L0," + h + ' Z" fill="rgba(62,224,122,0.12)"/>' +
    '<path d="' + path + '" fill="none" stroke="#3ee07a" stroke-width="2"/>' +
    '<circle cx="' + lx + '" cy="' + ly + '" r="4" fill="#3ee07a"/></svg>';
}
function renderAlloc(rh, cash, net) {
  const el = document.getElementById("capAlloc"); if (!el) return;
  rh = rh != null ? rh : liveRhTotal; cash = cash != null ? cash : getCashFromDom(); net = net != null ? net : rh + cash;
  const rhPct = net > 0 ? Math.round((rh / net) * 100) : 0;
  el.innerHTML = "<div class='cap-alloc-pie'><div class='cap-alloc-center'><b>" + money(net).replace(/\.00$/, "") +
    "</b><span>Total</span></div></div><div class='cap-alloc-leg'><div><i class='rh'></i>Robinhood " + rhPct +
    "%<b>" + money(rh) + "</b></div><div><i class='cash'></i>Cash " + (100 - rhPct) + "%<b>" + money(cash) + "</b></div></div>";
}
function renderMonths(snap) {
  const box = document.getElementById("capMonths"); if (!box) return;
  const s = snap || goalSnapshot(), cur = monthName(), curVal = Math.round(s.addedThisMonth || 0);
  const past = cleanMonths(CAP_GOAL.months).filter(function (m) { return m.m !== cur; });
  box.innerHTML = past.map(function (m) {
    return '<div class="cap-mo">' + m.m + "<b>" + (m.ok ? "✓" : "✕") + " $" + Number(m.v).toLocaleString() + "</b></div>";
  }).join("") + '<div class="cap-mo on">' + cur + "<b>" + (s.pace !== "Behind" ? "✓" : "✕") + " $" + Number(curVal).toLocaleString() + "</b></div>";
}

function insightIcon(tone) { return tone === "warn" ? WARN_ICO : (tone === "up" || tone === "tip") ? UP_ICO : DOWN_ICO; }
function renderInsights(rows) {
  const box = document.getElementById("capInsights"); if (!box) return;
  const list = Array.isArray(rows) && rows.length ? rows : [{ tone: "tip", title: "Waiting on Hope", note: "Insights refresh from live Capital every hour." }];
  box.innerHTML = list.map(function (r) {
    const tone = /^(up|tip|warn)$/.test(r.tone) ? r.tone : "down";
    return '<div class="cap-ins ' + tone + '"><span class="cap-ins-ico">' + insightIcon(tone) + "</span><div><b>" +
      (r.title || "") + "</b><span>" + (r.note || "") + "</span></div></div>";
  }).join("");
}
async function fetchInsights(force) {
  try {
    const out = await api("/api/insights" + (force ? "?force=1" : ""));
    if (out.ok && Array.isArray(out.data.rows)) renderInsights(out.data.rows);
  } catch (e) {}
}

function bootCapital() {
  drawCapChart(); renderHolds(); renderAlloc(); renderBills(); renderGoal(); renderInsights();
  fetchCashFromServer(); fetchHoldingsFromServer(); fetchGoalFromServer();
  document.querySelectorAll("[data-cap-tab], .cap-ranges button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const group = btn.hasAttribute("data-cap-tab") ? "[data-cap-tab]" : ".cap-ranges button";
      document.querySelectorAll(group).forEach(function (b) { b.classList.remove("on"); });
      btn.classList.add("on");
    });
  });
  const cashBtn = document.getElementById("capCashEdit");
  if (cashBtn) cashBtn.addEventListener("click", function () {
    const next = prompt("Cash on hand", String(getCashFromDom())); if (next == null) return;
    const n = parseMoney(next); if (!isFinite(n)) return;
    liveCash = n;
    const el = document.getElementById("capCashVal");
    if (el) el.textContent = money(n);
    updateNetWorthUI(liveRhTotal, n); saveCashToServer(n); renderGoal();
  });
  fetchRobinhoodTotal(); fetchQuotes(); fetchBillsFromServer(); fetchInsights(false);
  setInterval(fetchRobinhoodTotal, 60000);
  setInterval(fetchQuotes, 60000);
  setInterval(fetchBillsFromServer, 20000);
  setInterval(function () { fetchInsights(false); }, 3600000);
}
function goToCapitalTab() {
  document.querySelectorAll(".nav-item").forEach(function (i) { i.classList.remove("active"); });
  const nav = document.querySelector('.nav-item[data-view="capital"]');
  if (nav) nav.classList.add("active");
  if (typeof setView === "function") setView("capital");
  else if (typeof layout !== "undefined" && layout) {
    layout.classList.remove("chat-mode", "music-mode", "maps-mode", "weather-mode");
    layout.classList.add("capital-mode");
  }
}
window.goalSnapshot = goalSnapshot;
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootCapital);
else bootCapital();
