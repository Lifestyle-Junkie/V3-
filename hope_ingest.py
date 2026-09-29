"""Generic uploaded-archive pipeline: discover, extract, interpret, validate, query."""
import base64
import csv
import hashlib
import io
import json
import os
import re
import time
import zipfile
from datetime import datetime
from pathlib import Path
DIR = Path(__file__).resolve().parent
CORPUS_DIR = DIR / "hope-uploads"
CORPUS_FILE = DIR / "hope-corpus.json"
FACTS_FILE = DIR / "hope-facts.json"
EXPORT_FILE = DIR / "hope-export.txt"
TEXT_EXTS = {".txt", ".md", ".log", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".yaml", ".yml"}
DOC_EXTS = {".pdf", ".doc", ".docx", ".rtf"}
SHEET_EXTS = {".xlsx", ".xls", ".ods"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".tif", ".tiff"}
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".ogg", ".opus", ".aac"}
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
TS_PATTERNS = [
    re.compile(r"^[\[\(]?\s*(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4})[,\sT]+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)", re.I),
    re.compile(r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)"),
]
SENDER_SPLIT = re.compile(r"^\s*(?:[\[\(].*?[\]\)]\s*)?([^:]{1,80})\s*:\s+(.*)$")
MONEY_ANY = re.compile(r"(?<!\w)(?:USD|EUR|GBP|CAD|\$|€|£)\s*([\d,]+(?:\.\d{1,2})?)|(?<!\w)([\d,]+(?:\.\d{1,2})?)\s*(?:USD|EUR|GBP)", re.I)
NUM_LABELED = re.compile(
    r"([A-Za-z][A-Za-z0-9 _/\-]{0,40}?)\s*(?:[:=\-]|\$)\s*\$?\s*([\d,]+(?:\.\d{1,2})?)"
)
LINE_AMOUNT = re.compile(
    r"^\s*([A-Za-z][A-Za-z0-9 ._-]{0,24}?)\s*:?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)\s*$",
    re.M,
)
STORE_LINE = re.compile(r"(?im)^\s*(?:store\s*name|location|site|place)\s*[:\-]\s*(.+)$")
ISO_DATE = re.compile(r"\b(20\d{2}|19\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b")
US_DATE = re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b")
TOTAL_LINE = re.compile(
    r"(?im)\b(total|grand total|net|sales|profit|revenue)\b[^\n$]{0,24}\$?\s*([\d,]+(?:\.\d{1,2})?)"
)
def _now_id(prefix="up"):
    return "%s_%s" % (prefix, datetime.now().strftime("%Y%m%d%H%M%S%f"))
def _sha(text):
    return hashlib.sha1((text or "").encode("utf-8", errors="replace")).hexdigest()[:16]
def _kind_for(name):
    ext = Path(name).suffix.lower()
    if ext in TEXT_EXTS:
        return "text" if ext not in {".csv", ".tsv", ".json"} else ext.lstrip(".")
    if ext in IMAGE_EXTS:
        return "image"
    if ext in DOC_EXTS:
        return "document"
    if ext in SHEET_EXTS:
        return "spreadsheet"
    if ext in AUDIO_EXTS:
        return "audio"
    if ext in VIDEO_EXTS:
        return "video"
    if ext == ".zip":
        return "archive"
    return "binary"
def _decode_bytes(blob):
    for enc in ("utf-8", "utf-8-sig", "utf-16", "latin-1"):
        try:
            return blob.decode(enc)
        except Exception:
            continue
    return blob.decode("utf-8", errors="replace")
def _norm_date(raw):
    s = (raw or "").strip()
    if not s:
        return None
    m = ISO_DATE.search(s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return "%04d-%02d-%02d" % (y, mo, d)
    m = US_DATE.search(s)
    if m:
        a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if y < 100:
            y += 2000 if y < 80 else 1900
        if a > 12 and b <= 12:
            mo, d = b, a
        else:
            mo, d = a, b
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return "%04d-%02d-%02d" % (y, mo, d)
    return None
def _parse_money(val):
    cleaned = re.sub(r"[^0-9.\-]", "", str(val or ""))
    try:
        return float(cleaned) if cleaned else None
    except Exception:
        return None
def load_corpus():
    if not CORPUS_FILE.exists():
        return {"uploads": [], "records": []}
    try:
        data = json.loads(CORPUS_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"uploads": [], "records": []}
        data.setdefault("uploads", [])
        data.setdefault("records", [])
        return data
    except Exception:
        return {"uploads": [], "records": []}
def save_corpus(data):
    CORPUS_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
def load_facts():
    if not FACTS_FILE.exists():
        return []
    try:
        data = json.loads(FACTS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []
def save_facts(rows):
    FACTS_FILE.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
def discover_zip(raw_bytes):
    files = []
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw_bytes))
    except Exception as e:
        return None, "Not a readable zip: %s" % e
    for info in zf.infolist():
        name = info.filename.replace("\\", "/")
        low = name.lower()
        if info.is_dir() or "/__macosx" in low or low.startswith("__macosx") or Path(name).name.startswith("."):
            continue
        try:
            blob = zf.read(info)
        except Exception:
            blob = b""
        files.append({
            "path": name,
            "basename": Path(name).name,
            "ext": Path(name).suffix.lower(),
            "kind": _kind_for(name),
            "size": len(blob),
            "bytes": blob,
        })
    return files, None
def _split_records_from_text(path, text):
    records = []
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    current = None
    idx = 0
    def flush():
        nonlocal current, idx
        if current:
            current["text"] = current.get("text", "").strip()
            records.append(current)
            current = None
    for line in lines:
        raw = line.rstrip()
        if not raw.strip():
            if current:
                current["text"] += "\n"
            continue
        ts_m = None
        for pat in TS_PATTERNS:
            ts_m = pat.search(raw)
            if ts_m:
                break
        sender, body = None, raw
        sm = SENDER_SPLIT.match(raw)
        if sm:
            sender, body = sm.group(1).strip(), sm.group(2)
            sender = re.sub(r"^[\[\(].*?[\]\)]\s*", "", sender).strip()
        if ts_m:
            flush()
            idx += 1
            date_s = _norm_date(ts_m.group(1))
            current = {
                "id": "rec_%s_%d" % (_sha(path), idx),
                "source_file": path,
                "date": date_s,
                "time": ts_m.group(2).strip() if ts_m.lastindex >= 2 else None,
                "actor": sender,
                "text": body if sender else raw,
                "raw": raw,
                "attachments": [],
            }
        elif current:
            current["text"] += "\n" + raw
        else:
            idx += 1
            records.append({
                "id": "rec_%s_%d" % (_sha(path), idx),
                "source_file": path,
                "date": _norm_date(raw),
                "time": None,
                "actor": sender,
                "text": body if sender else raw,
                "raw": raw,
                "attachments": [],
            })
    flush()
    return records
def _parse_csv_records(path, text):
    rows = []
    try:
        reader = csv.DictReader(io.StringIO(text))
        headers = reader.fieldnames or []
        for i, row in enumerate(reader, 1):
            blob = " | ".join("%s=%s" % (k, row.get(k, "")) for k in headers)
            date = None
            for k, v in row.items():
                if re.search(r"date|time|day", str(k), re.I):
                    date = _norm_date(str(v))
                    if date:
                        break
            rows.append({
                "id": "rec_%s_%d" % (_sha(path), i),
                "source_file": path,
                "date": date,
                "time": None,
                "actor": None,
                "text": blob,
                "raw": blob,
                "attachments": [],
                "fields": dict(row),
            })
    except Exception:
        return _split_records_from_text(path, text)
    return rows
def _parse_json_records(path, text):
    try:
        data = json.loads(text)
    except Exception:
        return _split_records_from_text(path, text)
    items = data if isinstance(data, list) else [data]
    out = []
    for i, item in enumerate(items, 1):
        if isinstance(item, dict):
            blob = json.dumps(item, ensure_ascii=False)
            date = None
            actor = None
            for k, v in item.items():
                lk = str(k).lower()
                if date is None and ("date" in lk or "time" in lk):
                    date = _norm_date(str(v))
                if actor is None and lk in ("from", "sender", "author", "user", "name", "actor"):
                    actor = str(v)
            out.append({
                "id": "rec_%s_%d" % (_sha(path), i),
                "source_file": path,
                "date": date,
                "time": None,
                "actor": actor,
                "text": blob,
                "raw": blob,
                "attachments": [],
                "fields": item,
            })
        else:
            out.append({
                "id": "rec_%s_%d" % (_sha(path), i),
                "source_file": path,
                "date": None,
                "time": None,
                "actor": None,
                "text": str(item),
                "raw": str(item),
                "attachments": [],
            })
    return out
def parse_file(entry):
    kind = entry["kind"]
    path = entry["path"]
    blob = entry.get("bytes") or b""
    recs = []
    if kind in ("text", "md", "log", "html", "htm", "xml", "yaml", "yml"):
        recs = _split_records_from_text(path, _decode_bytes(blob))
    elif kind in ("csv", "tsv"):
        recs = _parse_csv_records(path, _decode_bytes(blob))
    elif kind == "json":
        recs = _parse_json_records(path, _decode_bytes(blob))
    else:
        recs = [{
            "id": "file_%s" % _sha(path + str(entry.get("size"))),
            "source_file": path,
            "date": None,
            "time": None,
            "actor": None,
            "text": "[%s attachment: %s, %d bytes]" % (kind, entry["basename"], entry.get("size") or 0),
            "raw": entry["basename"],
            "attachments": [path],
            "kind": kind,
        }]
    for r in recs:
        r.setdefault("kind", kind)
        r.setdefault("attachments", [])
    return recs
def link_attachments(records, files):
    by_base = {}
    for f in files:
        by_base.setdefault(f["basename"].lower(), []).append(f["path"])
    for rec in records:
        text = (rec.get("text") or "") + " " + (rec.get("raw") or "")
        mentioned = re.findall(r"([\w.\-]+\.(?:jpg|jpeg|png|gif|webp|pdf|csv|xlsx|txt|mp3|m4a|mp4))", text, re.I)
        omitted = re.search(r"(image|audio|video|document)\s+omitted", text, re.I)
        for name in mentioned:
            for path in by_base.get(name.lower(), []):
                if path not in rec["attachments"]:
                    rec["attachments"].append(path)
        if omitted and rec.get("source_file"):
            rec["flags"] = list(set((rec.get("flags") or []) + ["unreadable_or_omitted_attachment"]))
    return records
def _heading_entity(text, actor=None):
    t = (text or "").strip()
    if not t:
        return actor
    m = STORE_LINE.search(t)
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip(" -:")[:60] or actor
    first = t.splitlines()[0].strip()
    first = re.sub(r"[\u200e\u200f]", "", first)
    if 1 <= len(first.split()) <= 4 and len(first) <= 40 and not re.search(r"\d", first):
        if not re.search(r"^(break|back|here|out|in|ok|yes|no)\b", first, re.I):
            return first
    return actor
def _local_facts_from_record(rec):
    facts = []
    text = rec.get("text") or rec.get("raw") or ""
    fields = rec.get("fields") or {}
    date = rec.get("date")
    actor = rec.get("actor")
    entity = rec.get("entity") or _heading_entity(text, actor)
    rec["entity"] = entity
    source = rec.get("source_file")
    rid = rec.get("id")
    def add(concept, value, unit=None, entity=None, ctx="", conf=0.55, method="pattern"):
        if value is None:
            return
        facts.append({
            "id": "fact_" + _sha("|".join([rid or "", str(concept), str(value), str(date), str(entity)])),
            "entity": entity or actor,
            "date": date,
            "time": rec.get("time"),
            "source": source,
            "concept": concept,
            "value": value,
            "unit": unit,
            "context": (ctx or text)[:240],
            "confidence": conf,
            "source_record": rid,
            "source_attachment": (rec.get("attachments") or [None])[0],
            "method": method,
        })
    for k, v in fields.items():
        n = _parse_money(v)
        if n is not None and re.search(r"[\d]", str(v)):
            unit = "currency" if "$" in str(v) or "€" in str(v) or "£" in str(v) else "number"
            add(str(k).strip() or "value", n, unit, entity, "%s=%s" % (k, v), 0.7, "field")
        elif str(v).strip():
            if re.search(r"date|time", str(k), re.I):
                continue
            add(str(k).strip(), str(v).strip(), None, entity, "%s=%s" % (k, v), 0.5, "field")
    for m in LINE_AMOUNT.finditer(text):
        label = re.sub(r"\s+", " ", m.group(1)).strip(" :-")
        n = _parse_money(m.group(2))
        if n is None or len(label) < 2:
            continue
        add(label, n, "currency" if "$" in m.group(0) else "number", entity, m.group(0), 0.7, "line")
    for m in NUM_LABELED.finditer(text):
        label = re.sub(r"\s+", " ", m.group(1)).strip(" :-")
        n = _parse_money(m.group(2))
        if n is None or len(label) < 2:
            continue
        unit = "currency" if "$" in m.group(0) else "number"
        add(label, n, unit, entity, m.group(0), 0.62, "labeled")
    for m in MONEY_ANY.finditer(text):
        raw = m.group(1) or m.group(2)
        n = _parse_money(raw)
        if n is None:
            continue
        window = text[max(0, m.start() - 40):m.end() + 20]
        label = "amount"
        pref = re.search(r"([A-Za-z][A-Za-z0-9 _/\-]{1,30})\s*$", text[:m.start()])
        if pref:
            label = pref.group(1).strip()
        add(label, n, "currency", entity, window.strip(), 0.5, "amount")
    if not facts and text.strip():
        add("note", text.strip()[:300], None, actor, text[:240], 0.25, "text")
    return facts
def interpret_records(records, use_model=False):
    facts = []
    for rec in records:
        facts.extend(_local_facts_from_record(rec))
    return facts
def validate_facts(facts):
    out = []
    seen = set()
    for f in facts:
        if f.get("value") is None or f.get("value") == "":
            continue
        key = (
            str(f.get("entity") or "").lower(),
            str(f.get("date") or ""),
            str(f.get("concept") or "").lower(),
            str(f.get("value")),
            str(f.get("source_record") or ""),
        )
        if key in seen:
            f = dict(f)
            f["duplicate"] = True
            f["confidence"] = min(float(f.get("confidence") or 0), 0.35)
        seen.add(key)
        try:
            f["confidence"] = max(0.0, min(1.0, float(f.get("confidence") or 0.4)))
        except Exception:
            f["confidence"] = 0.4
        out.append(f)
    return out
def ingest_zip_bytes(raw_bytes, name="upload.zip"):
    files, err = discover_zip(raw_bytes)
    if err:
        return {"ok": False, "error": err}
    upload_id = _now_id("zip")
    dest = CORPUS_DIR / upload_id
    dest.mkdir(parents=True, exist_ok=True)
    manifest = []
    records = []
    for f in files:
        safe = re.sub(r"[^A-Za-z0-9._/-]+", "_", f["path"])
        outp = dest / safe
        outp.parent.mkdir(parents=True, exist_ok=True)
        try:
            outp.write_bytes(f.get("bytes") or b"")
        except Exception:
            pass
        manifest.append({k: f[k] for k in ("path", "basename", "ext", "kind", "size")})
        records.extend(parse_file(f))
    raw_parts = []
    for f in files:
        if f.get("kind") in ("text", "md", "log", "html", "htm", "xml", "yaml", "yml", "csv", "tsv", "json"):
            body = _decode_bytes(f.get("bytes") or b"")
            raw_parts.append("===== %s =====\n%s" % (f.get("path"), body))
    if raw_parts:
        EXPORT_FILE.write_text("\n\n".join(raw_parts), encoding="utf-8")
    records = link_attachments(records, files)
    facts = validate_facts(interpret_records(records, use_model=False))
    corpus = load_corpus()
    corpus["uploads"].append({
        "id": upload_id,
        "name": name,
        "ts": time.time(),
        "files": manifest,
        "record_count": len(records),
        "fact_count": len(facts),
    })
    slim = []
    for r in records:
        slim.append({k: r[k] for k in r if k != "fields" or True})
        if "fields" in slim[-1] and len(json.dumps(slim[-1]["fields"])) > 2000:
            slim[-1]["fields"] = {k: str(v)[:200] for k, v in slim[-1]["fields"].items()}
    corpus["records"] = [r for r in corpus["records"] if r.get("upload_id") != upload_id]
    for r in slim:
        r["upload_id"] = upload_id
        corpus["records"].append(r)
    save_corpus(corpus)
    existing = [f for f in load_facts() if f.get("upload_id") != upload_id]
    for f in facts:
        f["upload_id"] = upload_id
    save_facts(existing + facts)
    kinds = {}
    for f in manifest:
        kinds[f["kind"]] = kinds.get(f["kind"], 0) + 1
    return {
        "ok": True,
        "upload_id": upload_id,
        "files": len(manifest),
        "kinds": kinds,
        "records": len(records),
        "facts": len(facts),
        "note": "Archive ingested. Ask questions; Hope will query stored facts, not raw keyword hits.",
    }
def ingest_zip_b64(b64, name="upload.zip"):
    try:
        raw = base64.b64decode(b64)
    except Exception:
        return {"ok": False, "error": "bad base64"}
    return ingest_zip_bytes(raw, name)
def load_export():
    if not EXPORT_FILE.exists():
        return ""
    try:
        return EXPORT_FILE.read_text(encoding="utf-8")
    except Exception:
        return ""
def _split_raw_blocks(text):
    if not text:
        return []
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks = []
    cur = []
    cur_date = None
    for line in lines:
        ts_m = None
        for pat in TS_PATTERNS:
            ts_m = pat.search(line)
            if ts_m:
                break
        if ts_m:
            if cur:
                blocks.append({"date": cur_date, "text": "\n".join(cur).strip()})
            cur = [line]
            cur_date = _norm_date(ts_m.group(1))
        else:
            cur.append(line)
    if cur:
        blocks.append({"date": cur_date, "text": "\n".join(cur).strip()})
    return [b for b in blocks if b.get("text")]
def _stop_words():
    return {
        "what", "was", "were", "the", "and", "for", "how", "much", "many",
        "show", "tell", "about", "from", "with", "that", "this", "have",
        "all", "far", "so", "only", "just", "any", "get", "give", "please",
        "need", "want", "does", "did", "can", "could", "would", "should",
        "into", "each", "every", "daily", "ones", "those", "these",
        "full", "entire", "whole", "month", "monthly",
    }
def _expand_token(t):
    t = (t or "").lower()
    out = {t}
    if t.endswith("s") and len(t) > 4:
        out.add(t[:-1])
    else:
        out.add(t + "s")
    aliases = {
        "profit": ["profits", "total", "totals", "sales", "revenue"],
        "profits": ["profit", "total", "totals", "sales", "revenue"],
        "store": ["stores", "location", "site", "place"],
        "stores": ["store", "location", "site", "place"],
        "sale": ["sales", "total", "totals"],
        "sales": ["sale", "total", "totals"],
    }
    out.update(aliases.get(t, []))
    return out
def _query_tokens(question):
    ql = (question or "").lower()
    raw = [t for t in re.findall(r"[a-z0-9]{3,}", ql) if t not in _stop_words()]
    return [t for t in raw if t not in _month_tokens()]
def _token_score(blob, tokens):
    blob = (blob or "").lower()
    if not tokens:
        return 1
    score = 0
    for t in tokens:
        variants = _expand_token(t)
        if any(v in blob for v in variants):
            score += 1
    return score
def _want_latest_only(question):
    ql = (question or "").lower()
    return bool(re.search(
        r"\b(latest (file|upload|zip)|this upload|this zip|only this|just the latest|newest upload)\b",
        ql,
    ))
def _month_from_text(q):
    names = {
        "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
        "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
        "august": 8, "aug": 8, "september": 9, "sept": 9, "sep": 9,
        "october": 10, "oct": 10, "november": 11, "nov": 11, "december": 12, "dec": 12,
    }
    ql = (q or "").lower()
    for name, num in names.items():
        if re.search(r"\b" + name + r"\b", ql):
            return num
    m = re.search(r"\b(20\d{2})-(\d{1,2})\b", ql)
    if m:
        return int(m.group(2))
    return None
def _month_tokens():
    return {
        "jan", "january", "feb", "february", "mar", "march", "apr", "april",
        "may", "jun", "june", "jul", "july", "aug", "august", "sep", "sept",
        "september", "oct", "october", "nov", "november", "dec", "december",
    }
def _want_month_rollup(q):
    ql = (q or "").lower()
    if not _month_from_text(q):
        return False
    return bool(re.search(
        r"\b(month|monthly|all days|every day|daily|full|entire|whole|all stores|total|totals|sales|profit|revenue|breakdown|each day)\b",
        ql,
    )) or True
def _day_amount(blob):
    labeled = []
    for m in TOTAL_LINE.finditer(blob or ""):
        n = _parse_money(m.group(2))
        if n is not None:
            labeled.append(n)
    if labeled:
        return labeled[-1], "labeled_total"
    amounts = []
    for m in MONEY_ANY.finditer(blob or ""):
        n = _parse_money(m.group(1) or m.group(2))
        if n is not None:
            amounts.append(n)
    if amounts:
        return max(amounts), "largest_dollar"
    return None, "none"
def month_day_rollup(question):
    month = _month_from_text(question)
    if not month:
        return ""
    text = load_export() or ""
    by_day = {}
    for b in _split_raw_blocks(text):
        d = b.get("date")
        if not d:
            continue
        try:
            if int(str(d)[5:7]) != month:
                continue
        except Exception:
            continue
        by_day.setdefault(d, []).append(b.get("text") or "")
    if not by_day:
        return "MONTH ROLLUP: no dated blocks for month %d in the full export." % month
    years = sorted({int(d[:4]) for d in by_day})
    lines = [
        "MONTH ROLLUP (full export, every dated block, not a sample):",
        "month=%02d years=%s days_present=%d" % (month, ",".join(str(y) for y in years), len(by_day)),
    ]
    running = 0.0
    scored = 0
    for day in sorted(by_day):
        blob = "\n".join(by_day[day])
        amt, how = _day_amount(blob)
        if amt is None:
            lines.append("%s | no $ found | blocks=%d | %s" % (day, len(by_day[day]), how))
        else:
            running += amt
            scored += 1
            lines.append("%s | $%s | blocks=%d | %s" % (day, "{:,.2f}".format(amt), len(by_day[day]), how))
    first, last = min(by_day), max(by_day)
    y, m = int(first[:4]), int(first[5:7])
    import calendar
    last_n = calendar.monthrange(y, m)[1]
    expected = ["%04d-%02d-%02d" % (y, m, d) for d in range(1, last_n + 1)]
    missing = [d for d in expected if d not in by_day]
    lines.append("days_with_dollar=%d running_sum=$%s" % (scored, "{:,.2f}".format(running)))
    lines.append("missing_days_in_%s: %s" % (first[:7], ", ".join(missing) if missing else "none"))
    lines.append("Do not invent amounts for missing days. running_sum is only days that had a $ figure.")
    return "\n".join(lines)
def archive_inventory(question=""):
    text = load_export() or ""
    records = (load_corpus().get("records") or [])
    tokens = _query_tokens(question)
    counts = {}
    for t in tokens:
        n = 0
        for v in _expand_token(t):
            n = max(n, len(re.findall(re.escape(v), text, re.I)))
        counts[t] = n
    dates = []
    for r in records:
        if r.get("date"):
            dates.append(str(r["date"]))
    for b in _split_raw_blocks(text):
        if b.get("date"):
            dates.append(str(b["date"]))
    headings = {}
    for b in _split_raw_blocks(text):
        first = (b.get("text") or "").splitlines()[0] if (b.get("text") or "").strip() else ""
        first = re.sub(r"^\[.*?\]\s*[^:]{0,80}:\s*", "", first).strip()
        first = re.sub(r"[\u200e\u200f]", "", first)
        if 1 <= len(first.split()) <= 4 and len(first) <= 40 and not re.search(r"\d", first):
            if not re.search(r"^(break|back|here|out|in|ok|yes|no|image|audio|video)\b", first, re.I):
                headings[first] = headings.get(first, 0) + 1
    dates = sorted(set(dates))
    n_up = len(load_corpus().get("uploads") or [])
    d0 = dates[0] if dates else "?"
    d1 = dates[-1] if dates else "?"
    lines = [
        "FULL FILE SCAN (not a sample):",
        "chars=%d records=%d uploads=%d" % (len(text), len(records), n_up),
        "date_range=%s .. %s" % (d0, d1),
    ]
    if counts:
        lines.append("query token hits in full text: " + ", ".join("%s=%d" % (k, v) for k, v in counts.items()))
    if headings:
        top = sorted(headings.items(), key=lambda x: -x[1])[:30]
        lines.append("recurring short headings: " + "; ".join("%s (%d)" % (k, v) for k, v in top))
    return "\n".join(lines)
def search_raw_export(question, limit=80, month_all=False):
    text = load_export()
    if not text:
        return []
    month = _month_from_text(question)
    tokens = _query_tokens(question)
    scored = []
    for b in _split_raw_blocks(text):
        blob = (b.get("text") or "").lower()
        d = b.get("date")
        if month and d:
            try:
                if int(str(d)[5:7]) != month:
                    continue
            except Exception:
                pass
        elif month and not d:
            continue
        s = _token_score(blob, tokens)
        if not month_all and tokens and s <= 0:
            continue
        scored.append((s if s else 1, b))
    scored.sort(key=lambda x: -x[0])
    if month_all:
        return [b for s, b in scored]
    return [b for s, b in scored[:limit]]
def _record_blob(r):
    return " ".join(str(r.get(k) or "") for k in ("text", "raw", "actor", "entity", "source_file")).lower()
def query_facts(question, limit=40):
    q = (question or "").strip()
    if not q:
        return "Ask a question about an uploaded archive."
    facts = load_facts()
    corpus = load_corpus()
    records = corpus.get("records") or []
    uploads = corpus.get("uploads") or []
    if not facts and not records and not load_export():
        return "No uploaded archive on file. Attach a zip first."
    latest_only = _want_latest_only(q)
    latest = uploads[-1]["id"] if uploads else None
    skipped = 0
    if latest_only and latest:
        records = [r for r in records if r.get("upload_id") == latest]
        facts = [f for f in facts if f.get("upload_id") == latest]
        skipped = max(0, len(uploads) - 1)
    month = _month_from_text(q)
    rollup = month_day_rollup(q) if month else ""
    if month:
        lines = [archive_inventory(q), "", rollup, ""]
        if latest_only and skipped:
            lines.insert(2, "Note: %d older upload(s) were excluded because you asked for the latest file only." % skipped)
        lines.append("Use MONTH ROLLUP as the month table. Missing days are absent from the file, not $0.")
        return "\n".join(lines)
    need = _query_tokens(q)
    try:
        cap = max(1, min(int(limit or 40), 200))
    except Exception:
        cap = 40
    raw_hits = search_raw_export(q, cap, month_all=False)
    rec_hits = []
    for r in records:
        blob = _record_blob(r)
        s = _token_score(blob, need)
        if need and s <= 0:
            continue
        rec_hits.append((s, r))
    rec_hits.sort(key=lambda x: -x[0])
    rec_hits = [r for s, r in rec_hits]
    seen_txt = set()
    source_hits = []
    for b in raw_hits:
        key = (b.get("date"), (b.get("text") or "")[:180])
        if key in seen_txt:
            continue
        seen_txt.add(key)
        source_hits.append(b)
    for r in rec_hits:
        body = r.get("text") or r.get("raw") or ""
        key = (r.get("date"), body[:180])
        if key in seen_txt:
            continue
        seen_txt.add(key)
        source_hits.append({"date": r.get("date"), "text": body, "upload_id": r.get("upload_id")})
    if not source_hits:
        return archive_inventory(q) + "\nNo matching record blocks for %r. Use the FULL FILE SCAN counts above — a zero token hit means the word is not in the file." % q
    by_day = {}
    for r in source_hits:
        by_day.setdefault(r.get("date") or "unknown", []).append(r)
    scope = "latest upload only" if latest_only else "all uploads"
    lines = [
        archive_inventory(q),
        "",
        "Query: %s" % q,
        "Archive scope: %s (%d upload(s) on file)" % (scope, len(uploads) or 1),
        "Matching blocks: %d across %d day(s): %s" % (
            len(source_hits), len(by_day), ", ".join(sorted(by_day))),
        "",
    ]
    shown = 0
    for day in sorted(by_day):
        lines.append("## %s (%d blocks)" % (day, len(by_day[day])))
        for r in by_day[day]:
            body = (r.get("text") or "").strip()
            if len(body) > 2000:
                body = body[:2000] + " …"
            lines.append(body)
            lines.append("")
            shown += 1
            if shown >= cap:
                lines.append("… truncated at %d blocks. Narrow the question." % cap)
                return "\n".join(lines)
    return "\n".join(lines)
