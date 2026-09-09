const MAPS_KEY = "AIzaSyDjEARsMXNH-tom8NqxWsojEkQC2Lz7fkU";
const DEFAULT_DEST_ART = "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=400&q=60";

let origin = { lat: 26.1224, lng: -80.1373 };
let destPlace = null;
let map3d = true;
let nearbyMarkers = [];
let gmap = null;
let gmarker = null;
let gdir = null;
let grender = null;
let gtraffic = null;
let homeMap = null;
let homeMarker = null;

const DARK_MAP = [
  { elementType: "geometry", stylers: [{ color: "#0b1220" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b1220" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8aa0bf" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1a2a44" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0a1424" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#7e96b6" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#243656" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#061018" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4a6588" }] }
];

function setTxt(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function stripTags(s) {
  const d = document.createElement("div");
  d.innerHTML = s || "";
  return d.textContent || "";
}

function mapOptions() {
  return {
    center: origin,
    zoom: 14,
    tilt: 45,
    heading: 20,
    mapTypeId: "roadmap",
    disableDefaultUI: true,
    styles: DARK_MAP,
    gestureHandling: "greedy"
  };
}

function applyOrigin() {
  if (homeMap) homeMap.setCenter(origin);
  if (homeMarker) homeMarker.setPosition(origin);
  if (gmap) gmap.setCenter(origin);
  if (gmarker) gmarker.setPosition(origin);
}

function resizeHomeMap() {
  if (!homeMap || typeof google === "undefined") return;
  google.maps.event.trigger(homeMap, "resize");
  homeMap.setCenter(origin);
}

function initHomeMap() {
  const el = document.getElementById("homeMap");
  if (!el || homeMap || typeof google === "undefined" || !google.maps) return;
  homeMap = new google.maps.Map(el, mapOptions());
  homeMarker = new google.maps.Marker({ map: homeMap, position: origin, title: "You" });
  setTimeout(resizeHomeMap, 80);
}

function trackLocation() {
  const after = () => {
    if (typeof loadWeather === "function") {
      loadWeather(origin.lat, origin.lng, (typeof weatherPlace !== "undefined" && weatherPlace.name) || "My location");
    }
  };
  if (!navigator.geolocation) { after(); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    origin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    applyOrigin();
    if (typeof reverseWeatherName === "function") reverseWeatherName(origin.lat, origin.lng);
    after();
    resizeHomeMap();
  }, after);
}

function clearNearby() {
  nearbyMarkers.forEach(m => m.setMap(null));
  nearbyMarkers = [];
}

function setDestPhoto(place) {
  const img = document.getElementById("mpDestArt");
  if (!img || !place) return;
  if (place.photos && place.photos[0] && place.photos[0].getUrl) {
    img.src = place.photos[0].getUrl({ maxWidth: 400 });
    return;
  }
  const loc = place.geometry && place.geometry.location;
  if (!loc) return;
  const lat = typeof loc.lat === "function" ? loc.lat() : loc.lat;
  const lng = typeof loc.lng === "function" ? loc.lng() : loc.lng;
  img.src = "https://maps.googleapis.com/maps/api/streetview?size=400x240&location=" + lat + "," + lng + "&fov=80&key=" + MAPS_KEY;
}

function endNav() {
  destPlace = null;
  if (grender) grender.set("directions", null);
  setTxt("mpDestName", "No destination");
  setTxt("mpDestMeta", "Search to route");
  setTxt("mpDestVia", "Fort Lauderdale");
  setTxt("mpNextText", "Search a place to start a route");
  setTxt("mpNextSub", "Fort Lauderdale");
  setTxt("mpEta", "—");
  setTxt("mpMiles", "—");
  const list = document.getElementById("mpStepList");
  const img = document.getElementById("mpDestArt");
  if (list) list.innerHTML = '<div class="mh-s">No route yet</div>';
  if (img) img.src = DEFAULT_DEST_ART;
  if (gmap) gmap.panTo(origin);
}

function ensureMap() {
  if (gmap || typeof google === "undefined" || !google.maps) return;
  const el = document.getElementById("gmap");
  if (!el) return;
  gmap = new google.maps.Map(el, Object.assign(mapOptions(), { tilt: 67 }));
  gmarker = new google.maps.Marker({ map: gmap, position: origin, title: "You" });
  gdir = new google.maps.DirectionsService();
  grender = new google.maps.DirectionsRenderer({
    map: gmap,
    suppressMarkers: false,
    polylineOptions: { strokeColor: "#7ecbff", strokeWeight: 6, strokeOpacity: 0.95 }
  });
  gtraffic = new google.maps.TrafficLayer();
  const box = document.getElementById("mpSearch");
  if (box && google.maps.places) {
    const ac = new google.maps.places.Autocomplete(box, {
      fields: ["geometry", "name", "formatted_address", "photos"]
    });
    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      if (place && place.geometry) routeTo(place);
    });
  }
}

function routeTo(place) {
  if (!place || !place.geometry) return;
  destPlace = place;
  const loc = place.geometry.location;
  document.getElementById("mpDestName").textContent = place.name || "Destination";
  document.getElementById("mpDestVia").textContent = place.formatted_address || place.vicinity || "";
  setDestPhoto(place);
  if (!gdir) return;
  gdir.route({ origin, destination: loc, travelMode: google.maps.TravelMode.DRIVING }, (res, status) => {
    if (status !== "OK" || !res.routes[0]) {
      document.getElementById("mpNextText").textContent = "No driving route";
      return;
    }
    grender.setDirections(res);
    const leg = res.routes[0].legs[0];
    document.getElementById("mpDestMeta").textContent = leg.duration.text + " · " + leg.distance.text;
    document.getElementById("mpEta").textContent = leg.duration.text;
    document.getElementById("mpMiles").textContent = leg.distance.text;
    document.getElementById("mpNextText").textContent = (leg.steps[0] && stripTags(leg.steps[0].instructions)) || "Start route";
    document.getElementById("mpNextSub").textContent = place.name || "";
    const list = document.getElementById("mpStepList");
    list.innerHTML = "";
    (leg.steps || []).slice(0, 12).forEach(step => {
      const row = document.createElement("div");
      row.className = "mp-step";
      row.innerHTML = "<div>" + stripTags(step.instructions) + "</div><div class='mh-s'>" + step.distance.text + "</div>";
      list.appendChild(row);
    });
  });
}

function goToMapsTab() {
  document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
  const nav = document.querySelector('.nav-item[data-view="maps"]');
  if (nav) nav.classList.add("active");
  if (typeof setView === "function") setView("maps");
  ensureMap();
}

function searchPlaceThenNavigate(query) {
  const q = (query || "").trim();
  goToMapsTab();
  if (!q) return;
  const box = document.getElementById("mpSearch");
  if (box) box.value = q;
  const run = () => {
    if (!gmap || !google.maps.places) { setTimeout(run, 80); return; }
    const svc = new google.maps.places.PlacesService(gmap);
    svc.textSearch({ query: q, location: origin, radius: 20000 }, (results, status) => {
      if (status === "OK" && results[0]) routeTo(results[0]);
    });
  };
  setTimeout(run, 80);
}

function showNearbyCategory(type) {
  goToMapsTab();
  const run = () => {
    if (!gmap || !google.maps.places) { setTimeout(run, 80); return; }
    document.querySelectorAll(".mp-near").forEach(b => b.classList.remove("on"));
    const btn = document.querySelector('.mp-near[data-near="' + type + '"]');
    if (btn) btn.classList.add("on");
    clearNearby();
    const svc = new google.maps.places.PlacesService(gmap);
    svc.nearbySearch({ location: origin, radius: 4000, type: type }, (results, status) => {
      if (status !== "OK" || !results) return;
      results.slice(0, 8).forEach(p => {
        if (!p.geometry) return;
        const marker = new google.maps.Marker({ map: gmap, position: p.geometry.location, title: p.name });
        marker.addListener("click", () => routeTo(p));
        nearbyMarkers.push(marker);
      });
    });
  };
  setTimeout(run, 80);
}

function detectNearMe(text) {
  const q = (text || "").toLowerCase();
  const local = /\bnear me\b|\bnearby\b|\baround me\b|\bclose by\b|\bby me\b/.test(q);
  const ask = local || /\b(show|find|open|pull up|bring up|where|list|got any)\b/.test(q);
  if (!ask) return null;
  if (/restaur|food|eat|dining|hungry/.test(q)) return "restaurant";
  if (/\bgas\b/.test(q)) return "gas_station";
  if (/\bpark(ing)?\b/.test(q)) return "parking";
  if (/\bhotel|lodging\b/.test(q)) return "lodging";
  return null;
}

function insertChatMapsCard() {
  const thread = document.getElementById("thread");
  if (!thread) return;
  const line = document.createElement("div");
  line.className = "line widget";
  const src = document.querySelector("aside.right .card.nearby");
  if (!src) return;
  const clone = src.cloneNode(true);
  const mapEl = clone.querySelector(".citymap");
  if (mapEl) { mapEl.id = "chatMap" + Date.now(); mapEl.innerHTML = ""; }
  const sub = clone.querySelector("#homeMapSub, .sub");
  if (sub) { sub.id = ""; sub.textContent = "Your location"; }
  const formEl = document.createElement("form");
  formEl.className = "mini-map-search";
  formEl.innerHTML = '<input type="text" placeholder="Search a place…" /><button type="submit">Go</button>';
  const box = formEl.querySelector("input");
  formEl.addEventListener("submit", e => { e.preventDefault(); searchPlaceThenNavigate(box.value); });
  clone.appendChild(formEl);
  line.appendChild(clone);
  thread.appendChild(line);
  thread.scrollTop = thread.scrollHeight;
  if (mapEl && typeof google !== "undefined" && google.maps) {
    const m = new google.maps.Map(mapEl, mapOptions());
    new google.maps.Marker({ map: m, position: origin, title: "You" });
  }
}

function bootMaps() {
  initHomeMap();
  trackLocation();
}

const mpForm = document.getElementById("mpSearchForm");
if (mpForm) {
  mpForm.addEventListener("submit", e => {
    e.preventDefault();
    const q = (document.getElementById("mpSearch").value || "").trim();
    if (!q || !gmap || !google.maps.places) return;
    const svc = new google.maps.places.PlacesService(gmap);
    svc.textSearch({ query: q, location: origin, radius: 20000 }, (results, status) => {
      if (status === "OK" && results[0]) routeTo(results[0]);
    });
  });
}
const mp3d = document.getElementById("mp3d");
if (mp3d) mp3d.addEventListener("click", () => { if (gmap) { map3d = !map3d; gmap.setTilt(map3d ? 67 : 0); } });
const mpTraffic = document.getElementById("mpTraffic");
if (mpTraffic) mpTraffic.addEventListener("click", () => {
  if (!gmap || !gtraffic) return;
  const on = !gtraffic.getMap();
  gtraffic.setMap(on ? gmap : null);
  const lbl = document.getElementById("mpTrafficLbl");
  if (lbl) lbl.textContent = on ? "On" : "Off";
});
const mpRecenter = document.getElementById("mpRecenter");
if (mpRecenter) mpRecenter.addEventListener("click", () => { if (gmap) gmap.panTo(origin); });
const mpStart = document.getElementById("mpStart");
if (mpStart) mpStart.addEventListener("click", () => {
  if (!destPlace) return;
  gmap.panTo(destPlace.geometry.location);
  gmap.setTilt(67);
});
const mpEnd = document.getElementById("mpEnd");
if (mpEnd) mpEnd.addEventListener("click", endNav);
document.querySelectorAll(".mp-near").forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.classList.contains("on")) { btn.classList.remove("on"); clearNearby(); return; }
    showNearbyCategory(btn.getAttribute("data-near"));
  });
});

if (document.readyState === "complete") bootMaps();
else window.addEventListener("load", bootMaps);