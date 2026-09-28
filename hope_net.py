"""Hope network helpers: HTTP, sheet, search, quotes, zip, TTS."""
import base64
import csv
import html
import io
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

CTX = ssl.create_default_context()
SHEET_ID = os.environ.get("HOPE_SHEET_ID", "1eVbAcpz_rGbZ0hXdA3Bleibzj_RfvFB3zkyhT6bgOpk").strip()
SHEET_TABS = [
    "Bank Connections", "Accounts", "Balance History", "Categories",
    "Transactions", "Securities", "Holdings", "Investment Transactions",
]
API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
MODEL = "claude-sonnet-5"
API_URL = "https://api.anthropic.com/v1/messages"
ELEVEN_KEY = os.environ.get("ELEVENLABS_API_KEY", "").strip()
ELEVEN_VOICE = os.environ.get("ELEVENLABS_VOICE_ID", "DAQ2lZdypaQsApLOpVPq").strip()
_SC_CLIENT = {"id": "", "t": 0}
TEXT_ZIP_EXTS = (".txt", ".csv", ".json", ".md", ".log", ".html", ".htm", ".xml")

def http_get(url, timeout=20, data=None, headers=None):
    h = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) HopeV3/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as resp:
        raw = resp.read()
        ctype = resp.headers.get("Content-Type", "")
        final = resp.geturl()
    enc = "utf-8"
    m = re.search(r"charset=([\w-]+)", ctype, re.I)
    if m:
        enc = m.group(1)
    try:
        text = raw.decode(enc, errors="replace")
    except LookupError:
        text = raw.decode("utf-8", errors="replace")
    return final, text

def strip_tags(text):
    text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", text)
    text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
    text = re.sub(r"(?is)<noscript[^>]*>.*?</noscript>", " ", text)
    text = re.sub(r"(?is)<!--.*?-->", " ", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

def parse_csv_text(csv_text):
    rows = []
    reader = csv.reader(io.StringIO(csv_text))
    for row in reader:
        rows.append([c.strip() for c in row])
    if not rows:
        return [], []
    headers = rows[0]
    out = []
    for raw in rows[1:]:
        if not any(raw):
            continue
        item = {}
        for i, h in enumerate(headers):
            key = h or ("col_%d" % i)
            item[key] = raw[i] if i < len(raw) else ""
        out.append(item)
    return headers, out

def resolve_tab(name):
    raw = (name or "").strip()
    if not raw:
        return None
    for tab in SHEET_TABS:
        if tab.lower() == raw.lower():
            return tab
    return None

def fetch_sheet_tab(tab):
    tab = resolve_tab(tab)
    if not tab:
        return None, "Unknown tab. Allowed: " + ", ".join(SHEET_TABS)
    url = (
        "https://docs.google.com/spreadsheets/d/"
        + SHEET_ID
        + "/gviz/tq?tqx=out:csv&sheet="
        + urllib.parse.quote(tab)
        + "&_="
        + str(int(time.time()))
    )
    try:
        _, text = http_get(url, timeout=20, headers={"Accept": "text/csv,*/*"})
    except Exception as e:
        return None, "Sheet fetch failed: %s" % e
    if text.lstrip().startswith("<"):
        return None, "Sheet not shared as Anyone with the link (Viewer)."
    headers, rows = parse_csv_text(text)
    return {"tab": tab, "headers": headers, "rows": rows, "count": len(rows)}, None

def filter_sheet_rows(rows, query, limit):
    q = (query or "").strip().lower()
    out = rows
    if q:
        filtered = []
        for row in rows:
            blob = " ".join(str(v) for v in row.values()).lower()
            if q in blob:
                filtered.append(row)
        out = filtered
    try:
        limit = int(limit)
    except Exception:
        limit = 80
    limit = max(1, min(limit, 250))
    return out[:limit]

def read_sheet(tab, query="", limit=80):
    data, err = fetch_sheet_tab(tab)
    if err:
        return err
    rows = filter_sheet_rows(data["rows"], query, limit)
    return json.dumps({
        "tab": data["tab"],
        "headers": data["headers"],
        "count_total": data["count"],
        "count_returned": len(rows),
        "query": query or "",
        "rows": rows,
    }, ensure_ascii=False)

def web_search(query):
    q = (query or "").strip()
    if not q:
        return "Empty query."
    body = urllib.parse.urlencode({"q": q}).encode("utf-8")
    try:
        _, page = http_get(
            "https://html.duckduckgo.com/html/",
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    except Exception as e:
        return "Search failed: %s" % e
    hits = []
    for m in re.finditer(
        r'<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
        page, re.I | re.S,
    ):
        url = html.unescape(m.group(1))
        title = strip_tags(m.group(2))
        if "uddg=" in url:
            parsed = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
            url = parsed.get("uddg", [url])[0]
        if url.startswith("//"):
            url = "https:" + url
        if title and url.startswith("http"):
            hits.append((title[:180], url))
        if len(hits) >= 8:
            break
    if not hits:
        return "No search hits for: %s" % q
    lines = ["Search results for %s:" % q]
    for i, (title, url) in enumerate(hits, 1):
        lines.append("%d. %s\n   %s" % (i, title, url))
    return "\n".join(lines)

def web_fetch(url, prompt=""):
    url = (url or "").strip()
    if not url.startswith("http"):
        return "Invalid URL."
    try:
        final, page = http_get(url, timeout=25)
    except Exception as e:
        return "Fetch failed for %s: %s" % (url, e)
    text = strip_tags(page)[:12000]
    note = "Focus: %s\n" % prompt if prompt else ""
    return "%sURL: %s\n\n%s" % (note, final, text or "(no text)")

def sc_client_id():
    if _SC_CLIENT["id"] and time.time() - _SC_CLIENT["t"] < 3600:
        return _SC_CLIENT["id"]
    try:
        _, home = http_get("https://soundcloud.com")
        scripts = re.findall(r'src="(https://a-v2\.sndcdn\.com/assets/[^"]+\.js)"', home)
        for src in scripts[-8:]:
            try:
                _, js = http_get(src, timeout=12)
            except Exception:
                continue
            m = re.search(r'client_id["\']?\s*[:=]\s*["\']([A-Za-z0-9]{32})["\']', js)
            if m:
                _SC_CLIENT["id"] = m.group(1)
                _SC_CLIENT["t"] = time.time()
                return _SC_CLIENT["id"]
    except Exception:
        pass
    return _SC_CLIENT["id"]

def nicer_art(url):
    if not url:
        return ""
    return url.replace("-large", "-t500x500").replace("-badge", "-t500x500").replace("-small", "-t500x500").replace("-tiny", "-t500x500")

def sc_oembed(url, fallback_title):
    title, artist, art = fallback_title, "", ""
    try:
        _, raw = http_get("https://soundcloud.com/oembed?format=json&url=" + urllib.parse.quote(url, safe=""))
        meta = json.loads(raw)
        title = meta.get("title") or fallback_title
        art = nicer_art(meta.get("thumbnail_url") or "")
        author = meta.get("author_name") or ""
        if " - " in title:
            artist, title = title.split(" - ", 1)
        elif author:
            artist = author
    except Exception:
        pass
    return title, artist, art

def sc_search(query):
    q = (query or "").strip()
    if len(q) < 2:
        return {"url": "", "title": "", "artist": "", "art": "", "query": q}
    cid = sc_client_id()
    if cid:
        api = "https://api-v2.soundcloud.com/search/tracks?q=" + urllib.parse.quote(q) + "&limit=8&client_id=" + cid
        try:
            _, raw = http_get(api, timeout=15)
            data = json.loads(raw)
            collection = data.get("collection") if isinstance(data, dict) else data
            for item in collection or []:
                url = item.get("permalink_url") or ""
                if "soundcloud.com" not in url:
                    continue
                user = item.get("user") or {}
                art = nicer_art(item.get("artwork_url") or user.get("avatar_url") or "")
                title = item.get("title") or q
                artist = user.get("username") or ""
                if not art:
                    t2, a2, art2 = sc_oembed(url, title)
                    art, title, artist = art2 or art, title or t2, artist or a2
                return {"url": url, "title": title, "artist": artist, "art": art, "query": q}
        except Exception:
            pass
    return {"url": "", "title": q, "artist": "", "art": "", "query": q}

def yahoo_quote(symbol):
    symbol = (symbol or "").strip().upper()
    if not symbol or not re.match(r"^[A-Z0-9.\-]{1,12}$", symbol):
        return None
    url = "https://query1.finance.yahoo.com/v8/finance/chart/" + urllib.parse.quote(symbol) + "?interval=1d&range=1d"
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json",
        })
        with urllib.request.urlopen(req, timeout=8, context=CTX) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        result = (data.get("chart") or {}).get("result") or []
        if not result:
            return None
        meta = result[0].get("meta") or {}
        return {
            "symbol": meta.get("symbol") or symbol,
            "regularMarketPrice": meta.get("regularMarketPrice"),
            "regularMarketChangePercent": meta.get("regularMarketChangePercent"),
            "shortName": meta.get("shortName") or meta.get("longName") or symbol,
            "currency": meta.get("currency") or "USD",
        }
    except Exception as e:
        print("[quote] failed for %s: %s" % (symbol, e))
        return None

def decode_zip_bytes(blob):
    for enc in ("utf-8", "utf-8-sig", "utf-16", "latin-1"):
        try:
            return blob.decode(enc)
        except Exception:
            continue
    return blob.decode("utf-8", errors="replace")

def extract_zip_full(b64):
    try:
        raw = base64.b64decode(b64)
    except Exception:
        return None, "[zip] bad base64"
    parts = []
    names = []
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            names = zf.namelist()
            for name in names:
                low = name.lower().replace("\\", "/")
                if name.endswith("/") or "/__macosx" in low or low.startswith("__macosx"):
                    continue
                if not low.endswith(TEXT_ZIP_EXTS):
                    continue
                parts.append("## " + name + "\n" + decode_zip_bytes(zf.read(name)))
    except Exception as e:
        return None, "[zip] " + str(e)
    return "\n\n".join(parts), names

def extract_zip_text(b64, per_file=80000, total=120000):
    full, names = extract_zip_full(b64)
    if full is None:
        return names
    if isinstance(names, str):
        return names
    head = "Attached zip contents: " + ", ".join(names[:40])
    return (head + "\n\n" + full)[:total]

def speak_text(text):
    if not ELEVEN_KEY:
        return None, "ELEVENLABS_API_KEY is not set"
    payload = json.dumps({
        "text": text[:1200],
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {"stability": 0.42, "similarity_boost": 0.8},
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.elevenlabs.io/v1/text-to-speech/" + ELEVEN_VOICE,
        data=payload,
        headers={"xi-api-key": ELEVEN_KEY, "accept": "audio/mpeg", "content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read(), None
    except urllib.error.HTTPError as e:
        return None, e.read().decode("utf-8", errors="replace") or str(e)
    except Exception as e:
        return None, str(e)
