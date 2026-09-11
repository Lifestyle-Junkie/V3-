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

async function speakHope(text) {
  if (!voiceOn || !text) return;
  try {
    if (hopeVoice) {
      hopeVoice.pause();
      hopeVoice.src = "";
    }
    const spoken = typeof stripMd === "function"
      ? stripMd(parseSources(text).body)
      : String(text);
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
    voiceToggle.addEventListener("click", () => {
      voiceOn = !voiceOn;
      voiceToggle.classList.toggle("on", voiceOn);
      if (!voiceOn) {
        setOrbTalking(false);
        if (hopeVoice) hopeVoice.pause();
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
