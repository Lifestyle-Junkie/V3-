const CAP_LOGOS = {
  AAPL: "https://www.google.com/s2/favicons?sz=64&domain=apple.com",
  TSLA: "https://www.google.com/s2/favicons?sz=64&domain=tesla.com",
  NVDA: "https://www.google.com/s2/favicons?sz=64&domain=nvidia.com",
  MSFT: "https://www.google.com/s2/favicons?sz=64&domain=microsoft.com",
  AMZN: "https://www.google.com/s2/favicons?sz=64&domain=amazon.com",
  GOOGL: "https://www.google.com/s2/favicons?sz=64&domain=google.com",
  GOOG: "https://www.google.com/s2/favicons?sz=64&domain=google.com"
};
const CAP_HOLDINGS = [
  { t: "AAPL", name: "Apple", val: 4321.12, chg: 1.24 },
  { t: "TSLA", name: "Tesla", val: 3892.40, chg: 2.91 },
  { t: "NVDA", name: "Nvidia", val: 2487.55, chg: 1.87 },
  { t: "MSFT", name: "Microsoft", val: 2201.18, chg: 0.94 },
  { t: "AMZN", name: "Amazon", val: 1882.34, chg: 1.12 },
  { t: "GOOGL", name: "Alphabet", val: 1135.21, chg: 1.56 }
];
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
function money(n) {
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function drawCapChart() {
  const el = document.getElementById("capChart");
  if (!el) return;
  const pts = [6, 8, 7, 9, 8, 11, 10, 13, 12, 16, 15, 18, 20, 19, 22, 24];
  const w = 520, h = 140;
  const max = Math.max.apply(null, pts);
  const step = w / (pts.length - 1);
  const path = pts.map((p, i) => {
    const x = i * step;
    const y = h - 16 - (p / max) * (h - 28);
    return (i ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ");
  const last = pts.length - 1;
  const lx = last * step;
  const ly = h - 16 - (pts[last] / max) * (h - 28);
  el.innerHTML =
    '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" width="100%" height="140">' +
    '<path d="' + path + ' L' + w + ',' + h + ' L0,' + h + ' Z" fill="rgba(62,224,122,0.12)"/>' +
    '<path d="' + path + '" fill="none" stroke="#3ee07a" stroke-width="2"/>' +
    '<circle cx="' + lx + '" cy="' + ly + '" r="4" fill="#3ee07a"/>' +
    "</svg>";
}
function renderHolds() {
  const box = document.getElementById("capHolds");
  if (!box) return;
  box.innerHTML = CAP_HOLDINGS.map(function (h) {
    const src = CAP_LOGOS[h.t] || "";
    return (
      '<div class="cap-hold">' +
      '<img class="tlogo" alt="' + h.t + '" src="' + src + '" />' +
      '<span class="tk">' + h.t + "</span>" +
      '<span class="pv">' + money(h.val) + "</span>" +
      '<span class="chg">+' + h.chg.toFixed(2) + "%</span>" +
      "</div>"
    );
  }).join("");
  box.querySelectorAll("img.tlogo").forEach(function (img) {
    img.addEventListener("error", function () {
      const letter = document.createElement("span");
      letter.className = "tlogo tlogo-fallback";
      letter.textContent = (img.alt || "?").slice(0, 1);
      img.replaceWith(letter);
    });
  });
}
function renderAlloc() {
  const el = document.getElementById("capAlloc");
  if (!el) return;
  el.innerHTML =
    "<div class='cap-alloc-pie'><div class='cap-alloc-center'><b>$18,420</b><span>Total</span></div></div>" +
    "<div class='cap-alloc-leg'>" +
      "<div><i class='rh'></i>Robinhood 86%<b>$15,920.32</b></div>" +
      "<div><i class='cash'></i>Cash 14%<b>$2,500.00</b></div>" +
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
    const mark = r.tone === "warn" ? WARN_ICO : "↓";
    return (
      '<div class="cap-ins ' + r.tone + '">' +
        '<span class="cap-ins-ico">' + mark + "</span>" +
        "<div><b>" + r.title + "</b><span>" + r.note + "</span></div>" +
      "</div>"
    );
  }).join("");
}
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
  const cash = document.getElementById("capCashEdit");
  if (cash) {
    cash.addEventListener("click", function () {
      const next = prompt("Cash on hand", "2500");
      if (next == null) return;
      const n = Number(String(next).replace(/[^0-9.]/g, ""));
      if (!isFinite(n)) return;
      const el = document.getElementById("capCashVal");
      if (el) el.textContent = money(n);
    });
  }
}
function goToCapitalTab() {
  document.querySelectorAll(".nav-item").forEach(function (i) {
    i.classList.remove("active");
  });
  const nav = document.querySelector('.nav-item[data-view="capital"]');
  if (nav) nav.classList.add("active");
  if (typeof setView === "function") setView("capital");
  else if (layout) {
    layout.classList.remove("chat-mode", "music-mode", "maps-mode", "weather-mode");
    layout.classList.add("capital-mode");
  }
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootCapital);
} else {
  bootCapital();
}
