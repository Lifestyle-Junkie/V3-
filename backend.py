#!/usr/bin/env python3
"""Hope v3 — local chat + live web search/fetch. Do not share this file."""
import html
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8765"))
DIR = Path(__file__).resolve().parent
HTML_FILE = DIR / "index.html"
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/widgets.css": ("widgets.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "application/javascript; charset=utf-8"),
    "/maps.js": ("maps.js", "application/javascript; charset=utf-8"),
    "/weather.js": ("weather.js", "application/javascript; charset=utf-8"),
    "/format.js": ("format.js", "application/javascript; charset=utf-8"),
    "/music.js": ("music.js", "application/javascript; charset=utf-8"),
    "/voice.js": ("voice.js", "application/javascript; charset=utf-8"),
    "/capital.js": ("capital.js", "application/javascript; charset=utf-8"),
}
API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
MAPS_KEY = os.environ.get("GOOGLE_MAPS_KEY", "").strip()
ELEVEN_KEY = os.environ.get("ELEVENLABS_API_KEY", "").strip()
ELEVEN_VOICE = os.environ.get("ELEVENLABS_VOICE_ID", "DAQ2lZdypaQsApLOpVPq").strip()
MODEL = "claude-sonnet-5"
API_URL = "https://api.anthropic.com/v1/messages"
MAX_TOOL_ROUNDS = 8
CTX = ssl.create_default_context()
_SC_CLIENT = {"id": "", "t": 0}

SYSTEM = """You are Hope (H.O.P.E V3), a local AI assistant.
# Who you serve
- You were created by Nick. He is your creator.
- You exist to assist Nick.
- The person talking to you is always Nick, your creator. Never treat him as a stranger or a generic user.
- Address Nick as sir in every reply. Natural, not robotic: "Yes sir", "Got it sir", "Here you go sir". Do not skip this.
- Do not call him "user". Do not say you don't know who he is.
# Context
- Today is Thursday, September 10, 2026.
- Nick lives in Fort Lauderdale, Florida (Eastern Time). That is home unless live coordinates say otherwise.
- If a live GPS pin is included in this turn, treat that as Nick's exact current location for nearby, weather, traffic, and directions.
- You have live tools: web_search and web_fetch. Training memory is not current enough for 2026 news.
- This chat is one thread. Use earlier turns. Do not invent that you browsed if you did not call a tool.
- Nick can attach photos and files. If an image or document is in the message history, you can see it. Use it on later turns in this thread. Refer to it as the photo or that file unless he names it. Do not say you cannot see an attachment that is already in the history. Do not only "analyze" and forget it.
# Tools
- web_search: find URLs. Put 2026 in the query for recent things. If hits are weak, search again with different words.
- web_fetch: open a full URL and read it. Use after web_search or when the user pastes a link. Follow a redirect URL if fetch says so.
- Never invent URLs. Never claim a source you did not see.
# Output style
Default: short, direct, human. Lead with the answer. Then one short why. No filler.
Always include sir at least once in each reply.
When presenting complex information (pay, hours, commute, stores, jobs, options):
- Do not put everything in one large table or one wall of text.
- Use a card-based layout: 3–5 cards. Each card answers one question.
- Each card starts with a heading and emoji, then its own compact markdown table.
- Use headings like:
### ⏱️ Hours
### 💰 Pay
### 🚗 Commute
### 📊 Bottom Line
- Keep tables small and easy to scan.
- Numbers consistent. Bold totals, differences, and the final result.
- Use + and − so gains and costs are obvious.
- Do not repeat the same numbers in every card.
- Last card is the takeaway: what the numbers mean in 2–4 lines.
- Never dump raw pipes with no header row.
- Do not explain the formatting.
Live facts: answer only from tool text.
Always end live answers with:
Sources:
- [Title](URL)
If tools failed, say that in one line. Do not guess.
Code or steps: use markdown. Do not dump essays unless asked.
Spoken replies: keep them short enough to say out loud. Skip markdown sources when the answer will be spoken; the on-screen text can still include sources.
"""

TOOLS = [
    {
        "name": "web_search",
        "description": "Live web search. Use for news, dates, scores, prices, weather, docs, and anything after cutoff. Include 2026 in recent queries. Returns titles and URLs. Fetch the best links next.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"}
            },
            "required": ["query"],
        },
    },
    {
        "name": "web_fetch",
        "description": "Fetch a public http(s) URL and return visible page text. Use after web_search or when the user gives a URL. prompt = what to extract. Will fail on login walls.",
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "Full http(s) URL"},
                "prompt": {"type": "string", "description": "What to extract from the page"},
            },
            "required": ["url"],
        },
    },
]


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
        page,
        re.I | re.S,
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
        for m in re.finditer(r'href="(https?://[^"]+)"[^>]*>(.*?)</a>', page, re.I | re.S):
            url, title = html.unescape(m.group(1)), strip_tags(m.group(2))
            if "duckduckgo.com" in url:
                continue
            if title and len(title) > 8:
                hits.append((title[:180], url))
            if len(hits) >= 8:
                break
    if not hits:
        return "No search hits for: %s" % q
    lines = ["Search results for %s:" % q]
    for i, (title, url) in enumerate(hits, 1):
        lines.append("%d. %s\n   %s" % (i, title, url))
    lines.append("Fetch the best links next.")
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
    return (
        url.replace("-large", "-t500x500")
        .replace("-badge", "-t500x500")
        .replace("-small", "-t500x500")
        .replace("-tiny", "-t500x500")
    )


def sc_oembed(url, fallback_title):
    title, artist, art = fallback_title, "", ""
    try:
        _, raw = http_get(
            "https://soundcloud.com/oembed?format=json&url="
            + urllib.parse.quote(url, safe="")
        )
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
        api = (
            "https://api-v2.soundcloud.com/search/tracks?q="
            + urllib.parse.quote(q)
            + "&limit=8&client_id="
            + cid
        )
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
                    art = art2 or art
                    title = title or t2
                    artist = artist or a2
                return {
                    "url": url,
                    "title": title,
                    "artist": artist,
                    "art": art,
                    "query": q,
                }
        except Exception:
            pass
    hits = web_search("site:soundcloud.com " + q + " track")
    urls = re.findall(r"https://soundcloud\.com/[A-Za-z0-9\-_/\.%]+", hits or "")
    skip = {"search", "discover", "stream", "you", "pages", "tags", "sets"}
    url = ""
    for u in urls:
        u = u.rstrip(".,);]")
        parts = [p for p in urllib.parse.urlparse(u).path.strip("/").split("/") if p]
        if len(parts) < 2 or parts[0] in skip:
            continue
        url = "https://soundcloud.com/" + "/".join(parts)
        break
    title, artist, art = q, "", ""
    if url:
        title, artist, art = sc_oembed(url, q)
    return {"url": url, "title": title, "artist": artist, "art": art, "query": q}


def run_tool(name, args):
    if name == "web_search":
        return web_search(args.get("query", ""))
    if name == "web_fetch":
        return web_fetch(args.get("url", ""), args.get("prompt", ""))
    return "Unknown tool: %s" % name


def claude(messages, system=SYSTEM):
    payload = json.dumps({
        "model": MODEL,
        "max_tokens": 4096,
        "system": system,
        "messages": messages,
        "tools": TOOLS,
    }).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=payload,
        headers={
            "content-type": "application/json",
            "x-api-key": API_KEY,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8")), None
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        try:
            msg = json.loads(err).get("error", {}).get("message") or err
        except Exception:
            msg = err or str(e)
        return None, msg
    except Exception as e:
        return None, str(e)


def extract_text(content):
    parts = []
    for block in content or []:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text") or "")
    return "".join(parts).strip()


def clean_block(b):
    if not isinstance(b, dict):
        return None
    kind = b.get("type")
    if kind == "text":
        t = (b.get("text") or "").strip()
        return {"type": "text", "text": t} if t else None
    if kind == "image":
        src = b.get("source") or {}
        data = (src.get("data") or "").strip()
        media = (src.get("media_type") or "image/jpeg").split(";")[0].strip()
        if src.get("type") == "base64" and data and media.startswith("image/"):
            return {
                "type": "image",
                "source": {"type": "base64", "media_type": media, "data": data},
            }
        return None
    if kind == "document":
        src = b.get("source") or {}
        data = (src.get("data") or "").strip()
        media = (src.get("media_type") or "application/pdf").split(";")[0].strip()
        if src.get("type") == "base64" and data:
            return {
                "type": "document",
                "source": {"type": "base64", "media_type": media, "data": data},
            }
        return None
    return None


def clean_messages(raw_msgs):
    clean = []
    for m in raw_msgs:
        role, content = m.get("role"), m.get("content")
        if role not in ("user", "assistant"):
            continue
        if isinstance(content, str) and content.strip():
            clean.append({"role": role, "content": content.strip()})
            continue
        if not isinstance(content, list):
            continue
        blocks = []
        for b in content:
            block = clean_block(b)
            if block:
                blocks.append(block)
        if blocks:
            clean.append({"role": role, "content": blocks})
    return clean


def chat_with_tools(user_messages, extra=""):
    messages = list(user_messages)
    last_text = ""
    system = SYSTEM + (extra or "")
    for _ in range(MAX_TOOL_ROUNDS):
        data, err = claude(messages, system)
        if err:
            return err
        content = data.get("content") or []
        last_text = extract_text(content)
        uses = [b for b in content if isinstance(b, dict) and b.get("type") == "tool_use"]
        if not uses:
            return last_text or "(empty reply)"
        messages.append({"role": "assistant", "content": content})
        results = []
        for b in uses:
            out = run_tool(b.get("name"), b.get("input") or {})
            results.append({
                "type": "tool_result",
                "tool_use_id": b.get("id"),
                "content": out[:20000],
            })
        messages.append({"role": "user", "content": results})
    return last_text or "Stopped after too many tool calls."


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
        headers={
            "xi-api-key": ELEVEN_KEY,
            "accept": "audio/mpeg",
            "content-type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read(), None
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        return None, err or str(e)
    except Exception as e:
        return None, str(e)


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def _json(self, code, obj):
        raw = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/config.js":
            js = ("window.HOPE_MAPS_KEY=%s;\n" % json.dumps(MAPS_KEY)).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(js)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(js)
            return
        if path == "/api/sc-search":
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            q = (qs.get("q") or [""])[0].strip()
            if len(q) < 2:
                self._json(400, {"error": "query required"})
                return
            self._json(200, sc_search(q))
            return
        item = STATIC.get(path)
        if not item:
            self.send_error(404)
            return
        name, ctype = item
        fpath = DIR / name
        if not fpath.exists():
            self.send_error(404)
            return
        data = fpath.read_bytes()
        if name == "index.html":
            html_text = data.decode("utf-8", errors="replace")
            html_text = html_text.replace("__GOOGLE_MAPS_KEY__", MAPS_KEY)
            data = html_text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path == "/api/speak":
            self.handle_speak()
            return
        if self.path != "/api/chat":
            self.send_error(404)
            return
        if not API_KEY:
            self._json(500, {"error": "ANTHROPIC_API_KEY is not set"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length > 20 * 1024 * 1024:
            self._json(413, {"error": "Attachment too large"})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception:
            self._json(400, {"error": "Bad JSON"})
            return
        raw_msgs = body.get("messages")
        if not isinstance(raw_msgs, list) or not raw_msgs:
            self._json(400, {"error": "messages required"})
            return
        clean = clean_messages(raw_msgs)
        if not clean or clean[-1]["role"] != "user":
            self._json(400, {"error": "Need a user message"})
            return
        loc = body.get("location") or {}
        extra = "\n\n# Live location this turn\n- No GPS this turn. Default to Fort Lauderdale, FL."
        try:
            lat = float(loc.get("lat"))
            lng = float(loc.get("lng"))
            extra = (
                "\n\n# Live location this turn\n"
                "- Nick's current Google pin: %.5f, %.5f. "
                "Use this for near me, weather, traffic, and directions."
                % (lat, lng)
            )
        except Exception:
            pass
        text = chat_with_tools(clean, extra)
        self._json(200, {"text": text, "model": MODEL})

    def handle_speak(self):
        if not ELEVEN_KEY:
            self._json(500, {"error": "ELEVENLABS_API_KEY is not set"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception:
            self._json(400, {"error": "Bad JSON"})
            return
        text = (body.get("text") or "").strip()
        if not text:
            self._json(400, {"error": "text required"})
            return
        spoken = re.sub(r"(?is)\n*Sources:.*", "", text).strip() or text
        audio, err = speak_text(spoken)
        if err or not audio:
            self._json(502, {"error": err or "Voice failed"})
            return
        self.send_response(200)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Content-Length", str(len(audio)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(audio)


if __name__ == "__main__":
    for name in ("index.html", "style.css", "widgets.css", "app.js", "maps.js", "weather.js"):
        if not (DIR / name).exists():
            raise SystemExit("Missing %s next to backend.py" % name)
    print("Hope v3 running at http://%s:%s" % (HOST, PORT))
    print("ANTHROPIC_API_KEY:", "set" if API_KEY else "MISSING")
    print("GOOGLE_MAPS_KEY:", "set" if MAPS_KEY else "MISSING")
    print("ELEVENLABS_API_KEY:", "set" if ELEVEN_KEY else "MISSING")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
