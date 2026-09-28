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
NUM_LABELED = re.compile(r"([A-Za-z][A-Za-z0-9 _/\-]{1,40}?)\s*[:=\-]\s*\$?\s*([\d,]+(?:\.\d{1,2})?)")
ISO_DATE = re.compile(r"\b(20\d{2}|19\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b")
US_DATE = re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b")


def _now_id(prefix="up"):
    return "%s_%s" % (prefix, datetime.now().strftime("%Y%m%d%H%M%S"))


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


def _local_facts_from_record(rec):
    facts = []
    text = rec.get("text") or rec.get("raw") or ""
    fields = rec.get("fields") or {}
    date = rec.get("date")
    actor = rec.get("actor")
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
            add(str(k).strip() or "value", n, unit, actor, "%s=%s" % (k, v), 0.7, "field")
        elif str(v).strip():
            if re.search(r"date|time", str(k), re.I):
                continue
            add(str(k).strip(), str(v).strip(), None, actor, "%s=%s" % (k, v), 0.5, "field")

    for m in NUM_LABELED.finditer(text):
        label = re.sub(r"\s+", " ", m.group(1)).strip(" :-")
        n = _parse_money(m.group(2))
        if n is None or len(label) < 2:
            continue
        unit = "currency" if "$" in m.group(0) else "number"
        add(label, n, unit, actor, m.group(0), 0.62, "labeled")

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
        add(label, n, "currency", actor, window.strip(), 0.5, "amount")

    if not facts and text.strip():
        add("note", text.strip()[:300], None, actor, text[:240], 0.25, "text")
    return facts


def interpret_records(records, use_model=False):
    facts = []
    for rec in records:
        facts.extend(_local_facts_from_record(rec))
    if use_model:
        try:
            from hope_store import claude_plain
            sample = records[:12]
            payload = json.dumps([{
                "id": r.get("id"),
                "date": r.get("date"),
                "actor": r.get("actor"),
                "text": (r.get("text") or "")[:400],
            } for r in sample], ensure_ascii=False)
            data, err = claude_plain(
                [{"role": "user", "content": payload}],
                "Extract generic facts from these records. Return ONLY JSON array of "
                '{"source_record","entity","date","concept","value","unit","confidence","context"}. '
                "Discover concept names from the text. Do not invent missing numbers. "
                "Do not assume a business domain.",
                900,
            )
            if not err and data:
                raw = ""
                for b in data.get("content") or []:
                    if isinstance(b, dict) and b.get("type") == "text":
                        raw += b.get("text") or ""
                m = re.search(r"\[.*\]", raw, re.S)
                extra = json.loads(m.group(0) if m else raw)
                for f in extra:
                    if not isinstance(f, dict):
                        continue
                    facts.append({
                        "id": "fact_" + _sha(json.dumps(f, sort_keys=True)),
                        "entity": f.get("entity"),
                        "date": f.get("date"),
                        "time": None,
                        "source": None,
                        "concept": f.get("concept") or "value",
                        "value": f.get("value"),
                        "unit": f.get("unit"),
                        "context": str(f.get("context") or "")[:240],
                        "confidence": float(f.get("confidence") or 0.45),
                        "source_record": f.get("source_record"),
                        "source_attachment": None,
                        "method": "model",
                    })
        except Exception:
            pass
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
    by_rec = {}
    for f in out:
        by_rec.setdefault(f.get("source_record"), []).append(f)
    for rec_id, group in by_rec.items():
        nums = [g for g in group if isinstance(g.get("value"), (int, float))]
        if len(nums) < 2:
            continue
        vals = [float(g["value"]) for g in nums]
        mx = max(vals)
        rest = sum(v for v in vals if v != mx)
        if mx > 0 and abs(rest - mx) / max(mx, 1) < 0.02 and rest > 0:
            for g in nums:
                if float(g["value"]) == mx:
                    g["role_hint"] = "possible_total"
                else:
                    g["role_hint"] = "possible_component"
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
        item = {k: r[k] for k in r}
        if "fields" in item and len(json.dumps(item["fields"])) > 2000:
            item["fields"] = {k: str(v)[:200] for k, v in item["fields"].items()}
        slim.append(item)
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


def query_facts(question, limit=40):
    q = (question or "").strip()
    if not q:
        return "Ask a question about an uploaded archive."
    facts = load_facts()
    records = load_corpus().get("records") or []
    if not facts and not records:
        return "No uploaded archive on file. Attach a zip first."
    ql = q.lower()
    month = _month_from_text(q)
    tokens = [t for t in re.findall(r"[a-z0-9]{3,}", ql) if t not in {
        "what", "was", "were", "the", "and", "for", "how", "much", "many",
        "show", "tell", "about", "from", "with", "that", "this", "have",
    }]

    def score_fact(f):
        s = 0
        blob = " ".join(str(f.get(k) or "") for k in ("entity", "concept", "context", "source")).lower()
        for t in tokens:
            if t in blob:
                s += 2
        if month and f.get("date"):
            try:
                if int(str(f["date"])[5:7]) == month:
                    s += 3
                else:
                    s -= 2
            except Exception:
                pass
        s += float(f.get("confidence") or 0)
        if f.get("duplicate"):
            s -= 1
        return s

    ranked = sorted(facts, key=score_fact, reverse=True)
    picked = [f for f in ranked if score_fact(f) > 0][: max(1, min(int(limit or 40), 80))]
    if not picked:
        rec_hits = []
        for r in records:
            blob = ((r.get("text") or "") + " " + str(r.get("actor") or "")).lower()
            if tokens and not any(t in blob for t in tokens):
                continue
            if month and r.get("date"):
                try:
                    if int(str(r["date"])[5:7]) != month:
                        continue
                except Exception:
                    pass
            rec_hits.append(r)
            if len(rec_hits) >= 20:
                break
        lines = ["No high-confidence facts matched. Nearby records (not assumed totals):"]
        for r in rec_hits:
            lines.append("- %s | %s | %s | %s" % (
                r.get("date") or "?", r.get("actor") or "?",
                (r.get("text") or "")[:160],
                ",".join(r.get("attachments") or []) or "no-attachment",
            ))
        if len(rec_hits) == 0:
            return "No matching facts or records. Re-upload the archive if this is a new file."
        return "\n".join(lines)

    numeric = [f for f in picked if isinstance(f.get("value"), (int, float))]
    lines = [
        "Query: %s" % q,
        "Matched facts: %d (showing %d). Values are only those extracted as facts, not raw keyword hits." % (
            len([f for f in ranked if score_fact(f) > 0]), len(picked)),
    ]
    if numeric:
        concepts = {}
        for f in numeric:
            concepts.setdefault(str(f.get("concept") or "value"), []).append(float(f["value"]))
        lines.append("Numeric concepts found:")
        for c, vals in concepts.items():
            lines.append("  - %s: n=%d sum=%s last=%s" % (
                c, len(vals), "{:,.2f}".format(sum(vals)), "{:,.2f}".format(vals[-1])))
    lines.append("")
    for f in picked[:25]:
        lines.append(
            "%s | %s | %s=%s%s | entity=%s | rec=%s | conf=%.2f | method=%s%s"
            % (
                f.get("date") or "?",
                f.get("source") or "?",
                f.get("concept"),
                f.get("value"),
                (" " + f["unit"]) if f.get("unit") else "",
                f.get("entity") or "?",
                f.get("source_record") or "?",
                float(f.get("confidence") or 0),
                f.get("method") or "?",
                " | " + f["role_hint"] if f.get("role_hint") else "",
            )
        )
        if f.get("context"):
            lines.append("    evidence: " + str(f["context"])[:180])
        if f.get("source_attachment"):
            lines.append("    attachment: " + f["source_attachment"])
    return "\n".join(lines)
