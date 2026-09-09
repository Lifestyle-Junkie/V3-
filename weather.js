let weatherPlace = { lat: 26.1224, lng: -80.1373, name: "Fort Lauderdale, FL" };
let wxControlsBound = false;

function shortWind(raw) {
  return String(raw || "")
    .replace(/_/g, " ")
    .replace(/\bNORTH\b/g, "N")
    .replace(/\bSOUTH\b/g, "S")
    .replace(/\bEAST\b/g, "E")
    .replace(/\bWEST\b/g, "W")
    .replace(/\s+/g, "");
}

function deg(obj) {
  if (obj == null) return null;
  if (typeof obj === "number") return obj;
  return obj.degrees != null ? obj.degrees : obj.value;
}

function wxIcon(cond) {
  const t = (cond || "").toLowerCase();
  if (t.includes("thunder")) return "⛈";
  if (t.includes("rain") || t.includes("shower")) return "🌧";
  if (t.includes("cloud") && t.includes("part")) return "⛅";
  if (t.includes("cloud") || t.includes("overcast")) return "☁";
  if (t.includes("clear") || t.includes("sunny")) return "☀";
  if (t.includes("night") || t.includes("moon")) return "☾";
  return "☀";
}

function moonLabel(date) {
  const syn = 29.53058867;
  const known = Date.UTC(2000, 0, 6, 18, 14);
  const days = (date.getTime() - known) / 86400000;
  const age = ((days % syn) + syn) % syn;
  const illum = Math.round((1 - Math.cos((age / syn) * Math.PI * 2)) * 50);
  let name = "New Moon";
  if (age > 1.8 && age <= 7.4) name = "Waxing Crescent";
  else if (age <= 9.2) name = "First Quarter";
  else if (age <= 14.8) name = "Waxing Gibbous";
  else if (age <= 16.6) name = "Full Moon";
  else if (age <= 22.1) name = "Waning Gibbous";
  else if (age <= 24) name = "Last Quarter";
  else if (age <= 29.5) name = "Waning Crescent";
  return name + " · " + illum + "%";
}

function fmtHour(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  let h = d.getHours();
  const am = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return h + " " + am;
}

function fmtClock(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  let h = d.getHours();
  const am = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return h + ":" + String(d.getMinutes()).padStart(2, "0") + " " + am;
}

async function wxGet(path, extra) {
  const u = new URL("https://weather.googleapis.com/v1/" + path);
  u.searchParams.set("key", MAPS_KEY);
  u.searchParams.set("location.latitude", String(weatherPlace.lat));
  u.searchParams.set("location.longitude", String(weatherPlace.lng));
  u.searchParams.set("unitsSystem", "IMPERIAL");
  Object.keys(extra || {}).forEach(k => u.searchParams.set(k, extra[k]));
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error("weather " + res.status);
  return res.json();
}

function reverseWeatherName(lat, lng) {
  if (typeof google === "undefined" || !google.maps || !google.maps.Geocoder) return;
  const geo = new google.maps.Geocoder();
  geo.geocode({ location: { lat, lng } }, (results, status) => {
    if (status !== "OK" || !results || !results[0]) return;
    const bits = results[0].address_components || [];
    const city = (bits.find(c => c.types.includes("locality")) || {}).long_name;
    const st = (bits.find(c => c.types.includes("administrative_area_level_1")) || {}).short_name;
    weatherPlace.name = [city, st].filter(Boolean).join(", ") || results[0].formatted_address;
    setTxt("wxPlace", weatherPlace.name);
    setTxt("homeWxCity", weatherPlace.name);
  });
}

async function loadAqi(lat, lng) {
  try {
    const res = await fetch("https://airquality.googleapis.com/v1/currentConditions:lookup?key=" + MAPS_KEY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: { latitude: lat, longitude: lng } })
    });
    if (!res.ok) throw new Error("aqi");
    const data = await res.json();
    const idx = (data.indexes && data.indexes[0]) || {};
    const aqi = idx.aqi != null ? idx.aqi : "—";
    const cat = idx.category || "Air quality";
    setTxt("wxAqi", cat + (typeof aqi === "number" ? " (" + aqi + ")" : ""));
    setTxt("wxAqiNote", idx.dominantPollutant ? "Main pollutant: " + idx.dominantPollutant : cat);
    const fill = document.getElementById("wxAqiFill");
    if (fill && typeof aqi === "number") fill.style.left = Math.min(100, aqi) + "%";
  } catch (e) {
    setTxt("wxAqi", "—");
    setTxt("wxAqiNote", "Enable Air Quality API for live AQI.");
  }
}

function bindWeatherControls() {
  if (wxControlsBound) return;
  const wxForm = document.getElementById("wxSearchForm");
  const wxBox = document.getElementById("wxSearch");
  if (!wxForm || !wxBox) return;
  wxControlsBound = true;
  if (typeof google !== "undefined" && google.maps && google.maps.places) {
    const ac = new google.maps.places.Autocomplete(wxBox, {
      types: ["(cities)"],
      fields: ["geometry", "name", "formatted_address"]
    });
    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      if (!place || !place.geometry) return;
      const loc = place.geometry.location;
      loadWeather(loc.lat(), loc.lng(), place.formatted_address || place.name);
    });
  }
  wxForm.addEventListener("submit", e => {
    e.preventDefault();
    const q = (wxBox.value || "").trim();
    if (!q || typeof google === "undefined" || !google.maps.places) return;
    const dummy = document.createElement("div");
    const svc = new google.maps.places.PlacesService(gmap || dummy);
    svc.textSearch({ query: q }, (results, status) => {
      if (status === "OK" && results[0] && results[0].geometry) {
        const loc = results[0].geometry.location;
        loadWeather(loc.lat(), loc.lng(), results[0].formatted_address || results[0].name);
      }
    });
  });
  const wxGps = document.getElementById("wxUseGps");
  if (wxGps) wxGps.addEventListener("click", () => {
    weatherPlace = { lat: origin.lat, lng: origin.lng, name: "My location" };
    reverseWeatherName(origin.lat, origin.lng);
    loadWeather(origin.lat, origin.lng, weatherPlace.name);
  });
  document.querySelectorAll("[data-wx-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-wx-tab]").forEach(b => b.classList.remove("on"));
      btn.classList.add("on");
      const hours = document.getElementById("wxHours");
      const days = document.getElementById("wxDays");
      if (hours) { hours.hidden = false; hours.removeAttribute("hidden"); }
      if (days) { days.hidden = false; days.removeAttribute("hidden"); }
      const panel = document.getElementById(btn.getAttribute("data-wx-tab") === "daily" ? "wxDays" : "wxHours");
      if (panel && panel.parentElement) {
        panel.parentElement.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      }
    });
  });
}

function ensureWeatherHud() {
  const layout = document.getElementById("layout");
  let el = document.getElementById("weatherHud");
  if (!el) {
    el = document.createElement("section");
    el.className = "weather-hud";
    el.id = "weatherHud";
    el.innerHTML =
      '<div class="wx-main">' +
        '<div class="wx-top">' +
          '<div class="wx-brand"><div class="wx-sunmini"></div><div><div class="mh-t">WEATHER</div><div class="mh-s">Stay ahead of the day.</div></div></div>' +
          '<form class="wx-search" id="wxSearchForm" autocomplete="off"><input id="wxSearch" type="text" placeholder="Search a city..." /><button type="submit">Go</button></form>' +
        "</div>" +
        '<div class="wx-hero">' +
          '<div class="wx-now"><div class="mh-s">Right Now</div><div class="wx-temp" id="wxTemp">—°</div><div class="wx-cond" id="wxCond">Loading…</div><div class="mh-s" id="wxFeels">Feels like —°</div></div>' +
          '<div class="wx-locrow"><span id="wxPlace">Fort Lauderdale, FL</span><button type="button" class="wx-change" id="wxUseGps">My location</button></div>' +
          '<div class="wx-stats"><div><span>Humidity</span><b id="wxHum">—</b></div><div><span>Wind</span><b id="wxWind">—</b></div><div><span>UV Index</span><b id="wxUv">—</b></div><div><span>Visibility</span><b id="wxVis">—</b></div><div><span>Pressure</span><b id="wxPres">—</b></div></div>' +
          '<div class="wx-quote" id="wxQuote">Checking conditions…</div>' +
        "</div>" +
        '<div class="wx-panel"><div class="wx-tabs"><button type="button" class="on" data-wx-tab="hourly">Hourly</button><button type="button" data-wx-tab="daily">7 Day</button></div><div class="wx-hours" id="wxHours"></div></div>' +
        '<div class="wx-panel"><div class="mh-k">7 DAY FORECAST</div><div class="wx-days" id="wxDays"></div></div>' +
      "</div>" +
      '<aside class="wx-rail">' +
        '<div class="wx-card"><div class="mh-k">TODAY</div><div class="wx-today-temp" id="wxTodayTemp">—°</div><div class="wx-cond" id="wxTodayCond">—</div><div class="mh-s" id="wxHiLo">H: —  L: —</div><div class="mh-s" id="wxPrecip">Rain —</div></div>' +
        '<div class="wx-card"><div class="mh-k">SUN &amp; MOON</div><div class="wx-sunrow"><div><span class="mh-s">Sunrise</span><b id="wxRise">—</b></div><div><span class="mh-s">Sunset</span><b id="wxSet">—</b></div></div><div class="mh-s" id="wxMoon">—</div></div>' +
        '<div class="wx-card"><div class="mh-k">AIR QUALITY</div><div id="wxAqi">—</div><div class="wx-aqi-bar"><i id="wxAqiFill"></i></div><div class="mh-s" id="wxAqiNote">Live AQI if Air Quality API is on.</div></div>' +
        '<div class="wx-card"><div class="mh-k">UV INDEX</div><div id="wxUvBig">—</div><div class="wx-uv-bar"><i id="wxUvFill"></i></div><div class="mh-s" id="wxUvNote">—</div></div>' +
      "</aside>";
    (layout || document.body).appendChild(el);
  } else {
    const hours = el.querySelector("#wxHours");
    const days = el.querySelector("#wxDays");
    if (days) {
      days.hidden = false;
      days.removeAttribute("hidden");
    }
    if (hours && days && days.parentElement === hours.parentElement) {
      const panel = document.createElement("div");
      panel.className = "wx-panel";
      panel.innerHTML = '<div class="mh-k">7 DAY FORECAST</div>';
      hours.parentElement.after(panel);
      panel.appendChild(days);
    }
  }
  bindWeatherControls();
  return el;
}

async function loadWeather(lat, lng, name) {
  weatherPlace = { lat: lat, lng: lng, name: name || weatherPlace.name };
  setTxt("wxPlace", weatherPlace.name);
  try {
    const [now, hours, days] = await Promise.all([
      wxGet("currentConditions:lookup"),
      wxGet("forecast/hours:lookup", { hours: "24" }),
      wxGet("forecast/days:lookup", { days: "7" })
    ]);
    const temp = Math.round(deg(now.temperature) || 0);
    const feels = Math.round(deg(now.feelsLikeTemperature) || temp);
    const cond = (now.weatherCondition && now.weatherCondition.description && now.weatherCondition.description.text) || "—";
    const hist = now.currentConditionsHistory || {};
    const hi = Math.round(deg(hist.maxTemperature) || temp);
    const lo = Math.round(deg(hist.minTemperature) || temp);
    const hum = now.relativeHumidity != null ? now.relativeHumidity + "%" : "—";
    const rawDir = (now.wind && now.wind.direction && (now.wind.direction.cardinal || now.wind.direction.degrees)) || "";
    const windDir = shortWind(rawDir);
    const windSpd = now.wind && now.wind.speed ? Math.round(now.wind.speed.value || now.wind.speed.kph || 0) : null;
    const uv = now.uvIndex != null ? now.uvIndex : "—";
    const vis = now.visibility && now.visibility.distance != null ? Math.round(now.visibility.distance) + " mi" : "—";
    const pres = now.airPressure && now.airPressure.meanSeaLevelMillibars
      ? (now.airPressure.meanSeaLevelMillibars / 33.8639).toFixed(2) + " in"
      : "—";
    const rainNow = now.precipitation && now.precipitation.probability
      ? (now.precipitation.probability.percent || 0)
      : 0;

    setTxt("wxTemp", temp + "°");
    setTxt("wxCond", cond);
    setTxt("wxFeels", "Feels like " + feels + "°");
    setTxt("wxHum", hum);
    setTxt("wxWind", (windDir ? windDir + " " : "") + (windSpd != null ? windSpd + " mph" : "—"));
    setTxt("wxUv", String(uv));
    setTxt("wxVis", vis);
    setTxt("wxPres", pres);
    setTxt("wxQuote", "It's " + cond.toLowerCase() + " in " + weatherPlace.name + ".");
    setTxt("wxTodayTemp", temp + "°");
    setTxt("wxTodayCond", cond);
    setTxt("wxHiLo", "H: " + hi + "°  L: " + lo + "°");
    setTxt("wxPrecip", "Rain " + rainNow + "%");
    setTxt("wxUvBig", uv + (typeof uv === "number" && uv >= 8 ? " — Very High" : typeof uv === "number" && uv >= 6 ? " — High" : ""));
    setTxt("wxUvNote", typeof uv === "number" && uv >= 6 ? "Extra protection recommended." : "UV looks manageable.");
    const uvFill = document.getElementById("wxUvFill");
    if (uvFill && typeof uv === "number") uvFill.style.left = Math.min(100, uv * 9) + "%";
    setTxt("hdrTemp", wxIcon(cond) + " " + temp + "°");
    setTxt("homeWxTemp", temp + "°");
    setTxt("homeWxCond", cond);
    setTxt("homeWxCity", weatherPlace.name);
    const hl = document.getElementById("homeWxHl");
    if (hl) hl.innerHTML = "H: " + hi + "°<br/>L: " + lo + "°";

    const hourList = hours.forecastHours || hours.hours || [];
    const hx = document.getElementById("wxHours");
    const homeH = document.getElementById("homeWxHours");
    if (hx) {
      hx.innerHTML = "";
      hourList.slice(0, 24).forEach((h, i) => {
        const t = Math.round(deg(h.temperature) || 0);
        const c = (h.weatherCondition && h.weatherCondition.description && h.weatherCondition.description.text) || "";
        const p = h.precipitation && h.precipitation.probability ? (h.precipitation.probability.percent || 0) : 0;
        const when = h.interval && h.interval.startTime ? fmtHour(h.interval.startTime) : (i === 0 ? "Now" : "");
        const cell = document.createElement("div");
        cell.className = "wx-h";
        cell.innerHTML = "<div class='t'>" + (when || (i === 0 ? "Now" : "")) + "</div><div>" + wxIcon(c) + "</div><div class='d'>" + t + "°</div><div class='p'>💧 " + p + "%</div>";
        hx.appendChild(cell);
      });
    }
    if (homeH) {
      homeH.innerHTML = "";
      hourList.slice(0, 5).forEach((h, i) => {
        const t = Math.round(deg(h.temperature) || 0);
        const c = (h.weatherCondition && h.weatherCondition.description && h.weatherCondition.description.text) || "";
        const when = h.interval && h.interval.startTime ? fmtHour(h.interval.startTime) : (i === 0 ? "Now" : "");
        const cell = document.createElement("div");
        cell.className = "hour";
        cell.innerHTML = "<div class='t'>" + when + "</div><div class='ico'>" + wxIcon(c) + "</div><div class='d'>" + t + "°</div>";
        homeH.appendChild(cell);
      });
    }

    const dayList = days.forecastDays || days.days || [];
    const dx = document.getElementById("wxDays");
    if (dx) {
      dx.hidden = false;
      dx.removeAttribute("hidden");
      dx.innerHTML = "";
      dayList.slice(0, 7).forEach(day => {
        const max = Math.round(deg(day.maxTemperature) || deg(day.daytimeForecast && day.daytimeForecast.temperature) || 0);
        const min = Math.round(deg(day.minTemperature) || 0);
        const c = (day.daytimeForecast && day.daytimeForecast.weatherCondition && day.daytimeForecast.weatherCondition.description && day.daytimeForecast.weatherCondition.description.text) || "";
        const p = day.daytimeForecast && day.daytimeForecast.precipitation && day.daytimeForecast.precipitation.probability
          ? (day.daytimeForecast.precipitation.probability.percent || 0) : 0;
        const label = day.displayDate
          ? new Date(day.displayDate.year, (day.displayDate.month || 1) - 1, day.displayDate.day || 1).toLocaleDateString("en-US", { weekday: "short" })
          : "";
        const cell = document.createElement("div");
        cell.className = "wx-d";
        cell.innerHTML = "<div class='t'>" + label + "</div><div>" + wxIcon(c) + "</div><div class='d'>" + max + "° / " + min + "°</div><div class='p'>💧 " + p + "%</div>";
        dx.appendChild(cell);
      });
    }
    const today = dayList[0] || {};
    setTxt("wxRise", fmtClock(today.sunEvents && today.sunEvents.sunriseTime));
    setTxt("wxSet", fmtClock(today.sunEvents && today.sunEvents.sunsetTime));
    setTxt("wxMoon", moonLabel(new Date()));
    loadAqi(lat, lng);
  } catch (err) {
    setTxt("wxCond", "Weather API error");
    setTxt("wxQuote", "Check Weather API is enabled on this key and localhost is allowed.");
  }
}

function goToWeatherTab() {
  document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
  const nav = document.querySelector('.nav-item[data-view="weather"]') ||
    Array.from(document.querySelectorAll(".nav-item")).find(n => ((n.querySelector(".t") || {}).textContent || "").toLowerCase().trim() === "weather");
  if (nav) nav.classList.add("active");
  if (typeof setView === "function") setView("weather");
}

function detectWeatherAsk(text) {
  const q = (text || "").toLowerCase();
  return /\bweather|forecast|how hot|how cold|temperature outside|uv index\b/.test(q);
}