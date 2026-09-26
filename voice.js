let voiceOn = true;
let hopeVoice = null;
let micOn = false;
let rec = null;
let wakeRec = null;
let listenHold = null;
let sessionOn = false;

const STOP_RE = /\b(stop talking|go away|stop listening|that's enough|thats enough|be quiet|never ?mind)\b/i;

function SpeechEngine() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function setOrbTalking(on) {
  const orb = document.querySelector(".orb-wrap");
  if (orb) orb.classList.toggle("speaking", !!on);
}

function setListening(on) {
  const orb = document.querySelector(".orb-wrap");
  const wrap = document.querySelector(".search");
  if (orb) orb.classList.toggle("listening", !!on);
  if (wrap) wrap.classList.toggle("listening", !!on);
  document.body.classList.toggle("hope-listening", !!on);
  if (listenHold) {
    clearTimeout(listenHold);
    listenHold = null;
  }
}

function stripWake(text) {
  return (text || "")
    .replace(/^\s*(hey\s+)?hope[,.\s]*/i, "")
    .trim();
}

function stopSpeech() {
  try {
    if (hopeVoice) {
      hopeVoice.pause();
      hopeVoice.src = "";
    }
  } catch (e) {}
  setOrbTalking(false);
}

function endSession() {
  sessionOn = false;
  stopSpeech();
  stopMic();
  setListening(false);
  startWake();
}

function isStopCmd(text) {
  return STOP_RE.test(text || "");
}

async function speakHope(text) {
  if (!voiceOn || !text) return;
  try {
    stopSpeech();
    let spoken = String(text);
    try {
      if (typeof parseSources === "function") spoken = parseSources(spoken).body || spoken;
      if (typeof stripMd === "function") spoken = stripMd(spoken);
    } catch (e) {}
    spoken = String(spoken || text).replace(/\n*Sources:[\s\S]*/i, "").trim();
    if (!spoken) return;
    const res = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: spoken.slice(0, 1200) })
    });
    if (!res.ok) return;
    const blob = await res.blob();
    hopeVoice = new Audio(URL.createObjectURL(blob));
    setOrbTalking(true);
    hopeVoice.onended = function () {
      setOrbTalking(false);
      if (sessionOn) startSessionMic();
    };
    hopeVoice.onerror = function () {
      setOrbTalking(false);
      if (sessionOn) startSessionMic();
    };
    await hopeVoice.play();
  } catch (err) {
    setOrbTalking(false);
    if (sessionOn) startSessionMic();
  }
}
window.speakHope = speakHope;

function handleHeard(raw) {
  const said = (raw || "").trim();
  if (!said) {
    if (sessionOn) startSessionMic();
    return;
  }
  if (isStopCmd(said)) {
    endSession();
    return;
  }
  const cleaned = stripWake(said);
  if (!cleaned) {
    if (sessionOn) startSessionMic();
    return;
  }
  if (typeof input !== "undefined" && input) input.value = cleaned;
  if (typeof sendUserText === "function") sendUserText(cleaned);
}

function startSessionMic() {
  const Ctor = SpeechEngine();
  if (!Ctor || !sessionOn) return;
  stopMic(true);
  rec = new Ctor();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = true;
  rec.onresult = function (ev) {
    let said = "";
    let final = false;
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      said += ev.results[i][0].transcript;
      if (ev.results[i].isFinal) final = true;
    }
    if (typeof input !== "undefined" && input) input.value = said;
    if (isStopCmd(said)) {
      endSession();
      return;
    }
    if (final) handleHeard(said);
  };
  rec.onend = function () {
    micOn = false;
    if (sessionOn && (!hopeVoice || hopeVoice.paused)) {
      setTimeout(startSessionMic, 250);
    }
  };
  rec.onerror = function () {
    micOn = false;
    if (sessionOn) setTimeout(startSessionMic, 400);
  };
  try {
    rec.start();
    micOn = true;
    setListening(true);
  } catch (e) {
    setTimeout(startSessionMic, 400);
  }
}

function beginSession(firstCmd) {
  sessionOn = true;
  stopWake();
  setListening(true);
  if (firstCmd) handleHeard(firstCmd);
  else startSessionMic();
}

function startMic(commandMode) {
  beginSession("");
}

function stopMic(keepLook) {
  try { if (rec) rec.stop(); } catch (e) {}
  rec = null;
  micOn = false;
  if (!keepLook) setListening(false);
}

function stopWake() {
  try { if (wakeRec) wakeRec.stop(); } catch (e) {}
  wakeRec = null;
}

function bindVoiceUi() {
  const voiceToggle = document.querySelector(".toggle");
  if (voiceToggle) {
    voiceToggle.classList.add("on");
    voiceToggle.addEventListener("click", function () {
      voiceOn = !voiceOn;
      voiceToggle.classList.toggle("on", voiceOn);
      if (!voiceOn) endSession();
    });
  }
  const micBtn = document.getElementById("micBtn") || document.querySelector(".search .mic");
  if (micBtn) {
    micBtn.style.cursor = "pointer";
    micBtn.addEventListener("click", function (e) {
      e.preventDefault();
      if (sessionOn || micOn) endSession();
      else beginSession("");
    });
  }
}

function startWake() {
  const Ctor = SpeechEngine();
  if (!Ctor || wakeRec || sessionOn) return;
  wakeRec = new Ctor();
  wakeRec.lang = "en-US";
  wakeRec.interimResults = false;
  wakeRec.continuous = true;
  wakeRec.onresult = function (ev) {
    const said = ev.results[ev.results.length - 1][0].transcript || "";
    if (!/\b(hey\s+)?hope\b/i.test(said)) return;
    const rest = stripWake(said);
    beginSession(rest);
  };
  wakeRec.onend = function () {
    wakeRec = null;
    if (!sessionOn) setTimeout(startWake, 400);
  };
  try { wakeRec.start(); } catch (e) {}
}

bindVoiceUi();
document.addEventListener("click", function once() {
  startWake();
  document.removeEventListener("click", once);
}, { once: true });
