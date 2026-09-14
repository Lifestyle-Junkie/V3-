/* ── Capital HUD ─────────────────────────────────────────────────────── */

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

/* ── Single Google Sheet (Accounts + Transactions) ───────────────────── */
const SHEET_ID = "1eVbAcpz_rGbZ0hXdA3Bleibzj_RfvFB3zkyhT6bgOpk";
const SHEET_ACCOUNTS_CSV =
  "https://docs.google.com/spreadsheets/d/" + SHEET_ID +
  "/gviz/tq?tqx=out:csv&sheet=Accounts";
const SHEET_TX_CSV =
  "https://docs.google.com/spreadsheets/d/" + SHEET_ID +
  "/gviz/tq?tqx=out:csv&sheet=Transactions";

let liveRhTotal = 3948.34;
let liveCash = 2500;

/* Bills start empty — user adds via top-right Edit */
let CAP_BILLS = [];

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

function parseCsvLine(line) {
  const cols = line.match(/(".*?"|[^,]*)/g) || [];
  return cols.map(function (c) {
    return c.replace(/^"|"$/g, "").replace(/""/g, '"').trim();
  });
}

/* ── Google Sheets: Robinhood total ──────────────────────────────────── */
async function fetchRobinhoodTotal() {
  try {
    const res = await fetch(SHEET_ACCOUNTS_CSV + "&_=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const csv = await res.text();
    if (csv.trim().startsWith("<!")) throw new Error("Sheet not shared");
    const lines = csv.trim().split(/\r?\n/);
    if (lines.length < 2) return;
    const headers = parseCsvLine(lines[0]);
    const balIdx = headers.findIndex(function (h) { return /current\s*balance/i.test(h); });
    if (balIdx === -1) return;
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      const name = (cells[1] || "").toLowerCase();
      const bal = parseMoney(cells[balIdx]);
      if (isFinite(bal) && (name.includes("robinhood") || i === 1)) {
        liveRhTotal = bal;
        updateNetWorthUI(liveRhTotal, getCashFromDom());
        return;
      }
    }
  } catch (err) {
    console.warn("[capital] Sheets RH fetch failed:", err);
  }
}

function startLiveSync() {
  fetchRobinhoodTotal();
  setInterval(fetchRobinhoodTotal, 60000);
}

/* ── Bills ↔ Category ID match ───────────────────────────────────────── */
function dueLabel(dueDay) {
  const d = Number(dueDay) || 1;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return months[new Date().getMonth()] + " " + d;
}

function statusForBill(bill, matched) {
  const now = new Date();
  const dueDay = Number(bill.dueDay) || 1;
  const duePassed = now.getDate() > dueDay;
  if (matched) {
    if (matched.pending) return "pend";
    return "paid";
  }
  return duePassed ? "over" : "pend";
}

async function fetchTransactionsAndMatch() {
  if (!CAP_BILLS.length) {
    renderBills();
    return;
  }
  try {
    const res = await fetch(SHEET_TX_CSV + "&_=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const csv = await res.text();
    if (csv.trim().startsWith("<!")) throw new Error("Transactions sheet not shared (401)");

    const lines = csv.trim().split(/\r?\n/);
    if (lines.length < 2) {
      CAP_BILLS.forEach(function (b) { b.st = statusForBill(b, null); });
      renderBills();
      return;
    }

    const headers = parseCsvLine(lines[0]).map(function (h) { return h.toLowerCase(); });
    const idx = {
      date: headers.findIndex(function (h) { return h === "date"; }),
      month: headers.findIndex(function (h) { return h === "month"; }),
      amount: headers.findIndex(function (h) { return h === "amount"; }),
      pending: headers.findIndex(function (h) { return /is\s*pending/i.test(h); }),
      catId: headers.findIndex(function (h) { return /category\s*id/i.test(h); }),
      catName: headers.findIndex(function (h) { return /category\s*name/i.test(h); }),
      net: headers.findIndex(function (h) { return /net\s*amount/i.test(h); })
    };

    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const monthNames = [
      "january","february","march","april","may","june",
      "july","august","september","october","november","december"
    ];

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      if (!cells.length) continue;
      const amount = parseMoney(
        idx.amount >= 0 ? cells[idx.amount] : (idx.net >= 0 ? cells[idx.net] : "")
      );
      const pendingRaw = (idx.pending >= 0 ? cells[idx.pending] : "").toLowerCase();
      rows.push({
        catId: idx.catId >= 0 ? String(cells[idx.catId] || "").trim() : "",
        catName: idx.catName >= 0 ? cells[idx.catName] : "",
        amount: isFinite(amount) ? Math.abs(amount) : null,
        pending: pendingRaw === "true" || pendingRaw === "yes" || pendingRaw === "1",
        dateStr: idx.date >= 0 ? cells[idx.date] : "",
        monthStr: idx.month >= 0 ? cells[idx.month] : ""
      });
    }

    function rowInThisMonth(r) {
      const d = new Date(r.dateStr);
      if (!isNaN(d.getTime())) {
        return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
      }
      const m = (r.monthStr || "").toLowerCase();
      return m.indexOf(monthNames[thisMonth]) !== -1 && m.indexOf(String(thisYear)) !== -1;
    }

    CAP_BILLS.forEach(function (bill) {
      const key = String(bill.categoryId || "").trim().toLowerCase();
      let matched = null;
      if (key) {
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          if (!rowInThisMonth(r)) continue;
          if (String(r.catId).toLowerCase() === key) {
            matched = r;
            break;
          }
        }
      }
      bill.st = statusForBill(bill, matched);
      if (matched && matched.amount != null) {
        bill.amt = matched.amount;
      }
    });

    renderBills();
  } catch (err) {
    console.warn("[capital] Transactions match failed:", err);
    CAP_BILLS.forEach(function (b) { b.st = statusForBill(b, null); });
    renderBills();
  }
}

function startBillSync() {
  fetchTransactionsAndMatch();
  setInterval(fetchTransactionsAndMatch, 60000);
}

/** Top-right Edit → add bill (Category ID, not transaction ID) */
function addBillViaEdit() {
  const name = prompt("Bill name (e.g. Car note)");
  if (name == null) return;
  const nameTrim = name.trim();
  if (!nameTrim) return;

  const amtStr = prompt("Amount (e.g. 406.50)", "");
  if (amtStr == null) return;
  const amt = parseMoney(amtStr);
  if (!isFinite(amt) || amt < 0) {
    alert("Enter a valid amount");
    return;
  }

  const due = prompt("Due day of month (1–31)", "1");
  if (due == null) return;
  const dueDay = Math.max(1, Math.min(31, parseInt(due, 10) || 1));

  const catId = prompt(
    "Category ID from your sheet\n(e.g. LOAN_PAYMENTS_CAR_PAYMENT)\nStable each month — not the transaction ID",
    ""
  );
  if (catId == null) return;

  const typeAns = prompt("Type: Recurring or One-Time", "Recurring");
  if (typeAns == null) return;
  const type = /one/i.test(typeAns || "") ? "One-Time" : "Recurring";

  CAP_BILLS.push({
    name: nameTrim,
    amt: amt,
    dueDay: dueDay,
    type: type,
    categoryId: String(catId).trim(),
    st: "pend"
  });

  renderBills();
  fetchTransactionsAndMatch();
}

function ensureBillEditButton() {
  let btn = document.getElementById("capBillEdit");
  if (btn) {
    btn.onclick = addBillViaEdit;
    return;
  }

  const box = document.getElementById("capBills");
  if (!box) return;
  const card = box.closest(".cap-card") || box.parentElement;
  if (!card) return;

  let head = card.querySelector(".cap-card-h");
  if (!head) {
    head = document.createElement("div");
    head.className = "cap-card-h";
    head.innerHTML = "<span>MONTHLY BILLS</span>";
    card.insertBefore(head, box);
  }

  // Strip any stray Edit near column headers / outside card header
  card.querySelectorAll("button.cap-edit, button.cap-bill-edit").forEach(function (b) {
    if (b.id === "capBillEdit") return;
    if (b.closest(".cap-bill-h") || !b.closest(".cap-card-h")) b.remove();
  });

  if (!head.querySelector("#capBillEdit")) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "capBillEdit";
    btn.className = "cap-edit";
    btn.textContent = "Edit";
    btn.addEventListener("click", addBillViaEdit);
    head.appendChild(btn);
  }
}

function renderBills() {
  const box = document.getElementById("capBills");
  if (!box) return;

  ensureBillEditButton();

  let total = 0;

  if (!CAP_BILLS.length) {
    box.innerHTML =
      '<div class="cap-bill-empty">No bills yet — tap Edit to add one</div>';
  } else {
    box.innerHTML =
      '<div class="cap-bill-h">' +
        "<span>Bill</span><span>Amount</span><span>Due</span><span>Type</span><span>Status</span>" +
      "</div>" +
      CAP_BILLS.map(function (b) {
        total += Number(b.amt) || 0;
        const label = b.st === "paid" ? "Paid" : b.st === "over" ? "Overdue" : "Pending";
        return (
          '<div class="cap-bill">' +
            "<span>" + b.name + "</span>" +
            "<span>" + money(b.amt) + "</span>" +
            "<span>" + dueLabel(b.dueDay) + "</span>" +
            "<span>" + b.type + "</span>" +
            '<span class="st ' + b.st + '">' + label + "</span>" +
          "</div>"
        );
      }).join("");
  }

  const tot = document.getElementById("capBillTotal");
  if (tot) tot.textContent = money(total).replace(".00", "");
}

/* ── Interactive tickers ─────────────────────────────────────────────── */
let holdings = [];

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

  box.querySelectorAll("img.tlogo").forEach(function (img) {
    img.addEventListener("error", function () {
      const letter = document.createElement("span");
      letter.className = "tlogo tlogo-fallback";
      letter.textContent = (img.alt || "?").slice(0, 1);
      img.replaceWith(letter);
    });
  });

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

  box.querySelectorAll(".cap-hold-rm").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      removeTicker(btn.getAttribute("data-t"));
    });
  });

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
  if (holdings.some(function (h) { return h.t === t; })) return;
  holdings.push({ t: t, name: t, price: null, chg: 0 });
  renderHolds();
  fetchQuotes();
}

function removeTicker(symbol) {
  const t = symbol.toUpperCase();
  holdings = holdings.filter(function (h) { return h.t !== t; });
  renderHolds();
}

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
    if (q.price != null) { h.price = q.price; changed = true; }
    if (q.chg != null) { h.chg = q.chg; changed = true; }
    if (q.name) h.name = q.name;
  });
  if (changed) renderHolds();
}

function startQuoteSync() {
  fetchQuotes();
  setInterval(fetchQuotes, 60000);
}

/* ── Chart / alloc / months / insights ───────────────────────────────── */
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

  startLiveSync();
  startQuoteSync();
  startBillSync();
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
