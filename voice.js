let voiceOn = true;
let hopeVoice = null;
let micOn = false;
let rec = null;
let wakeRec = null;

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

function cleanSpeakText(text) {
  let spoken = String(text || "");
  if (typeof parseSources === "function") {
    try {
      const parsed = parseSources(spoken);
      spoken = (parsed && parsed.body) || spoken;
    } catch (e) {}
  }
  if (typeof stripMd === "function") {
    try {
      spoken = stripMd(spoken);
    } catch (e) {}
  }
  spoken = spoken.replace(/\n*Sources:[\s\S]*/i, "").trim();
  return spoken;
}

function speakBrowser(text) {
  if (!window.speechSynthesis || !text) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 280));
    u.lang = "en-US";
    u.rate = 1;
    u.onstart = () => setOrbTalking(true);
    u.onend = () => setOrbTalking(false);
    u.onerror = () => setOrbTalking(false);
    window.speechSynthesis.speak(u);
    return true;
  } catch (e) {
    setOrbTalking(false);
    return false;
  }
}

async function speakHope(text) {
  if (!voiceOn) return;
  const spoken = cleanSpeakText(text);
  if (!spoken) return;
  try {
    if (hopeVoice) {
      hopeVoice.pause();
      hopeVoice.src = "";
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    const res = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: spoken.slice(0, 1200) }),
    });
    if (!res.ok) {
      console.warn("[hope voice] /api/speak", res.status);
      speakBrowser(spoken);
      return;
    }
    const blob = await res.blob();
    if (!blob || blob.size < 100) {
      console.warn("[hope voice] empty audio");
      speakBrowser(spoken);
      return;
    }
    const url = URL.createObjectURL(blob);
    hopeVoice = new Audio(url);
    hopeVoice.onended = () => {
      setOrbTalking(false);
      URL.revokeObjectURL(url);
    };
    hopeVoice.onerror = () => {
      setOrbTalking(false);
      URL.revokeObjectURL(url);
      speakBrowser(spoken);
    };
    setOrbTalking(true);
    await hopeVoice.play();
  } catch (err) {
    console.warn("[hope voice]", err);
    setOrbTalking(false);
    speakBrowser(spoken);
  }
}
window.speakHope = speakHope;

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
    if (typeof input !== "undefined" && input) input.value = said;
    if (ev.results[ev.results.length - 1].isFinal) {
      const cleaned = commandMode ? stripWake(said) : said.trim();
      stopMic();
      if (cleaned && typeof sendUserText === "function") sendUserText(cleaned);
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

function bindVoiceUi() {
  const voiceToggle = document.querySelector(".toggle");
  if (voiceToggle) {
    voiceToggle.classList.add("on");
    voiceOn = true;
    voiceToggle.addEventListener("click", () => {
      voiceOn = !voiceOn;
      voiceToggle.classList.toggle("on", voiceOn);
      if (!voiceOn) {
        setOrbTalking(false);
        if (hopeVoice) hopeVoice.pause();
        if (window.speechSynthesis) window.speechSynthesis.cancel();
      }
    });
  }
  const micBtn = document.getElementById("micBtn") || document.querySelector(".search .mic");
  if (micBtn) {
    micBtn.style.cursor = "pointer";
    micBtn.addEventListener("click", e => {
      e.preventDefault();
      if (micOn) stopMic();
      else startMic(false);
    });
  }
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
    if (rest && typeof sendUserText === "function") sendUserText(rest);
    else startMic(true);
  };
  wakeRec.onend = () => {
    wakeRec = null;
    setTimeout(startWake, 400);
  };
  try { wakeRec.start(); } catch (e) {}
}

bindVoiceUi();
document.addEventListener("click", function once() {
  startWake();
  document.removeEventListener("click", once);
}, { once: true });
