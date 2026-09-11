let musicPlaying = false;
let scWidget = null;
let currentSong = { title: "Nothing playing", artist: "Search a song", art: "", url: "" };

const mhPlay = document.getElementById("mhPlay");
const scFrame = document.getElementById("scPlayer");
const mhSearchForm = document.getElementById("mhSearchForm");
const mhSearch = document.getElementById("mhSearch");

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
  if (typeof setTxt === "function") {
    setTxt("mhTitle", currentSong.title);
    setTxt("mhArtist", currentSong.artist);
    setTxt("mhTitleMini", currentSong.title);
    setTxt("mhArtistMini", currentSong.artist);
    setTxt("mhDockTitle", currentSong.title);
    setTxt("mhDockArtist", currentSong.artist);
  }
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
  if (typeof thread !== "undefined" && thread) {
    thread.appendChild(line);
    thread.scrollTop = thread.scrollHeight;
  }
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
