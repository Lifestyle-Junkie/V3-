"""Hope persistence: bills, cash, holdings, chat, goal, insights."""
import calendar
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

from hope_net import API_KEY, API_URL, MODEL, fetch_sheet_tab

DIR = Path(__file__).resolve().parent
MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
BILLS_FILE = DIR / "hope-bills.json"
HOLDINGS_FILE = DIR / "hope-holdings.json"
CASH_FILE = DIR / "hope-cash.json"
CHAT_FILE = DIR / "hope-chat.json"
GOAL_FILE = DIR / "hope-goal.json"
INSIGHTS_FILE = DIR / "hope-insights.json"
INSIGHT_TTL = 3600

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

def default_goal():
    return {
        "goal": 25000.0,
        "monthly": 2200.0,
        "includeCash": True,
        "monthKey": "",
        "monthStartPile": None,
        "months": [],
    }

def load_goal():
    base = default_goal()
    if not GOAL_FILE.exists():
        return base
    try:
        data = json.loads(GOAL_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return base
        base.update(data)
        return base
    except Exception:
        return base

def save_goal(data):
    if not isinstance(data, dict):
        return
    GOAL_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")

def month_key_now():
    now = datetime.now()
    return "%04d-%02d" % (now.year, now.month)

def pile_now(rh, cash, include_cash):
    return (rh or 0) + (cash if include_cash else 0)

def roll_goal(goal, saved):
    key = month_key_now()
    if not goal.get("monthKey"):
        goal["monthKey"] = key
        if goal.get("monthStartPile") is None:
            goal["monthStartPile"] = saved
        return goal
    if goal.get("monthKey") == key:
        if goal.get("monthStartPile") is None:
            goal["monthStartPile"] = saved
        return goal
    try:
        mm = int(str(goal.get("monthKey") or "1-1").split("-")[1])
        old = MONTH_NAMES[max(0, mm - 1)]
    except Exception:
        old = "Prev"
    added = saved - float(goal.get("monthStartPile") or saved)
    monthly = float(goal.get("monthly") or 0)
    months = list(goal.get("months") or [])
    months.append({"m": old, "v": round(added), "ok": added >= monthly})
    goal["months"] = months[-6:]
    goal["monthKey"] = key
    goal["monthStartPile"] = saved
    return goal

def goal_snapshot(rh=None, cash=None):
    if cash is None:
        cash = load_cash()
    if rh is None:
        rh = 0
        acc, err = fetch_sheet_tab("Accounts")
        if not err:
            rh = robinhood_from_accounts(acc["rows"]) or 0
    goal = load_goal()
    include = bool(goal.get("includeCash", True))
    saved = pile_now(rh, cash, include)
    goal = roll_goal(goal, saved)
    save_goal(goal)
    target = float(goal.get("goal") or 0)
    monthly = float(goal.get("monthly") or 0)
    gap = max(0, target - saved)
    pct = (saved / target * 100) if target else 0
    if gap <= 0:
        months_left, hit = 0, "Hit"
    elif monthly > 0:
        months_left = int(-(-gap // monthly))
        now = datetime.now()
        m = now.month - 1 + months_left
        y = now.year + m // 12
        mo = m % 12
        hit = "%s %s" % (MONTH_NAMES[mo], y)
    else:
        months_left, hit = 0, "Set monthly"
    start = goal.get("monthStartPile")
    added = 0 if start is None else saved - float(start)
    behind = max(0, monthly - added) if monthly else 0
    pace = "On pace" if start is not None and added >= monthly else ("Behind" if start is not None else "—")
    return {
        "goal": target, "monthly": monthly, "includeCash": include,
        "saved": saved, "rh": rh, "cash": cash, "gap": gap, "pct": round(pct, 1),
        "monthsLeft": months_left, "hitLabel": hit,
        "month": MONTH_NAMES[datetime.now().month - 1],
        "monthKey": goal.get("monthKey"), "monthStartPile": start,
        "addedThisMonth": added, "behindBy": behind, "pace": pace,
        "months": goal.get("months") or [],
    }

def set_savings_goal(goal=None, monthly=None, include_cash=None):
    data = load_goal()
    if goal is not None:
        try:
            data["goal"] = abs(float(goal))
        except Exception:
            pass
    if monthly is not None:
        try:
            data["monthly"] = abs(float(monthly))
        except Exception:
            pass
    if include_cash is not None:
        data["includeCash"] = bool(include_cash)
    save_goal(data)
    return json.dumps({"ok": True, "action": "updated", "goal": goal_snapshot()}, ensure_ascii=False)

def load_chat():
    if not CHAT_FILE.exists():
        return {"topics": [], "currentId": 1, "nextId": 2}
    try:
        data = json.loads(CHAT_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"topics": [], "currentId": 1, "nextId": 2}
        topics = data.get("topics") if isinstance(data.get("topics"), list) else []
        return {
            "topics": topics,
            "currentId": data.get("currentId") or 1,
            "nextId": data.get("nextId") or 2,
        }
    except Exception:
        return {"topics": [], "currentId": 1, "nextId": 2}

def save_chat(data):
    if not isinstance(data, dict):
        return
    CHAT_FILE.write_text(json.dumps({
        "topics": data.get("topics") if isinstance(data.get("topics"), list) else [],
        "currentId": data.get("currentId") or 1,
        "nextId": data.get("nextId") or 2,
    }, indent=2), encoding="utf-8")

def read_capital():
    bills = load_bills()
    holds = load_holdings()
    cash = load_cash()
    rh = None
    acc, err = fetch_sheet_tab("Accounts")
    if not err:
        rh = robinhood_from_accounts(acc["rows"])
    net = (rh or 0) + cash
    snap = goal_snapshot(rh or 0, cash)
    return json.dumps({
        "screen": "Capital",
        "cash_on_hand": cash,
        "robinhood": rh,
        "net_worth": net,
        "monthly_bills": bills,
        "holdings": holds,
        "savings_goal": snap,
    }, ensure_ascii=False)

def load_insights_cache():
    if not INSIGHTS_FILE.exists():
        return None
    try:
        data = json.loads(INSIGHTS_FILE.read_text(encoding="utf-8"))
        if time.time() - float(data.get("ts") or 0) < INSIGHT_TTL:
            return data.get("rows") or []
    except Exception:
        return None
    return None

def save_insights_cache(rows):
    INSIGHTS_FILE.write_text(json.dumps({"ts": time.time(), "rows": rows}, indent=2), encoding="utf-8")

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
    t = re.sub(r"(?is)\b(add|update|monthly\s+bill|bill)\b", " ", t)
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
    return json.dumps({"ok": True, "action": "updated" if replaced else "added", "bill": saved}, ensure_ascii=False)

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

def extract_text(content):
    return "".join((b.get("text") or "") for b in (content or []) if isinstance(b, dict) and b.get("type") == "text").strip()

def claude_plain(messages, system, max_tokens=800):
    payload = json.dumps({
        "model": MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
    }).encode("utf-8")
    req = urllib.request.Request(
        API_URL, data=payload,
        headers={"content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
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

def generate_insights(force=False):
    cached = None if force else load_insights_cache()
    if cached:
        return {"ok": True, "cached": True, "rows": cached}
    if not API_KEY:
        return {"ok": False, "error": "ANTHROPIC_API_KEY is not set", "rows": []}
    cap = read_capital()
    data, err = claude_plain(
        [{"role": "user", "content": "Capital snapshot:\n" + cap}],
        "You are Hope. From this live Capital snapshot write 4 useful insights for Nick. "
        "Return ONLY a JSON array of objects: "
        '{"tone":"up|down|warn|tip","title":"short","note":"one sentence action"}. '
        "Use real numbers. No fake bills. No markdown. No sir.",
        700,
    )
    if err or not data:
        return {"ok": False, "error": err or "insight failed", "rows": load_insights_cache() or []}
    raw = extract_text(data.get("content") or [])
    rows = []
    try:
        m = re.search(r"\[.*\]", raw, re.S)
        parsed = json.loads(m.group(0) if m else raw)
        for r in parsed[:5]:
            tone = str((r or {}).get("tone") or "tip").lower()
            if tone not in ("up", "down", "warn", "tip"):
                tone = "tip"
            title = str((r or {}).get("title") or "").strip()
            note = str((r or {}).get("note") or "").strip()
            if title and note:
                rows.append({"tone": tone, "title": title[:90], "note": note[:180]})
    except Exception:
        rows = []
    if rows:
        save_insights_cache(rows)
    return {"ok": True, "cached": False, "rows": rows}
