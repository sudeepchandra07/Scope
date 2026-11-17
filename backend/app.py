import os, io, re, sys, time, json, uuid, shutil, hashlib, sqlite3, secrets, subprocess, tempfile, threading, datetime as dt
from pathlib import Path
from functools import wraps
import numpy as np, pandas as pd, joblib
from flask import Flask, request, jsonify, g, send_file
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
import ml
import cost as costmod

BASE = Path(__file__).resolve().parent.parent
# Data lives OUTSIDE the code folder (your home directory) so re-unzipping a new version never loses history.
if os.environ.get("STORAGE_DIR"): STORE = Path(os.environ["STORAGE_DIR"])
else:
    STORE = Path.home() / ".perovskite_screening"
    if not (STORE / "app.db").exists() and (BASE / "storage" / "app.db").exists():   # one-time migration of an older ./storage folder
        shutil.copytree(BASE / "storage", STORE, dirs_exist_ok=True)
for d in ("uploads", "models"): (STORE / d).mkdir(parents=True, exist_ok=True)
DB = STORE / "app.db"; KEYFILE = STORE / "secret.key"
if not KEYFILE.exists(): KEYFILE.write_text(secrets.token_hex(32))
SER = URLSafeTimedSerializer(os.environ.get("SECRET_KEY", KEYFILE.read_text()))
import hmac
ADMIN_USER = os.environ.get("ADMIN_USERNAME", "admin@123")
ADMIN_HASH = generate_password_hash(os.environ.get("ADMIN_PASSWORD", "CRYSTAL"))
SHARED_HASH = generate_password_hash(os.environ.get("APP_SHARED_PASSWORD", "NGIT"))
ALLOWED = {".csv", ".xlsx", ".xls"}; SUMMARY_VER = 5

# ---- precursor prices for the cost ESTIMATE: built-in estimates always apply; this CSV (Admin page) only OVERRIDES elements, and is optional ----
PRICE_FILE = STORE / "precursor_prices.csv"
if not PRICE_FILE.exists(): costmod.write_csv(PRICE_FILE, [])        # header only = no overrides; the built-in estimates in cost.py are used
_TBL = {"key": None, "t": None}; _TBL_LOCK = threading.Lock()
def get_table():
    """Parsed price table; re-read only when the file changed (so editing the CSV by hand also works)."""
    try: st = PRICE_FILE.stat(); key = (st.st_mtime_ns, st.st_size)
    except OSError: key = None
    with _TBL_LOCK:
        if _TBL["t"] is None or _TBL["key"] != key:
            try: t = costmod.PriceTable(costmod.read_rows(PRICE_FILE) if key else [])
            except Exception as e:                                    # unreadable file -> empty table + a visible error, never a crash
                t = costmod.PriceTable([]); t.issues.append({"row": None, "level": "error", "message": f"precursor_prices.csv could not be read: {e}"})
            _TBL.update(key=key, t=t)
        return _TBL["t"]

app = Flask(__name__, static_folder=str(BASE / "frontend"), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 15 * 1024 * 1024

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, roll_number TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT);
CREATE TABLE IF NOT EXISTS datasets(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), filename TEXT, stored_path TEXT,
 upload_date TEXT, row_count INT, column_count INT, target_column TEXT, formula_column TEXT, feature_list TEXT,
 analysis_json TEXT, train_json TEXT, summary_json TEXT, status TEXT DEFAULT 'uploaded', content_hash TEXT);
CREATE TABLE IF NOT EXISTS models(id INTEGER PRIMARY KEY, dataset_id INT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE, model_type TEXT, is_primary INT,
 training_date TEXT, R2 REAL, MAE REAL, RMSE REAL, model_path TEXT, scaler_path TEXT, params_json TEXT);
CREATE TABLE IF NOT EXISTS screening_results(id INTEGER PRIMARY KEY, dataset_id INT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE, row_index INT, formula TEXT,
 predicted_log_kstar REAL, predicted_kstar REAL, mahalanobis_distance REAL, applicability_domain TEXT, ad_result TEXT, ehull REAL, ehull_result TEXT,
 cost REAL, cost_result TEXT, orr_value REAL, orr_result TEXT, final_result TEXT, failure_reason TEXT, detail_json TEXT);
CREATE TABLE IF NOT EXISTS export_history(id INTEGER PRIMARY KEY, dataset_id INT, user_id INT, kind TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY, user_id INT, roll TEXT, type TEXT, detail TEXT, status TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS predictions(id INTEGER PRIMARY KEY, user_id INT, roll TEXT, dataset_id INT, dataset_name TEXT, model TEXT, formula TEXT, inputs_json TEXT, result_json TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS presence(bucket TEXT, user_id INT, PRIMARY KEY(bucket,user_id));
CREATE INDEX IF NOT EXISTS ix_act ON activity(id DESC);
CREATE INDEX IF NOT EXISTS ix_sr ON screening_results(dataset_id);
CREATE TABLE IF NOT EXISTS screening_cache(dataset_id INT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE, model TEXT, summary TEXT, rows TEXT, PRIMARY KEY(dataset_id, model));
"""
def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB); g.db.row_factory = sqlite3.Row; g.db.execute("PRAGMA foreign_keys=ON")
    return g.db
@app.teardown_appcontext
def _close(_):
    d = g.pop("db", None)
    if d: d.close()
with sqlite3.connect(DB) as _c:
    _c.executescript(SCHEMA)
    for tbl, cols in (("users", (("last_login", "TEXT"), ("last_seen", "TEXT"), ("online", "INT DEFAULT 0"))), ("screening_results", (("rank", "INT"), ("score", "REAL"), ("tier", "TEXT"))), ("datasets", (("content_hash", "TEXT"), ("ann_json", "TEXT")))):
        have = {r[1] for r in _c.execute(f"PRAGMA table_info({tbl})")}
        for col, typ in cols:
            if col not in have: _c.execute(f"ALTER TABLE {tbl} ADD COLUMN {col} {typ}")

def now(): return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
def presence(uid):
    t = dt.datetime.now(); b = t.replace(minute=t.minute // 5 * 5, second=0, microsecond=0).strftime("%Y-%m-%d %H:%M")
    db().execute("INSERT OR IGNORE INTO presence(bucket,user_id) VALUES(?,?)", (b, uid))
def log(typ, detail="", status="success", uid=None, roll=None):
    if getattr(g, "viewonly", False): return          # an admin looking at a user's account leaves no trace in that user's history
    try:
        uid = uid if uid is not None else getattr(g, "uid", None); roll = roll or getattr(g, "roll", None)
        db().execute("INSERT INTO activity(user_id,roll,type,detail,status,created_at) VALUES(?,?,?,?,?,?)", (uid, roll, typ, str(detail)[:300], status, now())); db().commit()
    except Exception as e: app.logger.warning("activity log failed: %s", e)
def err(msg, code=400, **kw): return jsonify({"error": msg, **kw}), code
def jd(x): return json.dumps(x, default=lambda o: o.item() if hasattr(o, "item") else str(o))
def dpath(r): return STORE / "uploads" / str(r["user_id"]) / Path(r["stored_path"]).name   # resolved from our own storage dir (portable)

def fkey(s):
    """Canonical formula key: 'La0.6Sr0.4Co1O3' == 'La0.6Sr0.4CoO3'."""
    t = re.sub(r"\s+", "", str(s))
    if t and re.fullmatch(r"(?:[A-Z][a-z]?\d*\.?\d*)+", t):
        acc = {}
        for el, n in re.findall(r"([A-Z][a-z]?)(\d*\.?\d*)", t): acc[el] = acc.get(el, 0) + (float(n) if n else 1.0)
        return "".join(f"{k}{round(v, 4):g}" for k, v in sorted(acc.items()))
    return t.lower()

VIEW_MAX_AGE = 8 * 3600
def auth(fn):
    @wraps(fn)
    def w(*a, **k):
        h = request.headers.get("Authorization", "")
        g.viewonly = False
        try:
            t, issued = SER.loads(h.replace("Bearer ", "", 1), max_age=7 * 86400, return_timestamp=True)
            role = t.get("role", "user")
            if role == "admin_view":                                   # admin opened a user's account: read-only, short-lived
                if time.time() - issued.timestamp() > VIEW_MAX_AGE: return err("Please log in again.", 401)
                if request.method != "GET": return err("Admin view is read-only - nothing can be changed in a user's account.", 403)
                g.viewonly = True
            elif role != "user": return err("Admin accounts cannot use user APIs.", 403)
            g.uid = t["uid"]
        except (BadSignature, SignatureExpired, KeyError): return err("Please log in again.", 401)
        u = db().execute("SELECT roll_number FROM users WHERE id=?", (g.uid,)).fetchone()
        if not u: return err("Unknown user.", 401)
        g.roll = u["roll_number"]
        if not g.viewonly: db().execute("UPDATE users SET last_seen=? WHERE id=?", (now(), g.uid)); presence(g.uid); db().commit()   # admin views never make a user look "active"
        return fn(*a, **k)
    return w
def own(did):
    r = db().execute("SELECT * FROM datasets WHERE id=? AND user_id=?", (did, g.uid)).fetchone()   # ownership check on every dataset request
    if not r: raise LookupError
    return r
@app.errorhandler(LookupError)
def _nf(_): return err("Dataset not found.", 404)
@app.errorhandler(413)
def _big(_): return err("File too large (max 15 MB).", 413)
@app.errorhandler(Exception)
def _any(e):
    if hasattr(e, "code") and isinstance(e.code, int): return err(getattr(e, "description", str(e)), e.code)
    app.logger.exception(e); return err(f"Server error: {e}", 500)

def read_file(path):
    p = str(path)
    if p.lower().endswith(".csv"): raw = pd.read_csv(p)
    else:
        sheets = pd.read_excel(p, sheet_name=None); raw = max(sheets.values(), key=lambda d: d.size) if sheets else pd.DataFrame()
    return ml.load_df(raw)
def chash(df): return hashlib.sha256(df.to_csv(index=False).encode()).hexdigest()
def labels(an): return {e["column"]: e["label"] for e in an["descriptors"] if e["column"]}

def drop_dataset(r):
    dpath(r).unlink(missing_ok=True); shutil.rmtree(STORE / "models" / str(r["id"]), ignore_errors=True)
    db().execute("DELETE FROM datasets WHERE id=?", (r["id"],))

def dedupe_user():
    """Make sure each distinct dataset appears once in the history (keeps the screened / newest copy)."""
    c = db(); groups = {}
    for r in c.execute("SELECT * FROM datasets WHERE user_id=? ORDER BY id", (g.uid,)).fetchall():
        h = r["content_hash"]
        if not h:
            try: h = chash(read_file(dpath(r))[0]); c.execute("UPDATE datasets SET content_hash=? WHERE id=?", (h, r["id"]))
            except Exception: continue
        groups.setdefault(h, []).append(r)
    for rs in groups.values():
        if len(rs) > 1:
            keep = max(rs, key=lambda r: (r["status"] == "screened", r["id"]))
            for r in rs:
                if r["id"] != keep["id"]: drop_dataset(r)
    c.commit()

# ---------------- auth ----------------
@app.post("/api/login")
def login():
    b = request.get_json(silent=True) or {}
    roll = str(b.get("roll_number", "")).strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{6,15}", roll): return err("Enter a valid roll number (6-15 letters/digits, e.g. 23CSE001).")
    if not check_password_hash(SHARED_HASH, str(b.get("password", ""))): log("login", "Wrong password", "failed", roll=roll); return err("Invalid roll number or password.", 401)
    c = db(); u = c.execute("SELECT * FROM users WHERE roll_number=?", (roll,)).fetchone()
    if not u:
        c.execute("INSERT INTO users(roll_number,password_hash,created_at) VALUES(?,?,?)", (roll, generate_password_hash(str(b["password"])), now())); c.commit()
        u = c.execute("SELECT * FROM users WHERE roll_number=?", (roll,)).fetchone()
    c.execute("UPDATE users SET last_login=?, last_seen=?, online=1 WHERE id=?", (now(), now(), u["id"])); c.commit(); presence(u["id"]); c.commit()
    log("login", "Logged in", "success", uid=u["id"], roll=roll)
    return jsonify({"token": SER.dumps({"uid": u["id"], "role": "user"}), "roll_number": roll})

@app.post("/api/logout")
@auth
def logout_api():
    db().execute("UPDATE users SET online=0 WHERE id=?", (g.uid,)); db().commit(); log("logout", "Logged out"); return jsonify({"ok": True})

@app.get("/api/ping")
@auth
def ping(): return jsonify({"ok": True})

def admin_required(fn):
    @wraps(fn)
    def w(*a, **k):
        h = request.headers.get("Authorization", "")
        try: t = SER.loads(h.replace("Bearer ", "", 1), max_age=8 * 3600)
        except (BadSignature, SignatureExpired): return err("Please log in again.", 401)
        if t.get("role") != "admin": return err("Admin access required.", 403)
        g.admin = True; return fn(*a, **k)
    return w

@app.post("/api/admin/login")
def admin_login():
    b = request.get_json(silent=True) or {}
    u_ok = hmac.compare_digest(str(b.get("username", "")).encode(), ADMIN_USER.encode())
    p_ok = check_password_hash(ADMIN_HASH, str(b.get("password", "")))
    if not (u_ok and p_ok): return err("Invalid admin username or password.", 401)
    return jsonify({"token": SER.dumps({"role": "admin"}), "role": "admin"})


@app.get("/api/admin/snapshot")
@admin_required
def admin_snapshot():
    c = db(); t = dt.datetime.now(); today = t.strftime("%Y-%m-%d")
    def live(r):
        try: return bool(r["online"]) and (t - dt.datetime.strptime(r["last_seen"], "%Y-%m-%d %H:%M:%S")).total_seconds() < 120
        except Exception: return False
    users = []; byuser = {}
    for d in c.execute("SELECT id, user_id, filename FROM datasets ORDER BY id DESC"): byuser.setdefault(d["user_id"], []).append({"id": d["id"], "name": d["filename"]})
    for r in c.execute("""SELECT u.*, (SELECT COUNT(*) FROM activity a WHERE a.user_id=u.id AND a.type='login' AND a.status='success') logins,
        (SELECT COUNT(*) FROM datasets d WHERE d.user_id=u.id) datasets, (SELECT COUNT(*) FROM predictions p WHERE p.user_id=u.id) predictions,
        (SELECT COUNT(*) FROM activity a WHERE a.user_id=u.id AND a.type IN ('export','download')) exports FROM users u ORDER BY u.id DESC"""):
        users.append({"id": r["id"], "roll": r["roll_number"], "registered": r["created_at"], "last_login": r["last_login"] or r["last_seen"] or r["created_at"], "last_used": r["last_seen"] or r["last_login"] or r["created_at"],
                      "active": live(r), "logins": r["logins"], "datasets": r["datasets"], "predictions": r["predictions"], "exports": r["exports"], "dataset_list": byuser.get(r["id"], [])})
    act = [dict(r) for r in c.execute("SELECT id,roll,type,detail,status,created_at FROM activity ORDER BY id DESC LIMIT 1000")]
    pr = [{"id": r["id"], "roll": r["roll"], "dataset": r["dataset_name"], "model": r["model"], "formula": r["formula"], "inputs": json.loads(r["inputs_json"] or "{}"),
           "result": json.loads(r["result_json"] or "{}"), "created": r["created_at"]} for r in c.execute("SELECT * FROM predictions ORDER BY id DESC LIMIT 500")]
    q = lambda sql, *a: c.execute(sql, a).fetchone()[0]
    stats = {"users": len(users), "active": sum(u["active"] for u in users), "datasets": q("SELECT COUNT(*) FROM datasets"), "predictions": q("SELECT COUNT(*) FROM predictions"),
             "logins_today": q("SELECT COUNT(*) FROM activity WHERE type='login' AND status='success' AND created_at LIKE ?", today + "%"),
             "failed_today": q("SELECT COUNT(*) FROM activity WHERE status='failed' AND created_at LIKE ?", today + "%"),
             "uploads_today": q("SELECT COUNT(*) FROM activity WHERE type='upload' AND status='success' AND created_at LIKE ?", today + "%"),
             "exports": q("SELECT COUNT(*) FROM activity WHERE type IN ('export','download')")}
    since = (t - dt.timedelta(days=56)).strftime("%Y-%m-%d"); per = {}
    for d, ty, ro in c.execute("SELECT substr(created_at,1,10), type, roll FROM activity WHERE created_at>=? AND status!='failed'", (since,)):
        e = per.setdefault(d, {"act": 0, "u": set(), "up": 0, "pr": 0}); e["act"] += 1; e["u"].add(ro); e["up"] += ty == "upload"; e["pr"] += ty == "prediction"
    def agg(days):
        o = {"labels": [], "activity": [], "users": [], "uploads": [], "predictions": []}
        for lab, ds in days:
            es = [per[d] for d in ds if d in per]
            o["labels"].append(lab); o["activity"].append(sum(e["act"] for e in es)); o["users"].append(len(set().union(*[e["u"] for e in es])) if es else 0)
            o["uploads"].append(sum(e["up"] for e in es)); o["predictions"].append(sum(e["pr"] for e in es))
        return o
    day = lambda n: (t - dt.timedelta(days=n))
    mon = t - dt.timedelta(days=t.weekday())
    series = {"daily": agg([(day(n).strftime("%d %b"), [day(n).strftime("%Y-%m-%d")]) for n in range(13, -1, -1)]),
              "weekly": agg([((mon - dt.timedelta(weeks=w)).strftime("%d %b"), [(mon - dt.timedelta(weeks=w) + dt.timedelta(days=i)).strftime("%Y-%m-%d") for i in range(7)]) for w in range(7, -1, -1)])}
    c.execute("DELETE FROM presence WHERE bucket < ?", ((t - dt.timedelta(days=10)).strftime("%Y-%m-%d"),)); c.commit()
    fl = t.replace(minute=t.minute // 5 * 5, second=0, microsecond=0)
    def cnt(width, rng, fmt, step, lab):
        got = dict(c.execute(f"SELECT substr(bucket,1,{width}), COUNT(DISTINCT user_id) FROM presence WHERE bucket>=? GROUP BY 1", (rng[0].strftime("%Y-%m-%d %H:%M"),)).fetchall())
        pts = [rng[1] - step * i for i in range(rng[2] - 1, -1, -1)]
        return {"labels": [p.strftime(lab) for p in pts], "values": [got.get(p.strftime(fmt), 0) for p in pts]}
    h0 = t.replace(minute=0, second=0, microsecond=0); d0 = t.replace(hour=0, minute=0, second=0, microsecond=0)
    trend = {"1h": cnt(16, (fl - dt.timedelta(minutes=55), fl, 12), "%Y-%m-%d %H:%M", dt.timedelta(minutes=5), "%H:%M"),
             "24h": cnt(13, (h0 - dt.timedelta(hours=23), h0, 24), "%Y-%m-%d %H", dt.timedelta(hours=1), "%H:00"),
             "7d": cnt(10, (d0 - dt.timedelta(days=6), d0, 7), "%Y-%m-%d", dt.timedelta(days=1), "%d %b")}
    stats["predictions_today"] = q("SELECT COUNT(*) FROM predictions WHERE created_at LIKE ?", today + "%")
    return jsonify({"server_time": now(), "trend": trend, "series": series, "stats": stats, "users": users, "activity": act, "predictions": pr})

@app.get("/api/admin/users/<roll>/activity")
@admin_required
def admin_user_activity(roll):
    rows = db().execute("SELECT id,roll,type,detail,status,created_at FROM activity WHERE roll=? ORDER BY id DESC LIMIT 3000", (roll,)).fetchall()
    return jsonify({"roll": roll, "activity": [dict(r) for r in rows]})

@app.post("/api/admin/users/<roll>/view-token")
@admin_required
def admin_view_token(roll):
    """Read-only token that lets the admin open a user's account in the normal user interface (see auth())."""
    u = db().execute("SELECT id FROM users WHERE roll_number=?", (roll,)).fetchone()
    if not u: return err("User not found.", 404)
    return jsonify({"token": SER.dumps({"uid": u["id"], "role": "admin_view"}), "roll": roll})

@app.get("/admin")
def admin_page(): return app.send_static_file("admin.html")   # shell only; all admin data comes from @admin_required APIs

def uerr(msg, *a, **k):
    f = request.files.get("file"); log("upload", f"{f.filename if f else '-'} - {msg}", "failed"); return err(msg, *a, **k)

# ---------------- ranking ----------------
def rank_db(did):
    c = db(); rows = c.execute("SELECT id,mahalanobis_distance,ehull,predicted_log_kstar,detail_json FROM screening_results WHERE dataset_id=?", (did,)).fetchall(); out = []
    for r in rows:
        det = json.loads(r["detail_json"]); t = det["thresholds"]
        sc, parts, tier = ml.closeness(r["mahalanobis_distance"], t["ad"], r["ehull"], t["ehull"], r["predicted_log_kstar"], t["orr"])
        det["shortfalls"] = parts; out.append((sc, -r["predicted_log_kstar"], r["id"], tier, jd(det)))
    out.sort()
    c.executemany("UPDATE screening_results SET score=?, rank=?, tier=?, detail_json=? WHERE id=?", [(o[0], i + 1, o[3], o[4], o[2]) for i, o in enumerate(out)])
    row = c.execute("SELECT summary_json FROM datasets WHERE id=?", (did,)).fetchone()
    if row and row["summary_json"]:
        sm = json.loads(row["summary_json"]); sm.update({f"tier_{k}": sum(1 for o in out if o[3] == k) for k in ("green", "orange", "red")})
        sm["tiers"] = {"green": ml.TIER_GREEN, "red": ml.TIER_RED}; c.execute("UPDATE datasets SET summary_json=? WHERE id=?", (jd(sm), did))
    c.commit()

MODEL_FILES = {"SVR": "svr_pipeline.joblib", "ANN": "ann_pipeline.joblib"}
def norm_model(m): return "ANN" if str(m or "").strip().upper() == "ANN" else "SVR"
BUILTIN = Path(__file__).resolve().parent / "builtin_models"      # models trained once (build_builtin_models.py) and shipped INSIDE the code folder
def mfile(did, model):
    if did == 0: return BUILTIN / MODEL_FILES[norm_model(model)]
    return STORE / "models" / str(did) / MODEL_FILES[norm_model(model)]
def screened_model(r): return norm_model((json.loads(r["summary_json"] or "{}")).get("model"))

def do_screen(r, model="SVR"):
    model = norm_model(model); did = r["id"]; tj = json.loads(r["train_json"]); mp = tj["mapping"]
    if model == "ANN" and not r["ann_json"]: raise ValueError("Train the ANN first (Model Training page).")
    if not mfile(did, model).exists(): raise ValueError(f"The saved {model} model was not found - please train it again.")
    df, _ = read_file(dpath(r)); bundle = joblib.load(mfile(did, model))
    rows = ml.screen(df, mp, bundle, labels(json.loads(r["analysis_json"])))
    seen, uniq = set(), []
    for x in rows:                                    # same formula is never counted twice
        k = fkey(x["formula"])
        if k not in seen: seen.add(k); uniq.append(x)
    dup = len(rows) - len(uniq); rows = uniq
    cs = costmod.apply_stage(rows, get_table())          # cost = estimate (USD/kg) + Cheap/Moderate/Expensive level; never changes PASS/FAIL
    c = db(); c.execute("DELETE FROM screening_results WHERE dataset_id=?", (did,))
    c.executemany("INSERT INTO screening_results(dataset_id,row_index,formula,predicted_log_kstar,predicted_kstar,mahalanobis_distance,applicability_domain,ad_result,ehull,ehull_result,cost,cost_result,orr_value,orr_result,final_result,failure_reason,detail_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [(did, x["row_index"], x["formula"], x["pred_log"], x["pred_k"], x["dist"], x["ad"], x["ad_result"], x["ehull"], x["ehull_result"], x["cost"], x["cost_result"], x["orr_value"], x["orr_result"], x["final"], x["reason"], jd(x["detail"])) for x in rows])
    cnt = lambda k, v: sum(1 for x in rows if x[k] == v)
    s = {"v": SUMMARY_VER, "model": model, "total": len(rows), "PASS": cnt("final", "PASS"), "FAIL": cnt("final", "FAIL"), "INCOMPLETE": cnt("final", "INCOMPLETE"),
         "inside_ad": cnt("ad", "INSIDE"), "outside_ad": cnt("ad", "OUTSIDE"), "duplicates_merged": dup,
         **{f"{k}_{v}": cnt(f"{k}_result", v.upper().replace("_", " ")) for k in ("ehull", "orr") for v in ("pass", "fail", "not_available")},
         "ehull_available": mp.get("ehull") is not None, "pass_pct": round(100 * cnt("final", "PASS") / max(len(rows), 1), 1),
         "limits": {"ehull": ml.EHULL_LIMIT, "orr": ml.ORR_LIMIT, "ad_quantile": ml.AD_QUANTILE, "cost": costmod.RULE_TEXT}}
    s.update(costmod.summary_fields(rows, cs))
    c.execute("UPDATE datasets SET summary_json=?, status='screened' WHERE id=?", (jd(s), did)); c.commit(); rank_db(did)
    snap_cache(did, model, jd(s))

def snap_cache(did, model, summary_json):
    """Keep a copy of this model's finished screening so switching SVR <-> ANN later is instant (no re-prediction)."""
    c = db(); rows = [dict(x) for x in c.execute("SELECT * FROM screening_results WHERE dataset_id=?", (did,))]
    for x in rows: x.pop("id", None)
    c.execute("INSERT OR REPLACE INTO screening_cache(dataset_id,model,summary,rows) VALUES(?,?,?,?)", (did, model, summary_json, json.dumps(rows))); c.commit()

def restore_cache(r, model):
    c = db(); k = c.execute("SELECT summary,rows FROM screening_cache WHERE dataset_id=? AND model=?", (r["id"], model)).fetchone()
    if not k: return False
    s = json.loads(k["summary"])
    if s.get("v") != SUMMARY_VER or (s.get("cost") or {}).get("fp") != get_table().fp: return False      # prices changed -> recompute
    rows = json.loads(k["rows"])
    if not rows: return False
    cols = list(rows[0].keys())
    c.execute("DELETE FROM screening_results WHERE dataset_id=?", (r["id"],))
    c.executemany(f"INSERT INTO screening_results({','.join(cols)}) VALUES({','.join('?' * len(cols))})", [tuple(x[col] for col in cols) for x in rows])
    c.execute("UPDATE datasets SET summary_json=?, status='screened' WHERE id=?", (k["summary"], r["id"])); c.commit(); return True

def recost_db(did):
    """Re-apply ONLY the cost estimate to a stored screening (after prices changed, or for results made with an older cost method).
    Uses the saved criterion results, so the model is not re-run."""
    c = db()
    rows = [{"id": x["id"], "formula": x["formula"], "ad_result": x["ad_result"], "ehull_result": x["ehull_result"], "orr_result": x["orr_result"],
             "final": "", "reason": "", "detail": json.loads(x["detail_json"])}
            for x in c.execute("SELECT id,formula,ad_result,ehull_result,orr_result,detail_json FROM screening_results WHERE dataset_id=?", (did,))]
    cs = costmod.apply_stage(rows, get_table())
    c.executemany("UPDATE screening_results SET cost=?, cost_result=?, final_result=?, failure_reason=?, detail_json=? WHERE id=?",
                  [(x["cost"], x["cost_result"], x["final"], x["reason"], jd(x["detail"]), x["id"]) for x in rows])
    row = c.execute("SELECT summary_json FROM datasets WHERE id=?", (did,)).fetchone(); sm = json.loads(row["summary_json"] or "{}")
    sm.update(costmod.summary_fields(rows, cs)); sm["v"] = SUMMARY_VER; sm.setdefault("limits", {})["cost"] = costmod.RULE_TEXT
    c.execute("UPDATE datasets SET summary_json=? WHERE id=?", (jd(sm), did)); c.commit()

def refresh_old(r):
    """Keeps stored results consistent with the current rules. (a) Results made without the cost step, or screened with a different
    price table, get only the cheap cost stage re-applied (the model is not re-run). (b) Results from much older versions are
    re-screened from the saved model."""
    s = json.loads(r["summary_json"] or "{}")
    if r["status"] != "screened" or getattr(g, "viewonly", False): return r
    try:
        if s.get("v") in (3, 4) or (s.get("v") == SUMMARY_VER and (s.get("cost") or {}).get("fp") != get_table().fp):
            recost_db(r["id"]); return own(r["id"])
        if s.get("v") != SUMMARY_VER and mfile(r["id"], s.get("model")).exists():
            do_screen(r, s.get("model")); return own(r["id"])
    except Exception as e: app.logger.warning("re-screen / re-cost failed: %s", e)
    return r

# ---------------- datasets ----------------
def ds_card(r):
    s = json.loads(r["summary_json"] or "{}")
    return {"id": r["id"], "filename": r["filename"], "upload_date": r["upload_date"], "row_count": s.get("total", r["row_count"]), "status": r["status"],
            "model": norm_model(s.get("model")) if r["status"] == "screened" else None, "pass": s.get("PASS", 0), "fail": s.get("FAIL", 0)}

@app.get("/api/dashboard")
@auth
def dashboard():
    if not g.viewonly: dedupe_user()
    for r in db().execute("SELECT * FROM datasets WHERE user_id=? ORDER BY id", (g.uid,)).fetchall(): refresh_old(r)
    rows = db().execute("SELECT * FROM datasets WHERE user_id=? ORDER BY id DESC", (g.uid,)).fetchall()
    uniq = {}
    for r in sorted(rows, key=lambda r: r["id"]):                   # totals: one entry per distinct formula (latest result wins)
        if r["status"] != "screened": continue
        for x in db().execute("SELECT formula,final_result FROM screening_results WHERE dataset_id=?", (r["id"],)): uniq[fkey(x["formula"])] = x["final_result"]
    vals = list(uniq.values())
    return jsonify({"roll_number": g.roll, "datasets": [ds_card(r) for r in rows],
        "totals": {"datasets": len(rows), "cathodes_screened": len(vals), "pass": vals.count("PASS"), "fail": vals.count("FAIL")}})

@app.post("/api/datasets")
@auth
def upload():
    f = request.files.get("file")
    if not f or not f.filename: return uerr("No file uploaded.")
    ext = Path(f.filename).suffix.lower()
    if ext not in ALLOWED: return uerr(f"Unsupported file type '{ext}'. Upload .csv, .xlsx or .xls.")
    d = STORE / "uploads" / str(g.uid); d.mkdir(exist_ok=True)
    path = d / f"{uuid.uuid4().hex[:10]}_{secure_filename(f.filename)}"; f.save(path)
    try: df, info = read_file(path)
    except Exception as e: path.unlink(missing_ok=True); return uerr(f"Could not read the file (invalid or corrupted): {e}")
    if df.empty or df.shape[1] < 2: path.unlink(missing_ok=True); return uerr("The dataset is empty or has fewer than 2 columns.")
    h = chash(df); dedupe_user()
    ex = db().execute("SELECT id FROM datasets WHERE user_id=? AND content_hash=?", (g.uid, h)).fetchone()
    if ex: path.unlink(missing_ok=True); log("upload", f.filename + " (duplicate of existing dataset)", "duplicate"); return jsonify({"id": ex["id"], "duplicate": True})
    an = ml.analyze(df, info); m = an["mapping"]
    cur = db().execute("INSERT INTO datasets(user_id,filename,stored_path,upload_date,row_count,column_count,target_column,formula_column,feature_list,analysis_json,status,content_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        (g.uid, f.filename, str(path), now(), len(df), df.shape[1], m["target"], m["formula"], jd(m["features"]), jd(an), "uploaded", h))
    db().commit(); log("upload", f.filename, "success"); return jsonify({"id": cur.lastrowid, "duplicate": False})

@app.get("/api/datasets/<int:did>")
@auth
def get_ds(did):
    r = refresh_old(own(did))
    return jsonify({**ds_card(r), "analysis": json.loads(r["analysis_json"]), "train": json.loads(r["train_json"]) if r["train_json"] else None, "ann": json.loads(r["ann_json"]) if r["ann_json"] else None,
                    "summary": json.loads(r["summary_json"]) if r["summary_json"] else None})

@app.delete("/api/datasets/<int:did>")
@auth
def del_ds(did): drop_dataset(own(did)); db().commit(); return jsonify({"ok": True})

@app.post("/api/datasets/<int:did>/mapping")
@auth
def set_mapping(did):
    """Let the user override which dataset column feeds each paper descriptor ({key: column or ""})."""
    r = own(did); an = json.loads(r["analysis_json"]); b = request.get_json(silent=True) or {}
    df, _ = read_file(dpath(r)); cols = list(df.columns)
    ov = b.get("descriptors") or {}
    for e in an["descriptors"]:
        if e["key"] not in ov: continue
        col = ov[e["key"]] or None
        if col is not None and col not in cols: return err(f"Column '{col}' does not exist in the dataset.")
        e["column"], e["present"] = col, col is not None
        e["usable"], e["reason"] = False, "Not in dataset"
        if col is not None:
            s_ = df[col]
            if not pd.api.types.is_numeric_dtype(s_): e["reason"] = "Non-numeric"
            elif s_.notna().mean() < 0.5: e["reason"] = ">50% missing"
            elif ml.is_const(s_): e["reason"] = "Constant value (no information)"
            else: e["usable"], e["reason"] = True, "OK"
    an["mapping"]["features"] = [e["column"] for e in an["descriptors"] if e["usable"] and e["group"] != "enhanced"]
    db().execute("UPDATE datasets SET analysis_json=? WHERE id=?", (jd(an), did)); db().commit()
    return jsonify({"descriptors": an["descriptors"], "mapping": an["mapping"]})

@app.post("/api/datasets/<int:did>/train")
@auth
def train(did):
    r = own(did); an = json.loads(r["analysis_json"]); b = request.get_json(silent=True) or {}
    mp = {**an["mapping"], **{k: v for k, v in (b.get("mapping") or {}).items() if v}}
    if not mp.get("formula"): return err("No chemical-formula column detected. Choose one in the column mapping.")
    if not mp.get("target"): return err("No log10(k*) target column detected. Choose one in the column mapping.")
    rid = str(b.get("rid") or ""); say = prog_start(did, rid, True)
    say("Loading dataset", r["filename"] if "filename" in r.keys() else "")
    df, _ = read_file(dpath(r))
    say("Dataset loaded", f"{len(df)} rows × {len(df.columns)} columns")
    if mp["target"] not in df.columns or mp["formula"] not in df.columns: return err("Selected columns do not exist in the dataset.")
    feats = [c for c in mp.get("features", []) if c in df.columns and c != mp["target"] and pd.api.types.is_numeric_dtype(df[c]) and not ml.is_const(df[c])]
    if len(feats) < 2: return err("Fewer than 2 usable numeric descriptor columns are available in this dataset - cannot train.")
    say("Columns validated", f"composition: {mp['formula']} · target: {mp['target']}")
    enh = [e["column"] for e in an["descriptors"] if e["usable"] and e["group"] == "enhanced"]
    try: res, bundle = ml.train_all(df, mp, feats + [c for c in enh if c not in feats], labels(an))
    except ValueError as e: return err(str(e))
    except Exception as e: app.logger.exception(e); return err(f"Training failed: {e}", 500)
    finally: prog_end()
    say("Saving the SVR model and results")
    mdir = STORE / "models" / str(did); mdir.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, mdir / "svr_pipeline.joblib"); joblib.dump(bundle["pipeline"].named_steps["sc"], mdir / "scaler.joblib")
    (mdir / "config.json").write_text(jd({"features": res["selected_features"], "all_candidate_features": feats, "mapping": mp, "preprocessing": "median imputer + StandardScaler inside Pipeline", "ad": res["ad"]}))
    res.update({"mapping": mp, "unavailable_descriptors": [{"key": e["key"], "label": e["label"], "reason": e["reason"]} for e in an["descriptors"] if not e["usable"]]})
    c = db(); c.execute("DELETE FROM models WHERE dataset_id=? AND model_type!='ANN'", (did,)); c.execute("DELETE FROM screening_results WHERE dataset_id=?", (did,)); c.execute("DELETE FROM screening_cache WHERE dataset_id=?", (did,))
    for m in res["comparison"]:
        p = m["model"] == "SVR"
        c.execute("INSERT INTO models(dataset_id,model_type,is_primary,training_date,R2,MAE,RMSE,model_path,scaler_path,params_json) VALUES(?,?,?,?,?,?,?,?,?,?)",
                  (did, m["model"], int(p), now(), m["R2"], m["MAE"], m.get("RMSE"), str(mdir / "svr_pipeline.joblib") if p else None, str(mdir / "scaler.joblib") if p else None, jd(m["params"])))
    c.execute("UPDATE datasets SET train_json=?, target_column=?, formula_column=?, feature_list=?, status='trained', summary_json=NULL WHERE id=?", (jd(res), mp["target"], mp["formula"], jd(res["selected_features"]), did)); c.commit()
    return jsonify({"ok": True})

@app.post("/api/datasets/<int:did>/train_ann")
@auth
def train_ann(did):
    """Train the PyTorch ANN on ALL usable descriptors (no feature selection). The SVR training above is untouched."""
    r = own(did); an = json.loads(r["analysis_json"]); b = request.get_json(silent=True) or {}
    base_map = json.loads(r["train_json"])["mapping"] if r["train_json"] else an["mapping"]
    mp = {**base_map, **{k: v for k, v in (b.get("mapping") or {}).items() if v}}
    if not mp.get("formula"): return err("No chemical-formula column detected. Choose one in the column mapping.")
    if not mp.get("target"): return err("No log10(k*) target column detected. Choose one in the column mapping.")
    rid = str(b.get("rid") or ""); say = prog_start(did, rid, not b.get("chain"))
    if not b.get("chain"):
        say("Loading dataset"); 
    df, _ = read_file(dpath(r))
    if not b.get("chain"): say("Dataset loaded", f"{len(df)} rows × {len(df.columns)} columns")
    if mp["target"] not in df.columns or mp["formula"] not in df.columns: return err("Selected columns do not exist in the dataset.")
    feats = [c for c in mp.get("features", []) if c in df.columns and c != mp["target"] and pd.api.types.is_numeric_dtype(df[c]) and not ml.is_const(df[c])]
    if len(feats) < 2: return err("Fewer than 2 usable numeric descriptor columns are available in this dataset - cannot train.")
    if not b.get("chain"): say("Columns validated", f"composition: {mp['formula']} · target: {mp['target']}")
    else: say("Starting the neural network (ANN)", "same dataset, same grouped split")
    try: res, bundle = ml.train_ann(df, mp, feats, labels(an))
    except ValueError as e: return err(str(e))
    except Exception as e: app.logger.exception(e); return err(f"ANN training failed: {e}", 500)
    finally: prog_end()
    say("Saving the ANN model and results")
    mdir = STORE / "models" / str(did); mdir.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, mdir / "ann_pipeline.joblib")
    (mdir / "ann_config.json").write_text(jd({"features": res["features"], "mapping": mp, "architecture": res["architecture"], "preprocessing": "median imputer + StandardScaler inside Pipeline", "ad": res["ad"]}))
    res.update({"mapping": mp, "unavailable_descriptors": [{"key": e["key"], "label": e["label"], "reason": e["reason"]} for e in an["descriptors"] if not e["usable"]]})
    c = db(); m = res["comparison"][0]
    c.execute("DELETE FROM models WHERE dataset_id=? AND model_type='ANN'", (did,))
    c.execute("INSERT INTO models(dataset_id,model_type,is_primary,training_date,R2,MAE,RMSE,model_path,scaler_path,params_json) VALUES(?,?,?,?,?,?,?,?,?,?)",
              (did, "ANN", 0, now(), m["R2"], m["MAE"], m.get("RMSE"), str(mdir / "ann_pipeline.joblib"), None, jd(m["params"])))
    c.execute("UPDATE datasets SET ann_json=? WHERE id=?", (jd(res), did)); c.execute("DELETE FROM screening_cache WHERE dataset_id=? AND model='ANN'", (did,))
    if screened_model(r) == "ANN":                      # an older ANN screening would no longer match the new ANN -> clear it
        c.execute("DELETE FROM screening_results WHERE dataset_id=?", (did,)); c.execute("UPDATE datasets SET status='trained', summary_json=NULL WHERE id=?", (did,))
    c.commit(); return jsonify({"ok": True})

_BUNDLES = {}

# ---- live training progress (the app runs 1 gunicorn worker with threads, so a plain dict is shared by all requests) ----
_PROG = {}; _PROG_LOCK = threading.Lock()
def prog_start(did, rid, reset):
    """Install the progress callback for this request thread. The first call of a run (reset=True) clears older events."""
    key = (g.uid, did)
    with _PROG_LOCK:
        if reset or _PROG.get(key, {}).get("rid") != rid: _PROG[key] = {"rid": rid, "ev": [], "t0": time.time()}
    def cb(msg, detail=""):
        with _PROG_LOCK:
            p = _PROG.get(key)
            if p and p["rid"] == rid: p["ev"].append({"m": msg, "d": detail, "t": round(time.time() - p["t0"], 1)})
    ml._tl.cb = cb; return cb
def prog_end(): ml._tl.cb = None

@app.get("/api/datasets/<int:did>/progress")
@auth
def progress(did):
    own(did); rid = request.args.get("rid", ""); since = request.args.get("since", 0, type=int)
    with _PROG_LOCK: p = _PROG.get((g.uid, did))
    if not p or p["rid"] != rid: return jsonify({"events": [], "n": 0})
    with _PROG_LOCK: ev = p["ev"][since:]; n = len(p["ev"])
    return jsonify({"events": ev, "n": n})
def load_bundle(did, model="SVR"):
    """The trained model + training data are saved to disk at training time; predictions always use that saved file."""
    p = mfile(did, model)
    if not p.exists(): return None
    k = (did, p.name, p.stat().st_mtime_ns)
    if k not in _BUNDLES:
        if len(_BUNDLES) >= 4: _BUNDLES.clear()
        _BUNDLES[k] = joblib.load(p)
    return _BUNDLES[k]

_BMETA = {"key": None, "row": None}
def builtin_row():
    """Dataset-like record for the models shipped with the code (backend/builtin_models). id 0 = built-in. No database, upload or training needed."""
    mp = BUILTIN / "meta.json"
    if not mp.exists() or not (BUILTIN / "svr_pipeline.joblib").exists(): return None
    key = mp.stat().st_mtime_ns
    if _BMETA["key"] != key:
        m = json.loads(mp.read_text())
        _BMETA.update(key=key, row={"id": 0, "filename": "Built-in trained models (SVR + ANN)", "status": "trained", "summary_json": None,
            "train_json": jd(m["train"]), "ann_json": jd(m["ann"]) if (BUILTIN / "ann_pipeline.joblib").exists() else None,
            "analysis_json": jd({"descriptors": m["descriptors"]})})
    return _BMETA["row"]

def shared_row():
    """Built-in models: the SVR + ANN shipped with the code, so ANY user can predict a single cathode straight away (nothing to upload or train).
    Falls back to the most recently trained dataset on the platform only if no built-in models were shipped."""
    b = builtin_row()
    if b: return b
    return db().execute("SELECT * FROM datasets WHERE train_json IS NOT NULL AND status IN ('trained','screened') ORDER BY id DESC LIMIT 1").fetchone()

@app.get("/api/shared")
@auth
def shared_info():
    r = shared_row()
    if not r: return jsonify({"available": False})
    tj = json.loads(r["train_json"]); aj = json.loads(r["ann_json"]) if r["ann_json"] else None
    keep = lambda t: {k: t.get(k) for k in ("features", "feature_stats", "shap")} if t else None
    return jsonify({"available": True, "id": "shared", "filename": "Built-in trained models (SVR + ANN)", "upload_date": "", "train": keep(tj),
                    "ann": keep(aj) if aj and mfile(r["id"], "ANN").exists() else None, "shared": True})

@app.post("/api/shared/predict")
@auth
def predict_shared():
    r = shared_row()
    if not r: return err("No trained models are available yet. Upload a dataset once so the SVR and ANN can be trained.")
    return do_predict(r, shared=True)

@app.post("/api/datasets/<int:did>/predict")
@auth
def predict(did):
    return do_predict(refresh_old(own(did)))

def do_predict(r, shared=False):
    did = r["id"]
    if not r["train_json"]: return err("Train the models first.")
    b = request.get_json(silent=True) or {}; model = norm_model(b.get("model"))
    if model == "ANN" and not r["ann_json"]: return err("Train the ANN first (Model Training page).")
    bundle = load_bundle(did, model)
    if bundle is None or "train_formulas" not in bundle: return err(f"The saved {model} model is missing or from an older version - please train it again.")
    vals = b.get("values") or {}; clean = {}
    for c in bundle["features"]:
        v = vals.get(c)
        if v is None or str(v).strip() == "": continue
        try: f = float(v)
        except Exception: return err(f"'{c}' must be a number.")
        if not np.isfinite(f): return err(f"'{c}' must be a finite number.")
        clean[c] = f
    if not clean: return err("Enter at least one descriptor value.")
    eh = b.get("ehull")
    if eh is None or str(eh).strip() == "": eh = None
    else:
        try: eh = float(eh)
        except Exception: return err("Ehull must be a number.")
        if not np.isfinite(eh): return err("Ehull must be a finite number.")
    try:
        x = ml.predict_single(bundle, clean, labels(json.loads(r["analysis_json"])), str(b.get("formula") or "").strip()[:60] or None, eh)
        cmp_ = ml.compare_with_training(bundle, clean)
        if shared: cmp_["nearest"] = []                      # never show another user's training cathodes
        sm = json.loads(r["summary_json"] or "{}") if r["status"] == "screened" and not shared else {}
        costmod.apply_single(x, get_table(), sm.get("cost"))       # cost estimate: level compared with the cathodes of the last screening
    except Exception as e: app.logger.exception(e); log("prediction", f"{b.get('formula') or '-'} - {e}", "failed"); return err(f"Prediction failed: {e}", 500)
    db().execute("INSERT INTO predictions(user_id,roll,dataset_id,dataset_name,model,formula,inputs_json,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        (g.uid, g.roll, did, "Built-in models" if shared else r["filename"], model, x["formula"], jd({**clean, "Ehull": eh}), jd({"pred_log": x["pred_log"], "pred_k": x["pred_k"], "dist": x["dist"], "ad_result": x["ad_result"], "ehull_result": x["ehull_result"], "orr_result": x["orr_result"], "cost": x["cost"], "cost_result": x["cost_result"], "final": x["final"]}), now())); db().commit()
    log("prediction", f"{x['formula']} · {model} · {x['final']}")
    d = x["detail"]; drv = sorted(d["shap"], key=lambda s: -abs(s["value"]))[:5]
    return jsonify({"formula": x["formula"], "pred_log": x["pred_log"], "pred_k": x["pred_k"], "dist": x["dist"], "ad": x["ad"], "ad_result": x["ad_result"],
                    "ehull": x["ehull"], "ehull_result": x["ehull_result"], "orr_result": x["orr_result"], "cost": x["cost"], "cost_result": x["cost_result"], "cost_info": d["cost"],
                    "final": x["final"], "fails": d["fails"],
                    "not_available": d["not_available"], "thresholds": d["thresholds"], "imputed": x["imputed"], "drivers": drv, "compare": cmp_,
                    "model": {"name": model, "trained_on": len(bundle.get("train_index", [])), "n_features": len(bundle["features"])}})

@app.post("/api/datasets/<int:did>/screen")
@auth
def screen(did):
    r = own(did)
    if not r["train_json"]: return err("Train the models first.")
    b = request.get_json(silent=True) or {}; model = norm_model(b.get("model"))
    try:
        if b.get("both"):                                   # upload pipeline: screen with ANN (if trained) then SVR, so both are saved and SVR is shown first
            if r["ann_json"]: do_screen(r, "ANN")
            do_screen(r, "SVR")
        elif not restore_cache(r, model): do_screen(r, model)   # instant when this model was already screened
    except ValueError as e: return err(str(e))
    return jsonify({"ok": True})

# ---------------- best in category (among the PASS cathodes only; uses only stored result values) ----------------
BEST_RANKSUM_TEXT = ("Most balanced = lowest rank-sum. Every PASS cathode is ranked 1..N on each criterion (Ehull: lowest is best; estimated cost: lowest is best; "
                     "predicted log10(k*): highest is best). Tied values share the better rank (1, 1, 3, ...). The ranks are added: rank-sum = rank(Ehull) + rank(cost) + rank(log10 k*); "
                     "the smallest sum wins. Only criteria that are available for every PASS cathode are used, and at least two are needed.")
_BEST_TOL = 1e-9

def _names(ts, n=5): return ', '.join(ts[:n]) + (f" and {len(ts) - n} more" if len(ts) > n else "")

def _isclose(a, b): return abs(a - b) <= _BEST_TOL * max(1.0, abs(a), abs(b))

def _comp_rank(vals, higher_better=False):
    """Competition ranks (1 = best; ties share the better rank) for a list of numbers."""
    better = (lambda w, v: w > v and not _isclose(w, v)) if higher_better else (lambda w, v: w < v and not _isclose(w, v))
    return [1 + sum(1 for w in vals if better(w, v)) for v in vals]

def best_in_category(rows):
    """`rows`: dicts of the stored PASS cathodes (id, rank, formula, ehull, cost, predicted_log_kstar, predicted_kstar). Returns the four categories.
    Nothing is invented: a category whose criterion is missing is skipped and says why; ties are reported."""
    n = len(rows); rows = sorted(rows, key=lambda r: (r.get("rank") is None, r.get("rank") or 0, r["formula"]))   # tie-break: the app's closeness rank, then name
    def card(r, **extra):
        d = {"id": r["id"], "formula": r["formula"], "ehull": r["ehull"], "cost": r["cost"], "log_k": r["predicted_log_kstar"], "k": r["predicted_kstar"], "rank": r.get("rank")}
        d.update(extra); return d
    def pick(key, title, crit, col, higher, unit_txt):
        base = {"key": key, "title": title, "criterion": crit}
        if not n: return {**base, "available": False, "note": "No cathode has a full PASS, so there is nothing to choose from."}
        have = [r for r in rows if r.get(col) is not None]
        if not have: return {**base, "available": False, "note": f"Skipped: {crit} is not available for the PASS cathodes."}
        best = max(r[col] for r in have) if higher else min(r[col] for r in have)
        tied = [r for r in have if _isclose(r[col], best)]; w = tied[0]
        txt = f"{'Highest' if higher else 'Lowest'} {crit} among the {len(have)} PASS cathode(s): {unit_txt(best)}."
        if len(have) < n: txt += f" ({n - len(have)} PASS cathode(s) have no {crit} and are not compared.)"
        if len(tied) > 1: txt += f" Tied with {_names([t['formula'] for t in tied[1:]])} (identical value); {w['formula']} is shown because it ranks highest in the closeness ranking."
        return {**base, "available": True, "winner": card(w), "ties": [t["formula"] for t in tied[1:]], "n_compared": len(have), "reason": txt}
    out = [pick("stable", "Most stable", "Ehull", "ehull", False, lambda v: f"{v:.4g} meV/atom"),
           pick("cheapest", "Lowest cost", "estimated cost", "cost", False, lambda v: f"{v:.4g} USD/kg (estimate)"),
           pick("active", "Most active", "predicted log10(k*)", "predicted_log_kstar", True, lambda v: f"{v:.4g}")]
    base = {"key": "balanced", "title": "Most balanced", "criterion": "rank-sum of Ehull, cost and log10(k*)"}
    crits = [(lab, col, hi) for lab, col, hi in (("Ehull", "ehull", False), ("cost", "cost", False), ("log10(k*)", "predicted_log_kstar", True)) if n and all(r.get(col) is not None for r in rows)]
    if not n: out.append({**base, "available": False, "note": "No cathode has a full PASS, so there is nothing to choose from."})
    elif len(crits) < 2:
        miss = [lab for lab, col in (("Ehull", "ehull"), ("cost", "cost"), ("log10(k*)", "predicted_log_kstar")) if any(r.get(col) is None for r in rows)]
        out.append({**base, "available": False, "note": f"Skipped: fewer than two criteria are available for every PASS cathode (missing for some: {', '.join(miss)})."})
    else:
        rk = {lab: _comp_rank([r[col] for r in rows], hi) for lab, col, hi in crits}
        sums = [sum(rk[lab][i] for lab, _, _ in crits) for i in range(n)]; best = min(sums)
        idx = [i for i in range(n) if sums[i] == best]; w = rows[idx[0]]
        ranks = {lab: rk[lab][idx[0]] for lab, _, _ in crits}
        txt = f"Rank-sum {best} (lowest of {n} PASS cathodes): " + ", ".join(f"{lab} rank {ranks[lab]}" for lab, _, _ in crits) + "."
        skipped = [lab for lab in ("Ehull", "cost", "log10(k*)") if lab not in rk]
        if skipped: txt += f" Criteria left out because they are not available for every PASS cathode: {', '.join(skipped)}."
        if len(idx) > 1: txt += f" Tied with {_names([rows[i]['formula'] for i in idx[1:]])} (same rank-sum); {w['formula']} is shown because it ranks highest in the closeness ranking."
        out.append({**base, "available": True, "winner": card(w, rank_sum=best, ranks=ranks), "ties": [rows[i]["formula"] for i in idx[1:]], "n_compared": n, "reason": txt,
                    "criteria_used": [lab for lab, _, _ in crits]})
    return {"n_pass": n, "categories": out, "formula": BEST_RANKSUM_TEXT}

def best_for(did):
    rows = db().execute("SELECT id,rank,formula,ehull,cost,predicted_log_kstar,predicted_kstar FROM screening_results WHERE dataset_id=? AND final_result='PASS'", (did,)).fetchall()
    return best_in_category([dict(r) for r in rows])

@app.get("/api/datasets/<int:did>/best")
@auth
def best(did):
    refresh_old(own(did)); return jsonify(best_for(did))

LIST_COLS = "id,rank,tier,formula,predicted_log_kstar,predicted_kstar,mahalanobis_distance,applicability_domain,ad_result,ehull,ehull_result,cost,cost_result,orr_result,final_result,failure_reason"
@app.get("/api/datasets/<int:did>/results")
@auth
def results(did):
    refresh_old(own(did)); f = request.args.get("filter", "all"); q = request.args.get("q", "").strip().lower()
    cond = {"all": "1", "pass": "final_result='PASS'", "fail": "final_result='FAIL'", "outside_ad": "applicability_domain='OUTSIDE'", "failed_orr": "orr_result='FAIL'",
            "failed_ehull": "ehull_result='FAIL'", "cost_cheap": "cost_result='CHEAP'", "cost_expensive": "cost_result='EXPENSIVE'", "cost_na": "cost_result='NOT AVAILABLE'", "tier_green": "tier='green'", "tier_orange": "tier='orange'", "tier_red": "tier='red'"}.get(f, "1")
    rows = db().execute(f"SELECT {LIST_COLS},row_index FROM screening_results WHERE dataset_id=? AND {cond} AND lower(formula) LIKE ? ORDER BY rank", (did, f"%{q}%")).fetchall()
    if f in ("test", "train"):                       # results of the 40% test cathodes / 60% training cathodes of the grouped split
        bundle = load_bundle(did, screened_model(own(did))); keep = set((bundle or {}).get(f"{f}_index", []))
        rows = [x for x in rows if x["row_index"] in keep]
    return jsonify([{k: v for k, v in dict(x).items() if k != "row_index"} for x in rows])

@app.get("/api/datasets/<int:did>/results/<int:rid>")
@auth
def result_one(did, rid):
    refresh_old(own(did)); x = db().execute("SELECT * FROM screening_results WHERE id=? AND dataset_id=?", (rid, did)).fetchone()
    if not x: return err("Cathode not found.", 404)
    d = dict(x); d["detail"] = json.loads(d.pop("detail_json")); return jsonify(d)

@app.get("/api/datasets/<int:did>/predictions")
@auth
def dataset_predictions(did):
    """Single-cathode predictions this user made on this dataset (shown on the Predict page in the admin's read-only view)."""
    own(did)
    return jsonify([{"id": r["id"], "formula": r["formula"], "model": r["model"], "inputs": json.loads(r["inputs_json"] or "{}"), "result": json.loads(r["result_json"] or "{}"), "created": r["created_at"]}
                    for r in db().execute("SELECT * FROM predictions WHERE user_id=? AND dataset_id=? ORDER BY id DESC", (g.uid, did))])

@app.get("/api/datasets/<int:did>/file")
@auth
def dataset_file(did):
    """The original uploaded dataset file (the browser downloads it; Excel opens it)."""
    r = own(did); p = dpath(r)
    if not p.exists(): return err("The original file is no longer available.", 404)
    log("download", r["filename"]); return send_file(str(p), as_attachment=True, download_name=r["filename"])

@app.post("/api/datasets/<int:did>/open")
@auth
def dataset_open(did):
    """Open the dataset in Excel (the program that opens .xlsx/.csv on this PC). Only when the app runs on this same computer;
    a COPY is opened, so editing/saving in Excel never touches the data the model was trained on. Otherwise the browser downloads the file."""
    r = own(did); p = dpath(r)
    if not p.exists(): return err("The original file is no longer available.", 404)
    if request.remote_addr not in ("127.0.0.1", "::1"): return jsonify({"opened": False})
    try:
        d = Path(tempfile.gettempdir()) / "SCOPE_datasets" / str(did); d.mkdir(parents=True, exist_ok=True)
        q = d / secure_filename(r["filename"] or p.name)
        try: shutil.copyfile(p, q)
        except PermissionError: pass                       # already open in Excel -> just bring that copy up
        if sys.platform.startswith("win"): os.startfile(str(q))
        elif sys.platform == "darwin": subprocess.Popen(["open", str(q)])
        else: subprocess.Popen(["xdg-open", str(q)])
        return jsonify({"opened": True})
    except Exception as e:
        app.logger.warning("open dataset failed: %s", e); return jsonify({"opened": False})

@app.get("/api/datasets/<int:did>/export/<kind>")
@auth
def export(did, kind):
    r = refresh_old(own(did))
    rows = db().execute("SELECT * FROM screening_results WHERE dataset_id=? ORDER BY rank", (did,)).fetchall()
    if not rows: return err("No screening results yet - run the screening first.")
    log("export", f"{kind} · {r['filename']}")
    TN = {"green": "GREEN (near passing)", "orange": "INTERMEDIATE (mid-range)", "red": "RED (far from passing)"}; recs = []; cparts = []
    for x in rows:
        det = json.loads(x["detail_json"]); ci = det.get("cost") or {}
        cparts += [{"Rank": x["rank"], "Cathode / formula": x["formula"], "Element": p["element"], "Stoichiometry (mol per formula unit)": p["n"], "Precursor": p["precursor"],
                    "Precursor price (USD/kg, normalised to 99% purity)": p["norm_price_kg"], "Excess precursor (%)": p["excess_pct"], "Precursor needed (mol per mol cathode)": p["mol_precursor"],
                    "Precursor needed (g per mol cathode)": p["mass_g"], "Cost (USD per mol cathode)": p["cost"], "Share of cost (%)": round(100 * p["share"], 2),
                    "Price source": p["source"]} for p in ci.get("parts", [])]
        recs.append({"Rank": x["rank"], "Closeness tier": TN[x["tier"]], **det["original"],
            "Predicted log10(k*)": x["predicted_log_kstar"], "Predicted k* (cm/s)": x["predicted_kstar"], "Mahalanobis distance": x["mahalanobis_distance"],
            "Applicability domain": x["applicability_domain"], "Ehull (meV/atom)": x["ehull"], "Ehull result": x["ehull_result"],
            "ORR activity (pred. log10 k*)": x["orr_value"], "ORR result (LSC benchmark -6.40)": x["orr_result"],
            "Estimated precursor cost (USD per kg of cathode)": x["cost"], "Cost level (Cheap / Moderate / Expensive)": x["cost_result"], "Cost rank among priced cathodes (1 = cheapest)": ci.get("rank"),
            "Cost: elements without a price": ", ".join(ci.get("missing") or []), "Final result": x["final_result"], "Failure reason / note": x["failure_reason"]})
    bst = best_for(did); won = {}
    for cat in bst["categories"]:
        if cat.get("available"): won.setdefault(cat["winner"]["id"], []).append(cat["title"])
    for x_, rec in zip(rows, recs): rec["Best in category (among PASS)"] = ", ".join(won.get(x_["id"], []))
    brecs = [{"Category": c["title"], "Criterion": c["criterion"], "Cathode / formula": c["winner"]["formula"], "Ehull (meV/atom)": c["winner"]["ehull"],
              "Estimated cost (USD/kg)": c["winner"]["cost"], "Predicted log10(k*)": c["winner"]["log_k"], "Predicted k* (cm/s)": c["winner"]["k"],
              "Rank-sum (balanced only)": c["winner"].get("rank_sum"), "Tied with": ", ".join(c["ties"]), "Why": c["reason"]} if c.get("available") else
             {"Category": c["title"], "Criterion": c["criterion"], "Cathode / formula": "— skipped —", "Why": c["note"]} for c in bst["categories"]]
    bsheet = ("Best in Category", pd.DataFrame(brecs))
    df = pd.DataFrame(recs); fr = df["Final result"]
    if not g.viewonly: db().execute("INSERT INTO export_history(dataset_id,user_id,kind,created_at) VALUES(?,?,?,?)", (did, g.uid, kind, now())); db().commit()
    stem = Path(r["filename"]).stem
    if kind == "csv": return send_file(io.BytesIO(df.to_csv(index=False).encode()), "text/csv", as_attachment=True, download_name=f"{stem}_screening_results.csv")
    nfe = ("Not Fully Evaluated", df[fr == "INCOMPLETE"])
    sheets = {"all": [("Screening Results", df), ("PASS Cathodes", df[fr == "PASS"]), ("FAIL Cathodes", df[fr == "FAIL"])] + ([nfe] if len(nfe[1]) else []) + ([("Cost Details", pd.DataFrame(cparts))] if cparts else []) + [bsheet],
              "pass": [("PASS Cathodes", df[fr == "PASS"])] + ([nfe] if len(nfe[1]) else []) + [bsheet], "fail": [("FAIL Cathodes", df[fr == "FAIL"])]}.get(kind)
    if sheets is None: return err("Unknown export type.")
    from openpyxl.styles import PatternFill
    GREEN_FILL, RED_FILL = "C6EFCE", "F8C9C9"; buf = io.BytesIO()   # the ONLY two row colours: soft green and soft red
    with pd.ExcelWriter(buf, engine="openpyxl") as w:
        for name, d in sheets:
            (d if len(d) else pd.DataFrame({"note": ["No cathodes in this category."]})).to_excel(w, sheet_name=name, index=False); ws = w.sheets[name]
            for col in ws.columns: ws.column_dimensions[col[0].column_letter].width = min(40, max(10, len(str(col[0].value)) + 2))
            ws.freeze_panes = "C2"
            if len(d) and "Closeness tier" in d.columns:
                ti = list(d.columns).index("Closeness tier") + 1
                for rr in range(2, ws.max_row + 1):
                    # GREEN tier -> soft green; every other tier (intermediate or RED) -> soft red. No orange / amber / yellow fill exists.
                    f = GREEN_FILL if str(ws.cell(rr, ti).value).startswith("GREEN") else RED_FILL
                    for cc in range(1, ws.max_column + 1): ws.cell(rr, cc).fill = PatternFill("solid", fgColor=f)
        pd.DataFrame({"Note": ["Rows are sorted by Rank (closest to passing first). Closeness = mean normalised shortfall over the evaluated criteria (applicability domain, Ehull, ORR); GREEN <= 0.10, RED > 0.50, INTERMEDIATE in between. In the coloured sheets, GREEN-tier rows are shaded soft green and all other rows soft red. This ranking is an addition to, not part of, the paper's PASS/FAIL rules.",
            "PASS = inside the applicability domain, Ehull <= 57 meV/atom, predicted log10(k*) >= -6.40 (the LSC benchmark used in the research paper). Cost is NOT part of PASS / FAIL.",
            "Estimated cost = precursor cost per kg of cathode (USD/kg): the formula gives the moles of each precursor (e.g. La2O3, SrCO3, MnO2) per mole of cathode, plus a small excess for volatile elements (Li, Na, K, Bi, Pb), converted to grams and multiplied by the price per kg (normalised to 99% purity); the total is divided by the theoretical mass of one mole of cathode times the synthesis yield. Prices are built-in approximate market estimates (not live quotes) unless an administrator overrides them. Cheap / Moderate / Expensive = the cheapest third / middle third / dearest third of the cathodes in this screening. If an element has no price the cost is NOT AVAILABLE (never guessed). It is an indication for comparing cathodes, not a quotation.",
            "Best in category (sheet 'Best in Category' and the column of the same name): chosen only among the PASS cathodes, using only values in this file. Most stable = lowest Ehull; Lowest cost = lowest estimated cost; Most active = highest predicted log10(k*); " + BEST_RANKSUM_TEXT + " Ties are listed; a category is skipped when its criterion is not available.",
            f"Predictions come from the {screened_model(r)} model trained on this same dataset (in-sample); treat them as screening indicators, not validated measurements."]}).to_excel(w, sheet_name="Notes", index=False)
        w.sheets["Notes"].column_dimensions["A"].width = 120
    buf.seek(0)
    return send_file(buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", as_attachment=True, download_name=f"{stem}_{kind}_cathodes.xlsx")

@app.get("/")
def index(): return app.send_static_file("index.html")

if __name__ == "__main__":
    print("Data folder:", STORE)
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False, threaded=True)