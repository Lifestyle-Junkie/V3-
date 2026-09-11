function parseSources(text) {
  const raw = String(text || "");
  const split = raw.split(/\nSources:\s*/i);
  const body = (split[0] || "").trim();
  const rest = split.slice(1).join("\n");
  const links = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let m;
  while ((m = re.exec(rest))) links.push({ title: m[1], url: m[2] });
  if (!links.length) {
    (rest.match(/https?:\/\/[^\s)]+/g) || []).forEach(url => links.push({ title: url, url }));
  }
  return { body: links.length ? body : raw, links };
}

function sourceRow(links) {
  const row = document.createElement("div");
  row.className = "src-row";
  links.forEach(link => {
    const a = document.createElement("a");
    a.className = "src-ico";
    a.href = link.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = link.title;
    const img = document.createElement("img");
    try {
      img.src = "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(new URL(link.url).hostname) + "&sz=64";
    } catch (e) {}
    img.alt = link.title;
    a.appendChild(img);
    row.appendChild(a);
  });
  return row;
}

function stripMd(text) {
  return String(text || "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1");
}

function isSepRow(cells) {
  return cells.length > 1 && cells.every(c => /^:?-{3,}:?$/.test(String(c).replace(/\s/g, "") || "---"));
}

function splitCells(line) {
  let s = String(line || "").trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map(c => c.trim());
}

function splitBlocks(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let buf = [];
  function flushText() {
    const t = buf.join("\n").trim();
    if (t) blocks.push({ type: "text", text: t });
    buf = [];
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^#{1,3}\s+(.+)$/);
    if (h) {
      flushText();
      blocks.push({ type: "h", text: h[1].trim() });
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && isSepRow(splitCells(lines[i + 1]))) {
      flushText();
      const rows = [splitCells(line)];
      i += 1;
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith("|")) {
        i += 1;
        const cells = splitCells(lines[i]);
        if (!isSepRow(cells)) rows.push(cells);
      }
      blocks.push({ type: "table", rows });
      continue;
    }
    buf.push(line);
  }
  flushText();
  return blocks;
}

function renderMd(el, text) {
  el.textContent = "";
  const parts = String(text || "").split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  parts.forEach(part => {
    if (!part) return;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      const b = document.createElement("strong");
      b.textContent = part.slice(2, -2);
      el.appendChild(b);
    } else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      const c = document.createElement("code");
      c.textContent = part.slice(1, -1);
      el.appendChild(c);
    } else {
      el.appendChild(document.createTextNode(part));
    }
  });
}

function renderTable(rows) {
  const wrap = document.createElement("div");
  wrap.className = "bot-table-wrap";
  const table = document.createElement("table");
  table.className = "bot-table";
  rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    row.forEach(cell => {
      const td = document.createElement(i === 0 ? "th" : "td");
      renderMd(td, cell);
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  wrap.appendChild(table);
  return wrap;
}

function paintBotText(bodyEl, text) {
  bodyEl.classList.remove("think-row");
  bodyEl.textContent = "";
  const parsed = parseSources(text);
  const rich = document.createDocumentFragment();
  let card = null;
  function openCard() {
    card = document.createElement("div");
    card.className = "bot-card";
    rich.appendChild(card);
  }
  splitBlocks(parsed.body).forEach(block => {
    if (block.type === "h") {
      openCard();
      const h = document.createElement("div");
      h.className = "bot-h";
      h.textContent = block.text;
      card.appendChild(h);
    } else if (block.type === "table") {
      if (!card) openCard();
      card.appendChild(renderTable(block.rows));
    } else {
      const p = document.createElement("div");
      p.className = "bot-p";
      renderMd(p, block.text);
      if (card) card.appendChild(p);
      else rich.appendChild(p);
    }
  });
  bodyEl.appendChild(rich);
  const line = bodyEl.parentNode;
  if (!line) return bodyEl;
  line.classList.remove("thinking");
  const old = line.querySelector(".src-row");
  if (old) old.remove();
  if (parsed.links.length) line.appendChild(sourceRow(parsed.links));
  return bodyEl;
}

let thinkTimer = null;
let thinkStarted = 0;

function formatThink(ms) {
  const t = Math.max(0, ms / 1000);
  if (t < 60) return t.toFixed(1) + "s";
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(1);
  return m + ":" + (Number(s) < 10 ? "0" + s : s);
}

function startThink(el) {
  stopThink(el);
  thinkStarted = performance.now();
  const line = el.parentNode;
  if (line) line.classList.add("thinking");
  el.classList.add("think-row");
  el.textContent = "";
  const orb = document.createElement("span");
  orb.className = "mini-orb";
  const sec = document.createElement("span");
  sec.className = "think-sec";
  sec.textContent = "0.0s";
  el.appendChild(orb);
  el.appendChild(sec);
  thinkTimer = setInterval(() => {
    if (!el.isConnected) { stopThink(el); return; }
    sec.textContent = formatThink(performance.now() - thinkStarted);
  }, 100);
}

function stopThink(el) {
  if (thinkTimer) clearInterval(thinkTimer);
  thinkTimer = null;
  if (el && el.parentNode) el.parentNode.classList.remove("thinking");
  if (el) el.classList.remove("think-row");
}
