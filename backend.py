#!/usr/bin/env python3
"""Hope v3 — local chat + live web search/fetch. Do not share this file."""
import calendar
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
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8765"))
DIR = Path(__file__).resolve().parent

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

SHEET_ID = os.environ.get(
    "HOPE_SHEET_ID",
    "1eVbAcpz_rGbZ0hXdA3Bleibzj_RfvFB3zkyhT6bgOpk",
).strip()
SHEET_TABS = [
    "Bank Connections",
    "Accounts",
    "Balance History",
    "Categories",
    "Transactions",
    "Securities",
    "Holdings",
    "Investment Transactions",
]
BILLS_FILE = DIR / "hope-bills.json"
HOLDINGS_FILE = DIR / "hope-holdings.json"
CASH_FILE = DIR / "hope-cash.json"

SYSTEM = """You are Hope (H.O.P.E V3), a local AI assistant.
# Who you serve
- You were created by Nick. He is your creator.
- The person talking to you is always Nick. Address him as sir in every reply.
# Context
- Today is Wednesday, September 23, 2026.
- Nick lives in Fort Lauderdale, Florida (Eastern Time).
- Tools: web_search, web_fetch, read_sheet, read_capital, add_monthly_bill, update_monthly_bill, delete_monthly_bill.
- Monthly bills are NOT connected to the Google Sheet. Never call read_sheet to add or update a bill.
- add_monthly_bill: phrase like "rent 1450 due the 1st". Parse name, amount, due day. Do not ask extra questions.
- update_monthly_bill: change name, amount, due_day, type, or status by bill id or exact name.
- delete_monthly_bill: by id or exact name.
- read_capital: Capital screen — cash on hand, Robinhood, net worth, monthly bills, ticker holdings. Use this whenever Nick asks about money on Capital.
- read_sheet: only when Nick asks about Accounts, Transactions, or other sheet tabs. Sheet Holdings tab is NOT the Capital holdings screen.
# Output style
Short, direct. Include sir once. Live facts from tools only.
Always end live answers with:
Sources:
- [Title](URL)
Spoken replies: short, no markdown sources.
"""

TOOLS = [
    {
        "name": "web_search",
        "description": "Live web search.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    },
    {
        "name": "web_fetch",
        "description": "Fetch a public http(s) URL.",
        "input_schema": {
            "type": "object",
            "properties": {"url": {"type": "string"}, "prompt": {"type": "string"}},
            "required": ["url"],
        },
    },
    {
        "name": "read_sheet",
        "description": "Read a finance sheet tab. Never use this for monthly bills or the Capital holdings list.",
        "input_schema": {
            "type": "object",
            "properties": {
                "tab": {"type": "string"},
                "limit": {"type": "integer"},
                "query": {"type": "string"},
            },
            "required": ["tab"],
        },
    },
    {
        "name": "read_capital",
        "description": "See Nick's Capital screen: cash on hand, Robinhood, net worth, monthly bills, and ticker holdings.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "add_monthly_bill",
        "description": "Add a bill from a phrase. No sheet. Example: rent 1450 due the 1st.",
        "input_schema": {
            "type": "object",
            "properties": {
                "phrase": {"type": "string"},
                "due_day": {"type": "integer"},
                "name": {"type": "string"},
                "amount": {"type": "number"},
            },
            "required": ["phrase"],
        },
    },
    {
        "name": "update_monthly_bill",
        "description": "Update a bill by id or exact name.",
        "input_schema": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "name": {"type": "string"},
                "due_day": {"type": "integer"},
                "amount": {"type": "number"},
                "type": {"type": "string"},
                "status": {"type": "string"},
            },
            "required": ["id"],
        },
    },
    {
        "name": "delete_monthly_bill",
        "description": "Delete a bill by id or exact name.",
        "input_schema": {
            "type": "object",
            "properties": {"id": {"type": "string"}},
            "required": ["id"],
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


def parse_money(val):
    cleaned = re.sub(r"[^0-9.\-]", "", str(val or ""))
    try:
        return float(cleaned) if cleaned else None
    except Exception:
        return None


def clamp_due(year, month, due_day):
    last = calendar.monthrange(year, month)[1]
    return datetime(year, month, min(max(1, int(due_day or 1)), last))


def cycle_window(due_day, today=None):
    today = today or datetime.now()
    due_day = max(1, min(31, int(due_day or 1)))
    this_due = clamp_due(today.year, today.month, due_day)
    if today >= this_due:
        start = this_due
        if today.month == 12:
            end = clamp_due(today.year + 1, 1, due_day)
        else:
            end = clamp_due(today.year, today.month + 1, due_day)
    else:
        if today.month == 1:
            start = clamp_due(today.year - 1, 12, due_day)
        else:
            start = clamp_due(today.year, today.month - 1, due_day)
        end = this_due
    return start, end


def load_bills():
    if not BILLS_FILE.exists():
        return []
    try:
        data = json.loads(BILLS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_bills(bills):
    if not isinstance(bills, list):
        return
    BILLS_FILE.write_text(json.dumps(bills, indent=2), encoding="utf-8")


def load_holdings():
    if not HOLDINGS_FILE.exists():
        return []
    try:
        data = json.loads(HOLDINGS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_holdings(rows):
    HOLDINGS_FILE.write_text(json.dumps(rows, indent=2), encoding="utf-8")


def load_cash():
    if not CASH_FILE.exists():
        return 2500.0
    try:
        data = json.loads(CASH_FILE.read_text(encoding="utf-8"))
        n = float(data.get("cash") if isinstance(data, dict) else data)
        return n if n == n else 2500.0
    except Exception:
        return 2500.0


def save_cash(n):
    CASH_FILE.write_text(json.dumps({"cash": float(n)}, indent=2), encoding="utf-8")


def read_capital():
    bills = load_bills()
    holds = load_holdings()
    cash = load_cash()
    rh = None
    acc, err = fetch_sheet_tab("Accounts")
    if not err:
        rh = robinhood_from_accounts(acc["rows"])
    net = (rh or 0) + cash
    return json.dumps({
        "screen": "Capital",
        "cash_on_hand": cash,
        "robinhood": rh,
        "net_worth": net,
        "monthly_bills": bills,
        "holdings": holds,
    }, ensure_ascii=False)


def new_bill_id():
    return "bill_%s_%04d" % (
        datetime.now().strftime("%Y%m%d%H%M%S"),
        int(time.time() * 1000) % 10000,
    )


def parse_due_day(text):
    t = (text or "").lower()
    m = re.search(r"\bdue(?:\s+on)?(?:\s+the)?\s+(\d{1,2})(?:st|nd|rd|th)?\b", t)
    if m:
        return max(1, min(31, int(m.group(1))))
    m = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)\b", t)
    if m:
        return max(1, min(31, int(m.group(1))))
    return None


def parse_amount(text):
    m = re.search(r"\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+\.\d{1,2}|\d+)", text or "")
    if not m:
        return None
    return parse_money(m.group(1))


def parse_bill_name(text, amount=None):
    t = (text or "").strip()
    t = re.sub(r"(?i)\b(add|update|monthly\s+bill|bill)\b", " ", t)
    t = re.sub(r"(?i)\bdue(?:\s+on)?(?:\s+the)?\s+\d{1,2}(?:st|nd|rd|th)?\b", " ", t)
    t = re.sub(r"(?i)\b\d{1,2}(?:st|nd|rd|th)\b", " ", t)
    if amount is not None:
        t = re.sub(r"\$?\s*" + re.escape(str(int(amount))) + r"(?:\.\d+)?", " ", t)
        t = re.sub(r"\$?\s*" + re.escape("%.2f" % amount), " ", t)
    t = re.sub(r"\s+", " ", t).strip(" -")
    return t.title() if t else "Bill"


def infer_bill(phrase, display_name=None, due_day_override=None, amount_override=None):
    phrase = (phrase or "").strip()
    if not phrase:
        return None, "Need a bill name."
    amt = amount_override if amount_override is not None else parse_amount(phrase)
    due_day = due_day_override if due_day_override is not None else parse_due_day(phrase)
    try:
        due_day = max(1, min(31, int(due_day))) if due_day is not None else 1
        due_source = "override" if due_day_override is not None else ("parsed" if parse_due_day(phrase) else "default")
    except Exception:
        due_day, due_source = 1, "default"
    if amt is None:
        amt = 0
    label = (display_name or parse_bill_name(phrase, amt)).strip() or phrase.title()
    now = datetime.now()
    start, end = cycle_window(due_day, now)
    this_due = clamp_due(now.year, now.month, due_day)
    st = "over" if now > this_due else "pend"
    return {
        "id": new_bill_id(),
        "name": label,
        "amt": abs(float(amt)),
        "dueDay": due_day,
        "dueSource": due_source,
        "cycleStart": start.strftime("%Y-%m-%d"),
        "cycleEnd": end.strftime("%Y-%m-%d"),
        "type": "Recurring",
        "st": st,
    }, None


def upsert_bill(bill):
    bills = load_bills()
    idx = -1
    bid = str(bill.get("id") or "").strip().lower()
    name = str(bill.get("name") or "").strip().lower()
    if bid.startswith("bill_"):
        for i, existing in enumerate(bills):
            if str(existing.get("id") or "").strip().lower() == bid:
                idx = i
                break
    if idx < 0 and name:
        for i, existing in enumerate(bills):
            if str(existing.get("name") or "").strip().lower() == name:
                idx = i
                break
    if idx >= 0:
        keep_id = bills[idx].get("id") or new_bill_id()
        if bill.get("dueSource") != "override" and bills[idx].get("dueDay"):
            if bill.get("dueSource") == "default":
                bill["dueDay"] = bills[idx].get("dueDay")
                bill["dueSource"] = bills[idx].get("dueSource") or "locked"
        if not bill.get("amt") and bills[idx].get("amt"):
            bill["amt"] = bills[idx]["amt"]
        bill["id"] = keep_id
        bills[idx] = bill
        save_bills(bills)
        return bill, True
    if not str(bill.get("id") or "").startswith("bill_"):
        bill["id"] = new_bill_id()
    bills.append(bill)
    save_bills(bills)
    return bill, False


def refresh_bill_statuses(bills):
    if not bills:
        return bills
    now = datetime.now()
    out = []
    for bill in bills:
        if not str(bill.get("id") or "").startswith("bill_"):
            bill["id"] = new_bill_id()
        due_day = int(bill.get("dueDay") or 1)
        start, end = cycle_window(due_day, now)
        bill["cycleStart"] = start.strftime("%Y-%m-%d")
        bill["cycleEnd"] = end.strftime("%Y-%m-%d")
        if bill.get("st") == "paid":
            if now >= end:
                bill["st"] = "pend"
        else:
            this_due = clamp_due(now.year, now.month, due_day)
            bill["st"] = "over" if now > this_due else "pend"
        out.append(bill)
    save_bills(out)
    return out


def add_monthly_bill(phrase, due_day=None, name=None, amount=None):
    bill, err = infer_bill(phrase, display_name=name, due_day_override=due_day, amount_override=amount)
    if err:
        return err
    saved, replaced = upsert_bill(bill)
    return json.dumps({
        "ok": True,
        "action": "updated" if replaced else "added",
        "bill": saved,
    }, ensure_ascii=False)


def find_bill(bills, key):
    k = str(key or "").strip().lower()
    if not k:
        return -1
    for i, b in enumerate(bills):
        if str(b.get("id") or "").strip().lower() == k:
            return i
    for i, b in enumerate(bills):
        if str(b.get("name") or "").strip().lower() == k:
            return i
    return -1


def norm_status(val):
    s = str(val or "").strip().lower()
    if s in ("paid", "pay", "done"):
        return "paid"
    if s in ("over", "overdue", "unpaid", "late"):
        return "over"
    if s in ("pend", "pending", "upcoming"):
        return "pend"
    return None


def update_monthly_bill(bill_id, name=None, due_day=None, amount=None, type_name=None, status=None):
    bills = load_bills()
    i = find_bill(bills, bill_id)
    if i < 0:
        return "No bill matched %r." % bill_id
    if name:
        bills[i]["name"] = str(name).strip()
    if due_day is not None:
        try:
            bills[i]["dueDay"] = max(1, min(31, int(due_day)))
            bills[i]["dueSource"] = "override"
        except Exception:
            pass
    if amount is not None:
        try:
            bills[i]["amt"] = abs(float(amount))
        except Exception:
            pass
    if type_name:
        bills[i]["type"] = "One-Time" if "one" in str(type_name).lower() else "Recurring"
    st = norm_status(status)
    if st:
        bills[i]["st"] = st
    save_bills(bills)
    return json.dumps({"ok": True, "action": "updated", "bill": bills[i]}, ensure_ascii=False)


def delete_monthly_bill(bill_id):
    bills = load_bills()
    i = find_bill(bills, bill_id)
    if i < 0:
        return "No bill matched %r." % bill_id
    removed = bills.pop(i)
    save_bills(bills)
    return json.dumps({"ok": True, "action": "deleted", "bill": removed}, ensure_ascii=False)


def robinhood_from_accounts(rows):
    found = None
    for row in rows:
        name = str(row.get("Name") or "").strip().lower()
        bank = str(row.get("Bank Connection") or "").strip().lower()
        bal = parse_money(row.get("Current Balance"))
        if bal is None:
            continue
        if name == "robinhood individual":
            return bal
        if found is None and ("robinhood" in name or bank == "robinhood"):
            found = bal
    return found


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


def run_tool(name, args):
    if name == "web_search":
        return web_search(args.get("query", ""))
    if name == "web_fetch":
        return web_fetch(args.get("url", ""), args.get("prompt", ""))
    if name == "read_sheet":
        return read_sheet(args.get("tab", ""), args.get("query", ""), args.get("limit", 80))
    if name == "read_capital":
        return read_capital()
    if name == "add_monthly_bill":
        return add_monthly_bill(args.get("phrase", ""), args.get("due_day"), args.get("name"), args.get("amount"))
    if name == "update_monthly_bill":
        return update_monthly_bill(
            args.get("id", ""),
            args.get("name"),
            args.get("due_day"),
            args.get("amount"),
            args.get("type"),
            args.get("status"),
        )
    if name == "delete_monthly_bill":
        return delete_monthly_bill(args.get("id", ""))
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
        API_URL, data=payload,
        headers={"content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01"},
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
    return "".join((b.get("text") or "") for b in (content or []) if isinstance(b, dict) and b.get("type") == "text").strip()


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
            return {"type": "image", "source": {"type": "base64", "media_type": media, "data": data}}
    if kind == "document":
        src = b.get("source") or {}
        data = (src.get("data") or "").strip()
        media = (src.get("media_type") or "application/pdf").split(";")[0].strip()
        if src.get("type") == "base64" and data:
            return {"type": "document", "source": {"type": "base64", "media_type": media, "data": data}}
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
        blocks = [x for x in (clean_block(b) for b in content) if x]
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
            results.append({"type": "tool_result", "tool_use_id": b.get("id"), "content": out[:20000]})
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


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def _json(self, code, obj):
        raw = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(raw)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8") or "{}")

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
        if path == "/api/quote":
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            symbol = (qs.get("symbol") or [""])[0].strip().upper()
            if not symbol:
                self._json(400, {"error": "symbol required"})
                return
            meta = yahoo_quote(symbol)
            if not meta:
                self._json(502, {"error": "quote failed", "symbol": symbol})
                return
            self._json(200, meta)
            return
        if path == "/api/sheet/tabs":
            self._json(200, {"sheet_id": SHEET_ID, "tabs": SHEET_TABS})
            return
        if path == "/api/sheet/robinhood":
            data, err = fetch_sheet_tab("Accounts")
            if err:
                self._json(502, {"error": err})
                return
            bal = robinhood_from_accounts(data["rows"])
            if bal is None:
                self._json(404, {"error": "Robinhood individual not found"})
                return
            self._json(200, {"account": "Robinhood individual", "current_balance": bal})
            return
        if path == "/api/sheet":
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            tab = (qs.get("tab") or [""])[0]
            query = (qs.get("q") or qs.get("query") or [""])[0]
            limit = (qs.get("limit") or ["80"])[0]
            data, err = fetch_sheet_tab(tab)
            if err:
                self._json(400 if err.startswith("Unknown") else 502, {"error": err, "tabs": SHEET_TABS})
                return
            rows = filter_sheet_rows(data["rows"], query, limit)
            self._json(200, {
                "tab": data["tab"], "headers": data["headers"],
                "count_total": data["count"], "count_returned": len(rows),
                "query": query, "rows": rows,
            })
            return
        if path == "/api/bills":
            bills = load_bills()
            if bills:
                bills = refresh_bill_statuses(bills)
            self._json(200, {"bills": bills})
            return
        if path == "/api/holdings":
            self._json(200, {"holdings": load_holdings()})
            return
        if path == "/api/cash":
            self._json(200, {"cash": load_cash()})
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
            data = data.decode("utf-8", errors="replace").replace("__GOOGLE_MAPS_KEY__", MAPS_KEY).encode("utf-8")
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
        if self.path == "/api/cash":
            try:
                body = self._read_json_body()
            except Exception:
                self._json(400, {"error": "Bad JSON"})
                return
            n = parse_money(body.get("cash"))
            if n is None:
                self._json(400, {"error": "cash required"})
                return
            save_cash(n)
            self._json(200, {"ok": True, "cash": n})
            return
        if self.path == "/api/holdings":
            try:
                body = self._read_json_body()
            except Exception:
                self._json(400, {"error": "Bad JSON"})
                return
            rows = body.get("holdings") if isinstance(body.get("holdings"), list) else []
            clean = []
            for h in rows:
                t = str((h or {}).get("t") or "").strip().upper()
                if not t:
                    continue
                clean.append({
                    "t": t,
                    "name": (h or {}).get("name") or t,
                    "price": (h or {}).get("price"),
                    "chg": (h or {}).get("chg") or 0,
                })
            save_holdings(clean)
            self._json(200, {"ok": True, "holdings": clean})
            return
        if self.path == "/api/bills":
            try:
                body = self._read_json_body()
            except Exception:
                self._json(400, {"error": "Bad JSON"})
                return
            phrase = (body.get("phrase") or body.get("name") or "").strip()
            bill, err = infer_bill(
                phrase,
                display_name=body.get("displayName"),
                due_day_override=body.get("due_day") if "due_day" in body else body.get("dueDay"),
                amount_override=body.get("amount") if "amount" in body else body.get("amt"),
            )
            if err:
                self._json(400, {"error": err})
                return
            saved, replaced = upsert_bill(bill)
            self._json(200, {"ok": True, "action": "updated" if replaced else "added", "bill": saved})
            return
        if self.path == "/api/bills/update":
            try:
                body = self._read_json_body()
            except Exception:
                self._json(400, {"error": "Bad JSON"})
                return
            raw = update_monthly_bill(
                body.get("id") or body.get("phrase") or body.get("name") or "",
                body.get("name"),
                body.get("due_day") if "due_day" in body else body.get("dueDay"),
                body.get("amount") if "amount" in body else body.get("amt"),
                body.get("type"),
                body.get("status") or body.get("st"),
            )
            try:
                self._json(200, json.loads(raw))
            except Exception:
                self._json(404, {"error": raw})
            return
        if self.path == "/api/bills/delete":
            try:
                body = self._read_json_body()
            except Exception:
                self._json(400, {"error": "Bad JSON"})
                return
            raw = delete_monthly_bill(body.get("id") or body.get("phrase") or body.get("name") or "")
            try:
                self._json(200, json.loads(raw))
            except Exception:
                self._json(404, {"error": raw})
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
            lat = float(loc.get("lat")); lng = float(loc.get("lng"))
            extra = "\n\n# Live location this turn\n- Nick's current Google pin: %.5f, %.5f." % (lat, lng)
        except Exception:
            pass
        self._json(200, {"text": chat_with_tools(clean, extra), "model": MODEL})

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
    print("SHEET_ID:", SHEET_ID)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
