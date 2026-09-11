const input = document.getElementById("ask");
const form = document.getElementById("askForm");
const thread = document.getElementById("thread");
const layout = document.getElementById("layout");
const collapseBtn = document.getElementById("collapseBtn");
const histList = document.getElementById("histList");
const histCollapse = document.getElementById("histCollapse");
const newTopicBtn = document.getElementById("newTopic");
const mhPlay = document.getElementById("mhPlay");
const scFrame = document.getElementById("scPlayer");
const mhSearchForm = document.getElementById("mhSearchForm");
const mhSearch = document.getElementById("mhSearch");

let busy = false;
let topics = [{ id: 1, title: "New topic", messages: [] }];
let currentId = 1;
let nextId = 2;
let pendingFiles = [];
let musicPlaying = false;
let scWidget = null;
let currentSong = { title: "Nothing playing", artist: "Search a song", art: "", url: "" };

const widgetSource = {
  maps: ".card.nearby",
  stocks: ".card.markets",
  weather: ".card.weather",
  music: ".card.music"
};

function tickClock() {
  const now = new Date();
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  document.getElementById("dateLabel").textContent =
    months[now.getMonth()] + " " + String(now.getDate()).padStart(2,"0") + ", " + now.getFullYear();
  let h = now.getHours();
  const am = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  document.getElementById("timeLabel").textContent = h + ":" + String(now.getMinutes()).padStart(2, "0") + " " + am;
}
tickClock();
setInterval(tickClock, 1000);

if (collapseBtn) collapseBtn.addEventListener("click", () => layout.classList.toggle("collapsed"));
if (histCollapse) histCollapse.addEventListener("click", () => layout.classList.toggle("hist-hid"));
if (newTopicBtn) newTopicBtn.addEventListener("click", startTopic);

function hideHuds() {
  ["musicHud", "mapsHud", "weatherHud", "capitalHud"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.cssText = "";
    el.style.setProperty("display", "none", "important");
  });
  const hero = document.querySelector(".hero");
  const right = document.querySelector("aside.right");
  const hist = document.getElementById("historyPane");
  if (hero) hero.style.removeProperty("display");
  if (right) right.style.removeProperty("display");
  if (hist) hist.style.removeProperty("display");
}
function showHud(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.cssText = "";
  el.style.setProperty("display", "grid", "important");
}
function coverHome() {
  const hero = document.querySelector(".hero");
  const right = document.querySelector("aside.right");
  const hist = document.getElementById("historyPane");
  if (hero) hero.style.setProperty("display", "none", "important");
  if (right) right.style.setProperty("display", "none", "important");
  if (hist) hist.style.setProperty("display", "none", "important");
}
function setView(view) {
  if (view === "holdings" || view === "stocks") view = "capital";
  layout.classList.remove("chat-mode", "music-mode", "maps-mode", "weather-mode", "capital-mode", "home-mode");
  hideHuds();
  if (view === "chat") layout.classList.add("chat-mode");
  if (view === "music") {
    layout.classList.add("music-mode");
    coverHome();
    showHud("musicHud");
  }
  if (view === "maps") {
    layout.classList.add("maps-mode");
    coverHome();
    showHud("mapsHud");
    setTimeout(ensureMap, 40);
  }
  if (view === "weather") {
    layout.classList.add("weather-mode");
    coverHome();
    if (typeof ensureWeatherHud === "function") ensureWeatherHud();
    showHud("weatherHud");
    if (typeof loadWeather === "function") loadWeather(weatherPlace.lat, weatherPlace.lng, weatherPlace.name);
  }
  if (view === "capital") {
    layout.classList.add("capital-mode");
    coverHome();
    showHud("capitalHud");
    if (typeof bootCapital === "function") bootCapital();
  }
  if (view === "home" || !view) {
    layout.classList.add("home-mode");
    setTimeout(resizeHomeMap, 50);
  }
}
function openWidget(name) {
  if (name === "capital" || name === "stocks" || name === "holdings") {
    goToCapitalTab();
    return;
  }
  setView("chat");
  if (name === "music") { insertChatMusicCard(); return; }
  if (name === "maps") { insertChatMapsCard(); return; }
  const line = document.createElement("div");
  line.className = "line widget";
  const sel = widgetSource[name];
  if (sel) {
    const src = document.querySelector("aside.right " + sel);
    if (src) line.appendChild(src.cloneNode(true));
  } else {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<div class="widget-note">' + name.toUpperCase() + " widget.</div>";
    line.appendChild(card);
  }
  thread.appendChild(line);
  thread.scrollTop = thread.scrollHeight;
}
document.querySelectorAll(".nav-item").forEach(item => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
    item.classList.add("active");
    const fromAttr = (item.getAttribute("data-view") || "").toLowerCase().trim();
    const fromLabel = ((item.querySelector(".t") || {}).textContent || "").toLowerCase().trim();
    setView(fromAttr || fromLabel || "home");
  });
});
function currentTopic() {
  return topics.find(t => t.id === currentId) || topics[0];
}
function shortTitle(text) {
  const s = (text || "").replace(/\s+/g, " ").trim();
  return s.length > 36 ? s.slice(0, 36) + "…" : s || "New topic";
}
function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(b => b && b.type === "text").map(b => b.text || "").join(" ").trim();
}
function showUserShot(dataUrl) {
  const line = document.createElement("div");
  line.className = "line me";
  const img = document.createElement("img");
  img.className = "shot";
  img.src = dataUrl;
  line.appendChild(img);
  thread.appendChild(line);
}
function renderUserContent(content) {
  if (Array.isArray(content)) {
    content.forEach(b => {
      if (b && b.type === "image" && b.source && b.source.data) {
        showUserShot("data:" + (b.source.media_type || "image/jpeg") + ";base64," + b.source.data);
      }
    });
    const t = textFromContent(content);
    if (t) addLine("You", t, "me");
    return;
  }
  addLine("You", content, "me");
}
function renderThread() {
  thread.innerHTML = "";
  currentTopic().messages.forEach(m => {
    if (m.role === "widget") openWidget(m.content);
    else if (m.role === "user") renderUserContent(m.content);
    else addLine("Hope", typeof m.content === "string" ? m.content : textFromContent(m.content), "bot");
  });
}
function renderTopics() {
  if (!histList) return;
  histList.innerHTML = "";
  const listed = topics.filter(t => t.messages.length || t.id === currentId);
  if (!listed.length) {
    histList.innerHTML = '<div class="hist-empty">No topics yet</div>';
    return;
  }
  listed.forEach(t => {
    const el = document.createElement("div");
    el.className = "hist-item" + (t.id === currentId ? " on" : "");
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = t.title;
    const meta = document.createElement("div");
    meta.className = "meta";
    const n = t.messages.filter(m => m.role === "user").length;
    meta.textContent = n ? n + " message" + (n === 1 ? "" : "s") : "Empty";
    el.appendChild(name);
    el.appendChild(meta);
    el.addEventListener("click", () => { currentId = t.id; renderThread(); renderTopics(); });
    histList.appendChild(el);
  });
}
function startTopic() {
  topics.unshift({ id: nextId++, title: "New topic", messages: [] });
  currentId = topics[0].id;
  pendingFiles = [];
  renderAttachRow();
  renderThread();
  renderTopics();
  input.focus();
}
function addLine(who, text, cls) {
  const line = document.createElement("div");
  line.className = "line " + cls;
  const label = document.createElement("div");
  label.className = "who";
  label.textContent = who;
  const body = document.createElement("div");
  body.className = "txt";
  line.appendChild(label);
  line.appendChild(body);
  if (cls === "bot") paintBotText(body, text);
  else body.textContent = text;
  thread.appendChild(line);
  thread.scrollTop = thread.scrollHeight;
  return body;
}
function detectWidget(text) {
  const q = (text || "").toLowerCase();
  if (typeof detectPlay === "function" && detectPlay(text)) return null;
  if (typeof detectNearMe === "function" && detectNearMe(text)) return null;
  if (typeof detectWeatherAsk === "function" && detectWeatherAsk(text)) return null;
  const ask = /\b(open|show|pull up|bring up|launch|display)\b/.test(q) || /\bwidget\b/.test(q);
  if (!ask) return null;
  if (/\bmusic\b/.test(q)) return "music";
  if (/\bmaps?|nearby|directions\b/.test(q)) return "maps";
  if (/\bweather|forecast\b/.test(q)) return "weather";
  if (/\bstocks?|markets?|holdings|capital|net worth|bills\b/.test(q)) return "capital";
  return null;
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function shrinkImage(file, max = 1280) {
  return new Promise((resolve) => {
    if (!file.type || !file.type.startsWith("image/")) {
      fileToDataUrl(file).then(resolve).catch(() => resolve(null));
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); fileToDataUrl(file).then(resolve); };
    img.src = url;
  });
}
function renderAttachRow() {
  const row = document.getElementById("attachRow");
  if (!row) return;
  row.innerHTML = "";
  pendingFiles.forEach((f, i) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    if ((f.media || "").startsWith("image/") && f.data) {
      const im = document.createElement("img");
      im.src = "data:" + f.media + ";base64," + f.data;
      chip.appendChild(im);
    }
    const nm = document.createElement("div");
    nm.className = "nm";
    nm.textContent = f.name || "file";
    const x = document.createElement("button");
    x.type = "button";
    x.className = "x";
    x.textContent = "×";
    x.addEventListener("click", () => { pendingFiles.splice(i, 1); renderAttachRow(); });
    chip.appendChild(nm);
    chip.appendChild(x);
    row.appendChild(chip);
  });
}
async function addFiles(list) {
  for (const file of list) {
    if (!file || file.size > 8 * 1024 * 1024) continue;
    const dataUrl = await shrinkImage(file);
    if (!dataUrl || typeof dataUrl !== "string") continue;
    const parts = dataUrl.split(",");
    const meta = parts[0] || "";
    const data = parts[1] || "";
    const media = ((meta.match(/data:([^;]+)/) || [])[1] || file.type || "application/octet-stream");
    const kind = media.startsWith("image/") ? "image" : (media === "application/pdf" ? "document" : "text");
    pendingFiles.push({ name: file.name || "paste", media, data, kind });
  }
  renderAttachRow();
}
function blocksFromPending(text) {
  const blocks = [];
  pendingFiles.forEach(f => {
    if (f.kind === "image") {
      blocks.push({ type: "image", source: { type: "base64", media_type: f.media || "image/jpeg", data: f.data } });
    } else if (f.kind === "document") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } });
    } else {
      try {
        blocks.push({ type: "text", text: "File " + f.name + ":\n" + atob(f.data).slice(0, 12000) });
      } catch (e) {}
    }
  });
  if (text) blocks.push({ type: "text", text: text });
  else if (blocks.length) blocks.push({ type: "text", text: "Look at this." });
  return blocks;
}
const attachBtn = document.getElementById("attachBtn");
const filePick = document.getElementById("filePick");
if (attachBtn && filePick) {
  attachBtn.addEventListener("click", () => filePick.click());
  filePick.addEventListener("change", async () => {
    await addFiles(filePick.files);
    filePick.value = "";
  });
}
document.addEventListener("paste", async (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const files = [];
  for (const it of items) {
    if (it.type && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) {
    e.preventDefault();
    await addFiles(files);
  }
});
const dropTarget = document.querySelector(".search");
if (dropTarget) {
  ["dragenter", "dragover"].forEach(ev => dropTarget.addEventListener(ev, e => {
    e.preventDefault();
    dropTarget.classList.add("drop");
  }));
  ["dragleave", "drop"].forEach(ev => dropTarget.addEventListener(ev, e => {
    e.preventDefault();
    dropTarget.classList.remove("drop");
  }));
  dropTarget.addEventListener("drop", async e => {
    if (e.dataTransfer && e.dataTransfer.files) await addFiles(e.dataTransfer.files);
  });
}

function artUrl(raw) {
  if (!raw) return "";
  return String(raw)
    .replace("-large.", "-t500x500.")
    .replace("-badge.", "-t500x500.")
    .replace("-small.", "-t500x500.")
    .replace("-tiny.", "-t500x500.");
}
function setArt(src) {
  const url = artUrl(src);
  ["mhArt", "mhDockArt", "homeMusicArt", "npArt"].forEach(id => {
    const el = document.getElementById(id);
    if (el && url) el.src = url;
  });
  document.querySelectorAll(".card.music img, .mh-nowmini img, .mh-art").forEach(img => {
    if (url) img.src = url;
  });
}
function setSongText(title, artist) {
  const t = title || "Nothing playing";
  const a = artist || "Search a song";
  ["mhTitle", "mhDockTitle", "homeMusicTitle", "npTitle"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = t;
  });
  ["mhArtist", "mhDockArtist", "homeMusicArtist", "npArtist"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = a;
  });
  document.querySelectorAll(".mh-title").forEach(el => { el.textContent = t; });
  document.querySelectorAll(".mh-artist").forEach(el => { el.textContent = a; });
}
function applySong(song) {
  currentSong = {
    title: song.title || song.name || "Unknown",
    artist: song.artist || (song.user && song.user.username) || "SoundCloud",
    art: artUrl(song.art || song.artwork_url || song.artwork || ""),
    url: song.url || song.permalink_url || ""
  };
  setSongText(currentSong.title, currentSong.artist);
  if (currentSong.art) setArt(currentSong.art);
}
function bootSc() {
  if (scWidget || !scFrame || !window.SC) return;
  scWidget = window.SC.Widget(scFrame);
}
function loadAndPlay(url) {
  bootSc();
  if (!scWidget || !url) return;
  scWidget.load(url, { auto_play: true });
  musicPlaying = true;
}
function detectPlay(text) {
  const q = (text || "").trim();
  const m = q.match(/^(?:play|put on|queue)\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
async function requestSong(q) {
  const res = await fetch("/api/sc-search?q=" + encodeURIComponent(q));
  const data = await res.json();
  const hit = data.track || data.song || (Array.isArray(data.results) && data.results[0]) || data;
  if (!hit || !(hit.url || hit.permalink_url)) throw new Error("no track");
  applySong(hit);
  loadAndPlay(hit.url || hit.permalink_url);
  return hit;
}
function insertChatMusicCard() {
  const line = document.createElement("div");
  line.className = "line widget";
  const src = document.querySelector("aside.right .card.music");
  if (src) {
    const card = src.cloneNode(true);
    const img = card.querySelector("img");
    if (img && currentSong.art) img.src = currentSong.art;
    const title = card.querySelector(".title, .mh-t, .np-title");
    const artist = card.querySelector(".artist, .mh-s, .np-artist");
    if (title) title.textContent = currentSong.title;
    if (artist) artist.textContent = currentSong.artist;
    line.appendChild(card);
  }
  thread.appendChild(line);
  thread.scrollTop = thread.scrollHeight;
}

async function sendUserText(text) {
  text = (text || "").trim();
  if ((!text && !pendingFiles.length) || busy) return;
  busy = true;
  const topic = currentTopic();
  const hasFiles = pendingFiles.length > 0;
  const payload = hasFiles ? blocksFromPending(text) : text;
  renderUserContent(payload);
  topic.messages.push({ role: "user", content: payload });
  pendingFiles = [];
  renderAttachRow();
  if (topic.title === "New topic") topic.title = shortTitle(text || "Photo");
  renderTopics();
  input.value = "";
  if (!hasFiles && typeof detectWeatherAsk === "function" && detectWeatherAsk(text)) {
    goToWeatherTab();
    topic.messages.push({ role: "widget", content: "weather" });
    busy = false;
    input.focus();
    return;
  }
  const nearType = !hasFiles && typeof detectNearMe === "function" ? detectNearMe(text) : null;
  if (nearType) {
    showNearbyCategory(nearType);
    topic.messages.push({ role: "widget", content: "maps" });
    busy = false;
    input.focus();
    return;
  }
  const songQ = !hasFiles && detectPlay(text);
  if (songQ) {
    try {
      await requestSong(songQ);
      insertChatMusicCard();
      topic.messages.push({ role: "widget", content: "music" });
    } catch (err) {
      addLine("Hope", "Couldn't find that on SoundCloud.", "bot");
      topic.messages.push({ role: "assistant", content: "Couldn't find that on SoundCloud." });
      if (typeof speakHope === "function") speakHope("Couldn't find that on SoundCloud, sir.");
    }
    busy = false;
    input.focus();
    return;
  }
  const widgetName = !hasFiles ? detectWidget(text) : null;
  if (widgetName === "music") {
    insertChatMusicCard();
    topic.messages.push({ role: "widget", content: "music" });
    busy = false;
    input.focus();
    return;
  }
  if (widgetName === "maps") {
    insertChatMapsCard();
    topic.messages.push({ role: "widget", content: "maps" });
    busy = false;
    input.focus();
    return;
  }
  if (widgetName === "capital") {
    goToCapitalTab();
    topic.messages.push({ role: "widget", content: "capital" });
    busy = false;
    input.focus();
    return;
  }
  if (widgetName) {
    openWidget(widgetName);
    topic.messages.push({ role: "widget", content: widgetName });
    busy = false;
    input.focus();
    return;
  }
  const waiting = addLine("Hope", "0.0s", "bot");
  startThink(waiting);
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: topic.messages.filter(m => m.role === "user" || m.role === "assistant"),
        location: (typeof origin !== "undefined" && origin) ? { lat: origin.lat, lng: origin.lng } : null
      }),
    });
    const data = await res.json();
    const reply = data.text || data.error || "No reply";
    stopThink(waiting);
    paintBotText(waiting, reply);
    if (data.text) {
      topic.messages.push({ role: "assistant", content: data.text });
      if (typeof speakHope === "function") speakHope(data.text);
    }
  } catch (err) {
    stopThink(waiting);
    waiting.textContent = "Can't reach backend.";
  }
  thread.scrollTop = thread.scrollHeight;
  busy = false;
  input.focus();
}
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await sendUserText(input.value);
});

if (mhPlay) mhPlay.addEventListener("click", () => {
  bootSc();
  if (!scWidget) return;
  if (musicPlaying) { scWidget.pause(); musicPlaying = false; }
  else { scWidget.play(); musicPlaying = true; }
});
if (mhSearchForm) mhSearchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = ((mhSearch && mhSearch.value) || "").trim();
  if (!q) return;
  try { await requestSong(q); } catch (err) {}
});
if (document.readyState === "complete") bootSc();
else window.addEventListener("load", bootSc);

const VIEW_ORDER = ["home", "chat", "music", "maps", "weather", "capital"];
function currentView() {
  const on = document.querySelector(".nav-item.active");
  const v = ((on && on.getAttribute("data-view")) || "").toLowerCase();
  return VIEW_ORDER.includes(v) ? v : "home";
}
function goView(name) {
  const item = document.querySelector('.nav-item[data-view="' + name + '"]');
  if (!item) return;
  document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
  item.classList.add("active");
  setView(name);
}
function shiftView(dir) {
  const i = VIEW_ORDER.indexOf(currentView());
  goView(VIEW_ORDER[(i + dir + VIEW_ORDER.length) % VIEW_ORDER.length]);
}
let dragX = null;
document.addEventListener("pointerdown", e => {
  if (e.target.closest("input,textarea,button,a,.search,.thread,.nav-item,.mp-map,#homeMap")) return;
  dragX = e.clientX;
});
document.addEventListener("pointerup", e => {
  if (dragX == null) return;
  const dx = e.clientX - dragX;
  dragX = null;
  if (Math.abs(dx) < 90) return;
  shiftView(dx < 0 ? 1 : -1);
});
document.addEventListener("pointercancel", () => { dragX = null; });
renderTopics();
