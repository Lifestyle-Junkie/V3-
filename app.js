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
let musicPlaying = false;
let scWidget = null;
let currentSong = { title: "Nothing playing", artist: "Search a song", art: "", url: "" };
let voiceOn = true;
let hopeVoice = null;
let micOn = false;
let rec = null;
let wakeRec = null;
let thinkTimer = null;
let thinkStarted = 0;
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
  const weatherHud = document.getElementById("weatherHud");
  const mapsHud = document.getElementById("mapsHud");
  const musicHud = document.getElementById("musicHud");
  const hero = document.querySelector(".hero");
  const right = document.querySelector("aside.right");
  const hist = document.getElementById("historyPane");
  if (musicHud) musicHud.style.removeProperty("display");
  if (mapsHud) mapsHud.style.removeProperty("display");
  if (weatherHud) {
    weatherHud.style.cssText = "";
    weatherHud.style.display = "none";
  }
  if (hero) hero.style.removeProperty("display");
  if (right) right.style.removeProperty("display");
  if (hist) hist.style.removeProperty("display");
}
function setView(view) {
  layout.classList.remove("chat-mode", "music-mode", "maps-mode", "weather-mode");
  hideHuds();
  const mapsHud = document.getElementById("mapsHud");
  const musicHud = document.getElementById("musicHud");
  const hero = document.querySelector(".hero");
  const right = document.querySelector("aside.right");
  const hist = document.getElementById("historyPane");
  if (view === "chat") layout.classList.add("chat-mode");
  if (view === "music") {
    layout.classList.add("music-mode");
    if (hero) hero.style.setProperty("display", "none", "important");
    if (right) right.style.setProperty("display", "none", "important");
    if (hist) hist.style.setProperty("display", "none", "important");
    if (musicHud) musicHud.style.setProperty("display", "grid", "important");
  }
  if (view === "maps") {
    layout.classList.add("maps-mode");
    if (hero) hero.style.setProperty("display", "none", "important");
    if (right) right.style.setProperty("display", "none", "important");
    if (hist) hist.style.setProperty("display", "none", "important");
    if (mapsHud) mapsHud.style.setProperty("display", "grid", "important");
    setTimeout(ensureMap, 40);
  }
  if (view === "weather") {
    layout.classList.add("weather-mode");
    if (hero) hero.style.setProperty("display", "none", "important");
    if (right) right.style.setProperty("display", "none", "important");
    if (hist) hist.style.setProperty("display", "none", "important");
    const weatherHud = ensureWeatherHud();
    weatherHud.style.cssText = "";
    weatherHud.style.setProperty("display", "grid", "important");
    loadWeather(weatherPlace.lat, weatherPlace.lng, weatherPlace.name);
  }
  if (view === "home") setTimeout(resizeHomeMap, 50);
}
function setPlayIcon(playing) {
  musicPlaying = playing;
  const pauseSm = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="7" y="5" width="3.2" height="14" rx="1"/><rect x="14" y="5" width="3.2" height="14" rx="1"/></svg>';
  const playSm = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  if (mhPlay) {
    mhPlay.innerHTML = playing
      ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="5" width="3.2" height="14" rx="1"/><rect x="14" y="5" width="3.2" height="14" rx="1"/></svg>'
      : '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  }
  document.querySelectorAll(".card.music .play").forEach(btn => { btn.innerHTML = playing ? pauseSm : playSm; });
}
function splitTitle(raw) {
  const t = (raw || "").trim();
  const m = t.match(/^(.*)\s+by\s+(.+)$/i);
  if (m) return { title: m[1].trim(), artist: m[2].trim() };
  return { title: t || currentSong.title, artist: currentSong.artist || "" };
}
function paintSong(title, artist, art) {
  if (title) currentSong.title = title;
  if (artist) currentSong.artist = artist;
  if (art) currentSong.art = art;
  setTxt("mhTitle", currentSong.title);
  setTxt("mhArtist", currentSong.artist);
  setTxt("mhTitleMini", currentSong.title);
  setTxt("mhArtistMini", currentSong.artist);
  setTxt("mhDockTitle", currentSong.title);
  setTxt("mhDockArtist", currentSong.artist);
  if (currentSong.art) {
    const big = document.getElementById("mhArt");
    const dock = document.getElementById("mhDockArt");
    if (big) big.src = currentSong.art;
    if (dock) dock.src = currentSong.art;
  }
  document.querySelectorAll(".card.music").forEach(card => {
    const titleEl = card.querySelector(".np .title, .title");
    const artistEl = card.querySelector(".np .artist, .artist");
    const img = card.querySelector(".art img");
    if (titleEl) titleEl.textContent = currentSong.title;
    if (artistEl) artistEl.textContent = currentSong.artist;
    if (img && currentSong.art) img.src = currentSong.art;
  });
}
function syncFromWidget() {
  if (!scWidget) return;
  scWidget.getCurrentSound(sound => {
    if (!sound) return;
    const title = sound.title || currentSong.title;
    const artist = (sound.user && sound.user.username) || currentSong.artist;
    let art = sound.artwork_url || (sound.user && sound.user.avatar_url) || "";
    if (art) art = art.replace("-large", "-t500x500");
    paintSong(title, artist, art);
  });
}
function playUrl(url) {
  currentSong.url = url;
  if (!scWidget) bindSoundCloud();
  if (!scWidget) return;
  scWidget.load(url, { auto_play: true });
  setTimeout(() => { try { scWidget.play(); } catch (e) {} }, 700);
}
async function requestSong(query) {
  const q = (query || "").trim();
  if (!q) return null;
  const res = await fetch("/api/sc-search?q=" + encodeURIComponent(q));
  const data = await res.json();
  if (!data.url) throw new Error("No SoundCloud track found");
  const parsed = splitTitle(data.title || q);
  paintSong(data.title || parsed.title, data.artist || parsed.artist, data.art || currentSong.art);
  playUrl(data.url);
  return data;
}
function insertChatMusicCard() {
  const line = document.createElement("div");
  line.className = "line widget";
  const src = document.querySelector("aside.right .card.music");
  if (src) {
    const clone = src.cloneNode(true);
    const titleEl = clone.querySelector(".np .title, .title");
    const artistEl = clone.querySelector(".np .artist, .artist");
    const img = clone.querySelector(".art img");
    if (titleEl) titleEl.textContent = currentSong.title;
    if (artistEl) artistEl.textContent = currentSong.artist;
    if (img && currentSong.art) img.src = currentSong.art;
    const play = clone.querySelector(".play");
    if (play) play.addEventListener("click", togglePlay);
    line.appendChild(clone);
  }
  thread.appendChild(line);
  thread.scrollTop = thread.scrollHeight;
}
function detectPlay(text) {
  const q = (text || "").trim();
  const m = q.match(/^(?:play|put on|start|queue)\s+(?:the\s+song\s+)?(.+?)(?:\s+on\s+soundcloud)?$/i);
  if (m) return m[1].replace(/[.?!]+$/, "").trim();
  return null;
}
function togglePlay() {
  if (!scWidget) bindSoundCloud();
  if (!scWidget) return;
  scWidget.isPaused(paused => { if (paused) scWidget.play(); else scWidget.pause(); });
}
function bindSoundCloud() {
  if (!scFrame || typeof SC === "undefined" || !SC.Widget) return;
  if (scWidget) return;
  scWidget = SC.Widget(scFrame);
  scWidget.bind(SC.Widget.Events.READY, syncFromWidget);
  scWidget.bind(SC.Widget.Events.PLAY, () => { setPlayIcon(true); syncFromWidget(); });
  scWidget.bind(SC.Widget.Events.PAUSE, () => setPlayIcon(false));
  scWidget.bind(SC.Widget.Events.PLAY_PROGRESS, e => {
    const cur = document.getElementById("mhCur");
    if (cur && e && typeof e.currentPosition === "number") {
      const s = Math.floor(e.currentPosition / 1000);
      cur.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    }
  });
}
if (document.readyState === "complete") bindSoundCloud();
else window.addEventListener("load", bindSoundCloud);
if (mhPlay) mhPlay.addEventListener("click", togglePlay);
document.querySelectorAll("aside.right .card.music .play").forEach(btn => btn.addEventListener("click", togglePlay));
if (mhSearchForm) {
  mhSearchForm.addEventListener("submit", async e => {
    e.preventDefault();
    const q = (mhSearch.value || "").trim();
    if (!q) return;
    mhSearch.value = "";
    try { await requestSong(q); } catch (err) { paintSong("Not found", q, ""); }
  });
}
function openWidget(name) {
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
function renderThread() {
  thread.innerHTML = "";
  currentTopic().messages.forEach(m => {
    if (m.role === "widget") openWidget(m.content);
    else addLine(m.role === "user" ? "You" : "Hope", m.content, m.role === "user" ? "me" : "bot");
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
  renderThread();
  renderTopics();
  input.focus();
}
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
function paintBotText(bodyEl, text) {
  bodyEl.classList.remove("think-row");
  const parsed = parseSources(text);
  renderMd(bodyEl, parsed.body);
  const line = bodyEl.parentNode;
  if (!line) return bodyEl;
  line.classList.remove("thinking");
  const old = line.querySelector(".src-row");
  if (old) old.remove();
  if (parsed.links.length) line.appendChild(sourceRow(parsed.links));
  return bodyEl;
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
function detectWidget(text) {
  const q = (text || "").toLowerCase();
  if (detectPlay(text) || detectNearMe(text) || detectWeatherAsk(text)) return null;
  const ask = /\b(open|show|pull up|bring up|launch|display)\b/.test(q) || /\bwidget\b/.test(q);
  if (!ask) return null;
  if (/\bmusic\b/.test(q)) return "music";
  if (/\bmaps?|nearby|directions\b/.test(q)) return "maps";
  if (/\bweather|forecast\b/.test(q)) return "weather";
  if (/\bstocks?|markets?\b/.test(q)) return "stocks";
  return null;
}
function SpeechEngine() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}
function setOrbTalking(on) {
  const orb = document.querySelector(".orb-wrap");
  if (orb) orb.classList.toggle("speaking", !!on);
}
function stripWake(text) {
  return (text || "")
    .replace(/^\s*(hey\s+)?hope[,.\s]*/i, "")
    .trim();
}
async function speakHope(text) {
  if (!voiceOn || !text) return;
  try {
    if (hopeVoice) {
      hopeVoice.pause();
      hopeVoice.src = "";
    }
    const spoken = stripMd(parseSources(text).body);
    const res = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: String(spoken).slice(0, 1200) }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    hopeVoice = new Audio(URL.createObjectURL(blob));
    setOrbTalking(true);
    hopeVoice.onended = () => setOrbTalking(false);
    hopeVoice.onerror = () => setOrbTalking(false);
    await hopeVoice.play();
  } catch (err) {
    setOrbTalking(false);
  }
}
async function sendUserText(text) {
  text = (text || "").trim();
  if (!text || busy) return;
  busy = true;
  const topic = currentTopic();
  addLine("You", text, "me");
  topic.messages.push({ role: "user", content: text });
  if (topic.title === "New topic") topic.title = shortTitle(text);
  renderTopics();
  input.value = "";
  if (typeof detectWeatherAsk === "function" && detectWeatherAsk(text)) {
    goToWeatherTab();
    topic.messages.push({ role: "widget", content: "weather" });
    busy = false;
    input.focus();
    return;
  }
  const nearType = typeof detectNearMe === "function" ? detectNearMe(text) : null;
  if (nearType) {
    showNearbyCategory(nearType);
    topic.messages.push({ role: "widget", content: "maps" });
    busy = false;
    input.focus();
    return;
  }
  const songQ = detectPlay(text);
  if (songQ) {
    try {
      await requestSong(songQ);
      insertChatMusicCard();
      topic.messages.push({ role: "widget", content: "music" });
    } catch (err) {
      addLine("Hope", "Couldn't find that on SoundCloud.", "bot");
      topic.messages.push({ role: "assistant", content: "Couldn't find that on SoundCloud." });
      speakHope("Couldn't find that on SoundCloud, sir.");
    }
    busy = false;
    input.focus();
    return;
  }
  const widgetName = detectWidget(text);
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
      speakHope(data.text);
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
const voiceToggle = document.querySelector(".toggle");
if (voiceToggle) {
  voiceToggle.classList.add("on");
  voiceToggle.addEventListener("click", () => {
    voiceOn = !voiceOn;
    voiceToggle.classList.toggle("on", voiceOn);
    if (!voiceOn) {
      setOrbTalking(false);
      if (hopeVoice) hopeVoice.pause();
    }
  });
}
const micBtn = document.querySelector(".search svg") && document.querySelector(".search svg").closest("span,button,div");
function setMicLook(on) {
  const wrap = document.querySelector(".search");
  if (wrap) wrap.classList.toggle("listening", on);
}
function startMic(commandMode) {
  const Ctor = SpeechEngine();
  if (!Ctor) return;
  stopMic();
  rec = new Ctor();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = ev => {
    let said = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      said += ev.results[i][0].transcript;
    }
    input.value = said;
    if (ev.results[ev.results.length - 1].isFinal) {
      const cleaned = commandMode ? stripWake(said) : said.trim();
      stopMic();
      if (cleaned) sendUserText(cleaned);
    }
  };
  rec.onend = () => { micOn = false; setMicLook(false); };
  rec.onerror = () => { micOn = false; setMicLook(false); };
  rec.start();
  micOn = true;
  setMicLook(true);
}
function stopMic() {
  try { if (rec) rec.stop(); } catch (e) {}
  rec = null;
  micOn = false;
  setMicLook(false);
}
if (micBtn) {
  micBtn.style.cursor = "pointer";
  micBtn.addEventListener("click", e => {
    e.preventDefault();
    if (micOn) stopMic();
    else startMic(false);
  });
}
function startWake() {
  const Ctor = SpeechEngine();
  if (!Ctor || wakeRec) return;
  wakeRec = new Ctor();
  wakeRec.lang = "en-US";
  wakeRec.interimResults = false;
  wakeRec.continuous = true;
  wakeRec.onresult = ev => {
    const said = ev.results[ev.results.length - 1][0].transcript || "";
    if (!/\b(hey\s+)?hope\b/i.test(said)) return;
    const rest = stripWake(said);
    if (rest) sendUserText(rest);
    else startMic(true);
  };
  wakeRec.onend = () => {
    wakeRec = null;
    setTimeout(startWake, 400);
  };
  try { wakeRec.start(); } catch (e) {}
}
document.addEventListener("click", function once() {
  startWake();
  document.removeEventListener("click", once);
}, { once: true });

const VIEW_ORDER = ["home", "chat", "music", "maps", "weather"];
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
