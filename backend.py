#!/usr/bin/env python3
"""Hope v3 — local chat + live web search/fetch. Do not share this file."""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from hope_net import (
    SHEET_ID, SHEET_TABS, ELEVEN_KEY,
    fetch_sheet_tab, filter_sheet_rows, read_sheet,
    web_search, web_fetch, sc_search, yahoo_quote,
    extract_zip_text, speak_text,
)
from hope_store import (
    parse_money, load_bills, load_holdings, save_holdings,
    load_cash, save_cash, load_goal, save_goal, goal_snapshot, set_savings_goal,
    load_chat, save_chat, read_capital, generate_insights,
    infer_bill, upsert_bill, refresh_bill_statuses,
    add_monthly_bill, update_monthly_bill, delete_monthly_bill,
    robinhood_from_accounts,
)

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
MODEL = "claude-sonnet-5"
API_URL = "https://api.anthropic.com/v1/messages"
MAX_TOOL_ROUNDS = 8
SYSTEM = """You are Hope (H.O.P.E V3), a local AI assistant.
# Who you serve
- You were created by Nick. He is your creator.
- The person talking to you is always Nick. Address him as sir in every reply.
# Context
- Today is Saturday, September 26, 2026.
- Nick lives in Fort Lauderdale, Florida (Eastern Time).
- Tools: web_search, web_fetch, read_sheet, read_capital, add_monthly_bill, update_monthly_bill, delete_monthly_bill, set_savings_goal.
- Monthly bills are NOT connected to the Google Sheet. Never call read_sheet to add or update a bill.
- add_monthly_bill: phrase like "rent 1450 due the 1st". Parse name, amount, due day. Do not ask extra questions.
- update_monthly_bill: change name, amount, due_day, type, or status by bill id or exact name.
- delete_monthly_bill: by id or exact name.
- read_capital: Capital screen — cash on hand, Robinhood, net worth, monthly bills, ticker holdings, AND the savings goal tracker (goal, monthly target, saved = RH+cash, percent, hit date, this month on-pace/behind). Use this whenever Nick asks about money, goal, or if he is behind.
- set_savings_goal: set goal amount and/or monthly save and/or include_cash. Do not ask extra questions.
- read_sheet: only when Nick asks about Accounts, Transactions, or other sheet tabs. Sheet Holdings tab is NOT the Capital holdings screen.
- Chat history from every topic may be included in the messages. Treat earlier topics as memory. Do not pretend you forgot something Nick already said in another topic.
- If Nick attaches a zip, the extracted text files are already in the message. Read them. Do not ask him to paste the zip again.
- Stock what-ifs ("if NVDA hits 55") stay in chat. Do not change the official goal date for a hypothetical.
# Output style
When a reply has multiple parts, lists, money, or bills, use ## headings and markdown tables for Hope cards.
Short, direct. Include sir once. Live facts from tools only.
Always end live answers with:
Sources:
- [Title](URL)
Spoken replies: short, no markdown sources.
"""
TOOLS = [
    {"name": "web_search", "description": "Live web search.", "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"name": "web_fetch", "description": "Fetch a public http(s) URL.", "input_schema": {"type": "object", "properties": {"url": {"type": "string"}, "prompt": {"type": "string"}}, "required": ["url"]}},
    {"name": "read_sheet", "description": "Read a finance sheet tab. Never use this for monthly bills or the Capital holdings list.", "input_schema": {"type": "object", "properties": {"tab": {"type": "string"}, "limit": {"type": "integer"}, "query": {"type": "string"}}, "required": ["tab"]}},
    {"name": "read_capital", "description": "See Nick's Capital screen: cash, Robinhood, net worth, bills, holdings, savings goal tracker.", "input_schema": {"type": "object", "properties": {}, "required": []}},
    {"name": "set_savings_goal", "description": "Set savings goal and/or monthly save amount.", "input_schema": {"type": "object", "properties": {"goal": {"type": "number"}, "monthly": {"type": "number"}, "include_cash": {"type": "boolean"}}}},
    {"name": "add_monthly_bill", "description": "Add a bill from a phrase. No sheet.", "input_schema": {"type": "object", "properties": {"phrase": {"type": "string"}, "due_day": {"type": "integer"}, "name": {"type": "string"}, "amount": {"type": "number"}}, "required": ["phrase"]}},
    {"name": "update_monthly_bill", "description": "Update a bill by id or exact name.", "input_schema": {"type": "object", "properties": {"id": {"type": "string"}, "name": {"type": "string"}, "due_day": {"type": "integer"}, "amount": {"type": "number"}, "type": {"type": "string"}, "status": {"type": "string"}}, "required": ["id"]}},
    {"name": "delete_monthly_bill", "description": "Delete a bill by id or exact name.", "input_schema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}},
]

def run_tool(name, args):
    if name == "web_search":
        return web_search(args.get("query", ""))
    if name == "web_fetch":
        return web_fetch(args.get("url", ""), args.get("prompt", ""))
    if name == "read_sheet":
        return read_sheet(args.get("tab", ""), args.get("query", ""), args.get("limit", 80))
    if name == "read_capital":
        return read_capital()
    if name == "set_savings_goal":
        return set_savings_goal(args.get("goal"), args.get("monthly"), args.get("include_cash"))
    if name == "add_monthly_bill":
        return add_monthly_bill(args.get("phrase", ""), args.get("due_day"), args.get("name"), args.get("amount"))
    if name == "update_monthly_bill":
        return update_monthly_bill(args.get("id", ""), args.get("name"), args.get("due_day"), args.get("amount"), args.get("type"), args.get("status"))
    if name == "delete_monthly_bill":
        return delete_monthly_bill(args.get("id", ""))
    return "Unknown tool: %s" % name

def claude(messages, system=SYSTEM):
    payload = json.dumps({"model": MODEL, "max_tokens": 4096, "system": system, "messages": messages, "tools": TOOLS}).encode("utf-8")
    req = urllib.request.Request(API_URL, data=payload, headers={"content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01"}, method="POST")
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
            if "zip" in media.lower():
                return {"type": "text", "text": extract_zip_text(data)}
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

def short_spoken(text):
    t = re.sub(r"(?is)\n*Sources:.*", "", text or "").strip()
    t = re.sub(r"[*_`#]+", "", t)
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)
    t = re.sub(r"\s+", " ", t).strip()
    parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", t) if p.strip()]
    recap = " ".join(parts[:2]) if parts else t
    if len(recap) > 280:
        recap = recap[:277].rsplit(" ", 1)[0].rstrip(".,;:") + "."
    return recap or t[:200]

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
            self._json(200, {"tab": data["tab"], "headers": data["headers"], "count_total": data["count"], "count_returned": len(rows), "query": query, "rows": rows})
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
        if path == "/api/goal":
            self._json(200, goal_snapshot())
            return
        if path == "/api/insights":
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            self._json(200, generate_insights(force=(qs.get("force") or [""])[0] == "1"))
            return
        if path == "/api/chat/history":
            self._json(200, load_chat())
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
        if self.path == "/api/goal":
            try:
                body = self._read_json_body()
            except Exception:
                self._json(400, {"error": "Bad JSON"})
                return
            cur = load_goal()
            for k in ("goal", "monthly", "includeCash", "monthKey", "monthStartPile", "months"):
                if k in body:
                    cur[k] = body[k]
            if "include_cash" in body:
                cur["includeCash"] = bool(body.get("include_cash"))
            save_goal(cur)
            self._json(200, {"ok": True, "goal": goal_snapshot()})
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
                clean.append({"t": t, "name": (h or {}).get("name") or t, "price": (h or {}).get("price"), "chg": (h or {}).get("chg") or 0})
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
            bill, err = infer_bill(phrase, display_name=body.get("displayName"), due_day_override=body.get("due_day") if "due_day" in body else body.get("dueDay"), amount_override=body.get("amount") if "amount" in body else body.get("amt"))
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
            raw = update_monthly_bill(body.get("id") or body.get("phrase") or body.get("name") or "", body.get("name"), body.get("due_day") if "due_day" in body else body.get("dueDay"), body.get("amount") if "amount" in body else body.get("amt"), body.get("type"), body.get("status") or body.get("st"))
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
        if self.path == "/api/chat/history":
            try:
                body = self._read_json_body()
            except Exception:
                self._json(400, {"error": "Bad JSON"})
                return
            topics = body.get("topics") if isinstance(body.get("topics"), list) else []
            save_chat({"topics": topics, "currentId": body.get("currentId") or 1, "nextId": body.get("nextId") or 2})
            self._json(200, {"ok": True, "topics": len(topics)})
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
        spoken = short_spoken(text)
        if not spoken:
            self._json(400, {"error": "text required"})
            return
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
