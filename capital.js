/* ── Capital HUD ─────────────────────────────────────────────────────── */

const CAP_BILLS = [
  { name: "Rent", amt: 1450, due: "Sep 1", via: "Zelle - Mom", type: "Recurring", st: "paid" },
  { name: "Car Insurance", amt: 210, due: "Sep 15", via: "Card", type: "Recurring", st: "pend" },
  { name: "Phone", amt: 85, due: "Sep 20", via: "Card", type: "Recurring", st: "paid" },
  { name: "Water", amt: 200, due: "Sep 22", via: "Auto-Detected", type: "Recurring", st: "over" },
  { name: "Credit Card", amt: 50, due: "Sep 25", via: "Card", type: "Recurring", st: "pend" },
  { name: "Car Payment", amt: 469, due: "Sep 28", via: "Auto-Detected", type: "Recurring", st: "paid" },
  { name: "Gym Membership", amt: 30, due: "Sep 10", via: "Card", type: "Recurring", st: "paid" },
  { name: "Adobe (Hope)", amt: 22, due: "Sep 12", via: "Card", type: "Recurring", st: "paid" },
  { name: "Software (One-Time)", amt: 120, due: "Sep 18", via: "Card", type: "One-Time", st: "paid" },
  { name: "Travel (Hotel)", amt: 350, due: "Sep 30", via: "Card", type: "One-Time", st: "pend" }
];

const CAP_MONTHS = [
  { m: "Apr", v: 2000, ok: true },
  { m: "May", v: 2200, ok: true },
  { m: "Jun", v: 1200, ok: false },
  { m: "Jul", v: 1800, ok: true },
  { m: "Aug", v: 1500, ok: false },
  { m: "Sep", v: 1500, ok: false }
];

const WARN_ICO = "<svg viewBox='0 0 24 24'><path d='M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 22c-5.518 0-10-4.482-10-10s4.482-10 10-10 10 4.482 10 10-4.482 10-10 10zm-1-16h2v6h-2zm0 8h2v2h-2z'></path></svg>";
const DOWN_ICO = "<svg viewBox='0 0 24 24'><path fill-rule='evenodd' clip-rule='evenodd' d='M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zm4.28 10.28a.75.75 0 000-1.06l-3-3a.75.75 0 10-1.06 1.06l1.72 1.72H8.25a.75.75 0 000 1.5h5.69l-1.72 1.72a.75.75 0 101.06 1.06l3-3z'></path></svg>";

/* ── Google Sheets live sync (Robinhood total) ───────────────────────── */
const SHEET_ID = "1jZHKrslQB1Xj9NN2EtqzBNAcdL9lVNhoT7dUheEyudM";
const SHEET_ACCOUNTS_CSV =
  "https://docs.google.com/spreadsheets/d/" + SHEET_ID +
  "/gviz/tq?tqx=out:csv&sheet=Accounts";

let liveRhTotal = 3948.34; // fallback until first successful fetch
let liveCash = 2500;       // never overwritten by sheet

function money(n) {
  return "$" + Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function parseMoney(str) {
  if (str == null) return NaN;
  const cleaned = String(str).replace(/[^0-9.\-]/g, "");
  return Number(cleaned);
}

function getCashFromDom() {
  const el = document.getElementById("capCashVal");
  if (!el) return liveCash;
  const n = parseMoney(el.textContent);
  return isFinite(n) ? n : liveCash;
}

function updateNetWorthUI(rh, cash) {
  const net = rh + cash;
  const rhEl = document.getElementById("capRhVal");
  const netEl = document.getElementById("capNet");
  const pieEl = document.getElementById("capPieTotal");
  if (rhEl) rhEl.textContent = money(rh);
  if (netEl) netEl.textContent = money(net);
  if (pieEl) pieEl.textContent = money(net);
  renderAlloc(rh, cash, net);
}

async function fetchRobinhoodTotal() {
  try {
    const res = await fetch(SHEET_ACCOUNTS_CSV + "&_=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const csv = await res.text();
    const lines = csv.trim().split(/\r?\n/);
    if (lines.length < 2) return;

    const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
    const balIdx = headers.findIndex(h => /current\s*balance/i.test(h));
    if (balIdx === -1) return;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].match(/(".*?"|[^,]+)/g) || [];
      const cells = cols.map(c => c.replace(/^"|"$/g, "").trim());
      const name = (cells[1] || "").toLowerCase();
      const bal = parseMoney(cells[balIdx]);
      if (isFinite(bal) && (name.includes("robinhood") || i === 1)) {
        liveRhTotal = bal;
        updateNetWorthUI(liveRhTotal, getCashFromDom());
        return;
      }
    }
  } catch (err) {
    console.warn("[capital] Sheets fetch failed:", err);
  }
}

function startLiveSync() {
  fetchRobinhoodTotal();
  setInterval(fetchRobinhoodTotal, 60000);
}

/* ── Interactive tickers (empty start, no localStorage) ──────────────── */
let holdings = []; // starts empty — Firebase later

function logoUrl(ticker) {
  return "https://financialmodelingprep.com/image-stock/" + ticker.toUpperCase() + ".png";
}

function sparkHtml() {
  let html = '<span class="cap-spark"><span class="candle-chart">';
  for (let i = 0; i < 12; i++) html += '<span class="candle"></span>';
  return html + "</span></span>";
}

function renderHolds() {
  const box = document.getElementById("capHolds");
  if (!box) return;

  let html =
    '<div class="cap-ticker-search">' +
      '<input id="capTickerInput" type="text" placeholder="Add ticker (e.g. AAPL)" maxlength="10" autocomplete="off" />' +
      '<button type="button" id="capTickerAdd">Add</button>' +
    "</div>" +
    '<div class="cap-hold cap-hold-h">' +
      "<span></span><span>Ticker</span><span>Price</span><span>Change</span><span></span>" +
    "</div>";

  if (!holdings.length) {
    html += '<div class="cap-hold-empty">No tickers yet — search above to add</div>';
  } else {
    holdings.forEach(function (h, idx) {
      const chg = Number(h.chg) || 0;
      const chgCls = chg >= 0 ? "up" : "down";
      const chgTxt = (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%";
      const priceTxt = h.price != null ? money(h.price) : "—";

      html +=
        '<div class="cap-hold" draggable="true" data-idx="' + idx + '">' +
          '<img class="tlogo" alt="' + h.t + '" src="' + logoUrl(h.t) + '" />' +
          '<span class="tk">' + h.t + "</span>" +
          '<span class="pv">' + priceTxt + "</span>" +
          '<span class="chg ' + chgCls + '">' + chgTxt + "</span>" +
          sparkHtml() +
          '<button type="button" class="cap-hold-rm" data-t="' + h.t + '" title="Remove">×</button>' +
        "</div>";
    });
  }

  box.innerHTML = html;

  // logo fallbacks
  box.querySelectorAll("img.tlogo").forEach(function (img) {
    img.addEventListener("error", function () {
      const letter = document.createElement("span");
      letter.className = "tlogo tlogo-fallback";
      letter.textContent = (img.alt || "?").slice(0, 1);
      img.replaceWith(letter);
    });
  });

  // search / add
  const input = document.getElementById("capTickerInput");
  const addBtn = document.getElementById("capTickerAdd");
  function tryAdd() {
    if (!input) return;
    const sym = (input.value || "").trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
    if (!sym) return;
    addTicker(sym);
    input.value = "";
    input.focus();
  }
  if (addBtn) addBtn.addEventListener("click", tryAdd);
  if (input) {
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        tryAdd();
      }
    });
  }

  // remove
  box.querySelectorAll(".cap-hold-rm").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      removeTicker(btn.getAttribute("data-t"));
    });
  });

  // drag & drop reorder
  let dragIdx = null;
  box.querySelectorAll(".cap-hold[draggable]").forEach(function (row) {
    row.addEventListener("dragstart", function (e) {
      dragIdx = Number(row.getAttribute("data-idx"));
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", function () {
      row.classList.remove("dragging");
      dragIdx = null;
    });
    row.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("drop", function (e) {
      e.preventDefault();
      const toIdx = Number(row.getAttribute("data-idx"));
      if (dragIdx == null || dragIdx === toIdx) return;
      const item = holdings.splice(dragIdx, 1)[0];
      holdings.splice(toIdx, 0, item);
      renderHolds();
    });
  });
}

function addTicker(symbol) {
  const t = symbol.toUpperCase();
  if (holdings.some(h => h.t === t)) return;
  holdings.push({ t: t, name: t, price: null, chg: 0 });
  renderHolds();
  fetchQuotes();
}

function removeTicker(symbol) {
  const t = symbol.toUpperCase();
  holdings = holdings.filter(h => h.t !== t);
  renderHolds();
}

/* ── Live prices via local backend proxy ─────────────────────────────── */
async function fetchQuotes() {
  if (!holdings.length) return;

  const results = await Promise.all(
    holdings.map(async function (h) {
      try {
        const res = await fetch(
          "/api/quote?symbol=" + encodeURIComponent(h.t) + "&_=" + Date.now(),
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error("HTTP " + res.status);
        const meta = await res.json();
        return {
          t: h.t,
          price: meta.regularMarketPrice != null ? meta.regularMarketPrice : null,
          chg: meta.regularMarketChangePercent != null ? meta.regularMarketChangePercent : 0,
          name: meta.shortName || h.t
        };
      } catch (err) {
        console.warn("[capital] quote failed for", h.t, err);
        return null;
      }
    })
  );

  let changed = false;
  results.forEach(function (q) {
    if (!q) return;
    const h = holdings.find(function (x) { return x.t === q.t; });
    if (!h) return;
    if (q.price != null) {
      h.price = q.price;
      changed = true;
    }
    if (q.chg != null) {
      h.chg = q.chg;
      changed = true;
    }
    if (q.name) h.name = q.name;
  });

  if (changed) renderHolds();
}

function startQuoteSync() {
  fetchQuotes();
  setInterval(fetchQuotes, 60000);
}

/* ── Chart / alloc / bills / months / insights ───────────────────────── */
function drawCapChart() {
  const el = document.getElementById("capChart");
  if (!el) return;
  const pts = [6, 8, 7, 9, 8, 11, 10, 13, 12, 16, 15, 18, 20, 19, 22, 24];
  const w = 520, h = 140;
  const max = Math.max.apply(null, pts);
  const step = w / (pts.length - 1);
  const path = pts.map(function (p, i) {
    const x = i * step;
    const y = h - 16 - (p / max) * (h - 28);
    return (i ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ");
  const last = pts.length - 1;
  const lx = last * step;
  const ly = h - 16 - (pts[last] / max) * (h - 28);
  el.innerHTML =
    '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" width="100%" height="140">' +
    '<path d="' + path + " L" + w + "," + h + " L0," + h + ' Z" fill="rgba(62,224,122,0.12)"/>' +
    '<path d="' + path + '" fill="none" stroke="#3ee07a" stroke-width="2"/>' +
    '<circle cx="' + lx + '" cy="' + ly + '" r="4" fill="#3ee07a"/>' +
    "</svg>";
}

function renderAlloc(rh, cash, net) {
  const el = document.getElementById("capAlloc");
  if (!el) return;
  rh = rh != null ? rh : liveRhTotal;
  cash = cash != null ? cash : getCashFromDom();
  net = net != null ? net : rh + cash;
  const rhPct = net > 0 ? Math.round((rh / net) * 100) : 0;
  const cashPct = 100 - rhPct;
  el.innerHTML =
    "<div class='cap-alloc-pie'><div class='cap-alloc-center'><b>" +
    money(net).replace(/\.00$/, "") +
    "</b><span>Total</span></div></div>" +
    "<div class='cap-alloc-leg'>" +
      "<div><i class='rh'></i>Robinhood " + rhPct + "%<b>" + money(rh) + "</b></div>" +
      "<div><i class='cash'></i>Cash " + cashPct + "%<b>" + money(cash) + "</b></div>" +
    "</div>";
}

function renderBills() {
  const box = document.getElementById("capBills");
  if (!box) return;
  let total = 0;
  box.innerHTML = CAP_BILLS.map(function (b) {
    total += b.amt;
    const label = b.st === "paid" ? "Paid" : b.st === "over" ? "Overdue" : "Pending";
    return (
      '<div class="cap-bill">' +
      "<span>" + b.name + "</span>" +
      "<span>" + money(b.amt) + "</span>" +
      "<span>" + b.due + "</span>" +
      "<span>" + b.type + "</span>" +
      '<span class="st ' + b.st + '">' + label + "</span>" +
      "</div>"
    );
  }).join("");
  const tot = document.getElementById("capBillTotal");
  if (tot) tot.textContent = money(total).replace(".00", "");
}

function renderMonths() {
  const box = document.getElementById("capMonths");
  if (!box) return;
  box.innerHTML = CAP_MONTHS.map(function (m) {
    return (
      '<div class="cap-mo">' +
      m.m +
      "<b>" + (m.ok ? "✓" : "✕") + " $" + m.v.toLocaleString() + "</b>" +
      "</div>"
    );
  }).join("");
}

function renderInsights() {
  const box = document.getElementById("capInsights");
  if (!box) return;
  const rows = [
    { tone: "down", title: "Insurance bill increased +$120 this month", note: "Your car insurance payment is higher than last month." },
    { tone: "down", title: "Robinhood portfolio dipped −$200", note: "Mainly due to market dip in tech stocks." },
    { tone: "warn", title: "Cash withdrawals higher than usual (−$150)", note: "More cash spent this month compared to average." },
    { tone: "down", title: "Water bill marked overdue", note: "Sep 22 payment has not cleared yet." },
    { tone: "warn", title: "Gym charge posts in 3 days", note: "Recurring $30 draft is coming up." }
  ];
  box.innerHTML = rows.map(function (r) {
    const mark = r.tone === "warn" ? WARN_ICO : DOWN_ICO;
    return (
      '<div class="cap-ins ' + r.tone + '">' +
        '<span class="cap-ins-ico">' + mark + "</span>" +
        "<div><b>" + r.title + "</b><span>" + r.note + "</span></div>" +
      "</div>"
    );
  }).join("");
}

/* ── Boot ────────────────────────────────────────────────────────────── */
function bootCapital() {
  drawCapChart();
  renderHolds();
  renderAlloc();
  renderBills();
  renderMonths();
  renderInsights();

  document.querySelectorAll("[data-cap-tab]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll("[data-cap-tab]").forEach(function (b) {
        b.classList.remove("on");
      });
      btn.classList.add("on");
    });
  });

  document.querySelectorAll(".cap-ranges button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".cap-ranges button").forEach(function (b) {
        b.classList.remove("on");
      });
      btn.classList.add("on");
    });
  });

  // cash edit – never touches Robinhood
  const cashBtn = document.getElementById("capCashEdit");
  if (cashBtn) {
    cashBtn.addEventListener("click", function () {
      const current = getCashFromDom();
      const next = prompt("Cash on hand", String(current));
      if (next == null) return;
      const n = parseMoney(next);
      if (!isFinite(n)) return;
      liveCash = n;
      const el = document.getElementById("capCashVal");
      if (el) el.textContent = money(n);
      updateNetWorthUI(liveRhTotal, n);
    });
  }

  startLiveSync();   // Robinhood total from Sheets
  startQuoteSync();  // live ticker prices via /api/quote
}

function goToCapitalTab() {
  document.querySelectorAll(".nav-item").forEach(function (i) {
    i.classList.remove("active");
  });
  const nav = document.querySelector('.nav-item[data-view="capital"]');
  if (nav) nav.classList.add("active");
  if (typeof setView === "function") setView("capital");
  else if (typeof layout !== "undefined" && layout) {
    layout.classList.remove("chat-mode", "music-mode", "maps-mode", "weather-mode");
    layout.classList.add("capital-mode");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootCapital);
} else {
  bootCapital();
}
