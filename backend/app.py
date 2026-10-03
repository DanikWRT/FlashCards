#!/usr/bin/env python3
"""FlashCards shared-sets backend (python3 STDLIB ONLY).

A single python3 process serving BOTH:
  * the built frontend from ../dist (with SPA fallback to index.html), and
  * a REST API at /api/sets backed by an SQLite database.

No external dependencies — only `http.server` and `sqlite3` from the standard
library, so it runs unchanged in production (no pip install needed).

Run:  python3 backend/app.py
Optionally override the database location with the FC_DB_PATH env var.

Endpoints
---------
GET    /api/sets        -> JSON array of all sets (id, topic, lesson_meta, cards)
GET    /api/sets/{id}   -> a single set object
POST   /api/sets        -> create {topic, lesson_meta, cards} -> {id, ok:true}
PUT    /api/sets/{id}   -> update -> {id, ok:true}
DELETE /api/sets/{id}   -> delete -> {ok:true}
POST   /api/sets/{id}/cards -> append {cards:[{word,translation,examples?,family?}]} -> {id, added, cards, ok}
POST   /api/auth/register {username,password} -> {token, username} (409 if taken)
POST   /api/auth/login    {username,password} -> {token, username} (401 bad creds)
POST   /api/auth/logout   Bearer token        -> {ok:true}
GET    /api/me            Bearer token        -> {username} (401 if invalid)
GET    /api/leaderboard                       -> {match:[top-5], blast:[top-5]} w/ username+topic
POST   /api/leaderboard   Bearer {set_id,mode,value} -> {ok:true} (best-kept per user+set+mode)
anything else           -> static file from dist/ (else index.html SPA fallback)
"""

import hashlib
import json
import os
import secrets
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

HOST = "0.0.0.0"
PORT = 5199

# Default DB path kept in code for prod compatibility on Astra. On dev VMs the
# aifactory user cannot write under /home/dpogodin, so verification runs set
# FC_DB_PATH to a writable temp file (e.g. /tmp/fc.db).
DB_PATH = os.environ.get("FC_DB_PATH") or "/home/dpogodin/flashcards/fc.db"

# Built frontend directory (one level up from this backend/ folder).
DIST_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist")
)

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json",
}


def get_conn():
    """A fresh connection per request (safe under ThreadingHTTPServer)."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create the DB file's parent dir and all tables if missing."""
    parent = os.path.dirname(DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = get_conn()
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS sets ("
            "id TEXT PRIMARY KEY, "
            "json TEXT, "
            "created TEXT, "
            "author TEXT"
            ")"
        )
        # K18: backward-compatible migration for DBs created before the author
        # column existed. Old rows keep author NULL.
        try:
            conn.execute("ALTER TABLE sets ADD COLUMN author TEXT")
        except sqlite3.OperationalError:
            pass  # column already exists
        conn.execute(
            "CREATE TABLE IF NOT EXISTS fc_my_sets ("
            "username TEXT, "
            "set_id TEXT, "
            "added TEXT, "
            "PRIMARY KEY (username, set_id)"
            ")"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS fc_users ("
            "username TEXT PRIMARY KEY, "
            "password_hash TEXT, "
            "created TEXT, "
            "role TEXT DEFAULT 'user'"
            ")"
        )
        # K21: backward-compatible migration for DBs created before the role
        # column existed. Old rows default to 'user'.
        try:
            conn.execute("ALTER TABLE fc_users ADD COLUMN role TEXT DEFAULT 'user'")
        except sqlite3.OperationalError:
            pass  # column already exists
        # K21: the administrator is the user who owns the nickname "Danya".
        # K28: this only promotes an EXISTING 'Danya' row. The promote-on-
        # register self-escalation hole was closed (#6) so a new self-registered
        # 'Danya' account is a plain 'user'; a pre-existing/local admin account
        # named Danya still gets promoted here, preserving the K21 intent.
        conn.execute(
            "UPDATE fc_users SET role='admin' WHERE username='Danya' AND "
            "(role IS NULL OR role='' OR role='user')"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS fc_sessions ("
            "token TEXT PRIMARY KEY, "
            "username TEXT, "
            "created TEXT"
            ")"
        )
        # K28: purge expired sessions opportunistically at startup (30-day TTL).
        try:
            conn.execute(
                "DELETE FROM fc_sessions WHERE created < ?", (_cutoff_iso(),)
            )
        except sqlite3.OperationalError:
            pass  # table is brand-new / not yet populated
        # K20: shared leaderboard — one best result per (username, mode, set).
        # mode is 'match' (lower time = better) or 'blast' (higher score = better).
        conn.execute(
            "CREATE TABLE IF NOT EXISTS fc_leaderboard ("
            "username TEXT, "
            "mode TEXT, "
            "set_id TEXT, "
            "value REAL, "
            "date TEXT, "
            "PRIMARY KEY (username, mode, set_id)"
            ")"
        )
        conn.commit()
    finally:
        conn.close()


def _hash_password(password, salt):
    """PBKDF2-HMAC-SHA256 hash of password with the given per-user salt hex."""
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), 100_000
    ).hex()


def _new_salt():
    return secrets.token_hex(16)


def _new_token():
    return secrets.token_hex(32)


# ---------------- K28: session expiry & login/register rate limiting ----------------

SESSION_TTL_SECONDS = 30 * 24 * 60 * 60  # 30 days


def _cutoff_iso():
    """ISO-8601 (UTC) timestamp SESSION_TTL seconds in the past."""
    return datetime.now(timezone.utc) - timedelta(seconds=SESSION_TTL_SECONDS)


def _session_expired(created):
    """True when an ISO-8601 session `created` stamp is older than the TTL.

    Unparseable stamps are treated as expired (fail closed).
    """
    try:
        stamp = datetime.fromisoformat(created)
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - stamp).total_seconds() > SESSION_TTL_SECONDS
    except (TypeError, ValueError):
        return True


# Simple in-memory throttle for /api/auth/login and /api/auth/register keyed by
# client IP. Per-process only (fine for a single-process stdlib server); uses a
# lock so it is safe under ThreadingHTTPServer.
_RATE_MAX = 10        # allowed auth attempts
_RATE_WINDOW = 60.0   # per 60-second sliding window
_RATE_LOG = {}        # ip -> [monotonic timestamps]
_RATE_LOCK = threading.Lock()


def _rate_limited(ip):
    """Record one auth attempt for `ip`; True if the budget is now exceeded."""
    if not ip:
        return True  # no client address -> be conservative
    now = time.monotonic()
    with _RATE_LOCK:
        stamps = [s for s in _RATE_LOG.get(ip, []) if now - s < _RATE_WINDOW]
        if len(stamps) >= _RATE_MAX:
            _RATE_LOG[ip] = stamps
            return True
        stamps.append(now)
        _RATE_LOG[ip] = stamps
        return False


class Handler(BaseHTTPRequestHandler):
    server_version = "FCSets/1.0"

    def log_message(self, fmt, *args):  # keep the console clean
        pass

    # ---------------- helpers ----------------

    def _send_bytes(self, status, body, ctype):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        # K28: baseline security headers on every response.
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'",
        )
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status, obj):
        self._send_bytes(status, json.dumps(obj, ensure_ascii=False), "application/json")

    def _read_json_body(self):
        """Read and parse a JSON request body. Returns None when malformed."""
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            return None
        data = self.rfile.read(length) if length > 0 else b""
        if not data:
            return None
        try:
            return json.loads(data.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None

    def _set_id(self):
        """Return the set id from /api/sets/{id} or None."""
        path = urlparse(self.path).path
        prefix = "/api/sets/"
        if path.startswith(prefix):
            sid = unquote(path[len(prefix):])
            return sid or None
        return None

    def _api_json(self, sid):
        """Load one set row by id; None if not present."""
        conn = get_conn()
        try:
            row = conn.execute("SELECT json FROM sets WHERE id=?", (sid,)).fetchone()
        finally:
            conn.close()
        if row is None:
            return None
        try:
            return json.loads(row["json"])
        except (ValueError, TypeError):
            return None

    def _serve_static(self, path):
        """Serve a file from dist/ verbatim; fall back to index.html (SPA)."""
        if path == "/" or path == "":
            path = "/index.html"
        # K28: guard against path traversal.
        #  1) Reject any '..' path segment outright (escapes DIST_DIR, but also
        #     defeats the startswith trick where a sibling dir named 'distX'
        #     would pass the old prefix check).
        #  2) Require the resolved path to live directly under DIST_DIR by
        #     checking the dist root + os.sep (not a bare prefix).
        clean = os.path.normpath(unquote(path)).lstrip("/\\")
        if ".." in clean.split(os.sep):
            clean = "index.html"
        file_path = os.path.join(DIST_DIR, clean)
        dist_root = os.path.normpath(DIST_DIR)
        if file_path != dist_root and not file_path.startswith(dist_root + os.sep):
            file_path = os.path.join(DIST_DIR, "index.html")
        if os.path.isfile(file_path):
            ext = os.path.splitext(file_path)[1].lower()
            ctype = CONTENT_TYPES.get(ext, "application/octet-stream")
            try:
                with open(file_path, "rb") as f:
                    body = f.read()
                self._send_bytes(200, body, ctype)
                return
            except OSError:
                pass
        # SPA fallback -> index.html
        index_path = os.path.join(DIST_DIR, "index.html")
        if os.path.isfile(index_path):
            try:
                with open(index_path, "rb") as f:
                    body = f.read()
                self._send_bytes(200, body, "text/html; charset=utf-8")
                return
            except OSError:
                pass
        self._send_bytes(404, b"Not found", "text/plain")

    @staticmethod
    def _clean(obj, sid, author=None):
        """Shape a stored/request set into {id, topic, lesson_meta, cards, author}."""
        if author is None and isinstance(obj, dict):
            author = obj.get("author")
        return {
            "id": sid,
            "topic": obj.get("topic", "") if isinstance(obj, dict) else "",
            "lesson_meta": obj.get("lesson_meta", {}) if isinstance(obj, dict) else {},
            "cards": obj.get("cards", []) if isinstance(obj, dict) else [],
            "author": author,
        }

    # ---------------- auth helpers ----------------

    def _auth_bearer(self):
        """Return the Bearer token from the Authorization header, or None."""
        auth = self.headers.get("Authorization") or ""
        if auth.startswith("Bearer "):
            return auth[len("Bearer "):].strip() or None
        return None

    def _acting_user(self):
        """Resolve the username for a valid, non-expired Bearer session, else None."""
        token = self._auth_bearer()
        if not token:
            return None
        conn = get_conn()
        try:
            row = conn.execute(
                "SELECT username, created FROM fc_sessions WHERE token=?", (token,)
            ).fetchone()
            if row is not None and _session_expired(row["created"]):
                # K28: expired session -> drop it and treat as invalid.
                conn.execute("DELETE FROM fc_sessions WHERE token=?", (token,))
                conn.commit()
                return None
        finally:
            conn.close()
        return row["username"] if row else None

    @staticmethod
    def _is_admin(username):
        """True if username is the administrator (role 'admin' in fc_users).

        K21/K28: admin is decided SOLELY by the persisted role, never by a
        self-chosen username. A pre-existing local account named "Danya" is
        promoted to 'admin' by init_db() at startup (so pre-role-column DBs
        still get their Danya as admin), while a freshly self-registered
        "Danya" keeps role 'user' and therefore has NO admin power. Checking
        the nickname directly would re-open the self-promotion hole (#6).
        """
        if not username:
            return False
        conn = get_conn()
        try:
            row = conn.execute(
                "SELECT role FROM fc_users WHERE username=?", (username,)
            ).fetchone()
        finally:
            conn.close()
        return bool(row and row["role"] == "admin")

    def _auth_creds(self):
        """Validate {username,password} from the JSON body."""
        body = self._read_json_body()
        if not isinstance(body, dict):
            return None, None
        username = body.get("username")
        password = body.get("password")
        if (
            not isinstance(username, str) or not username.strip()
            or not isinstance(password, str) or not password
        ):
            return None, None
        return username, password

    def _issue_session(self, username):
        """Create a new session row and return its token."""
        token = _new_token()
        conn = get_conn()
        try:
            conn.execute(
                "INSERT INTO fc_sessions (token, username, created) VALUES (?, ?, ?)",
                (token, username, _now()),
            )
            conn.commit()
        finally:
            conn.close()
        return token

    # ---------------- methods ----------------

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/me":
            username = self._acting_user()
            if username is None:
                self._send_json(401, {"ok": False, "error": "unauthorized"})
                return
            self._send_json(200, {"username": username})
            return
        if path == "/api/my/sets":
            username = self._acting_user()
            if username is None:
                self._send_json(401, {"ok": False, "error": "unauthorized"})
                return
            conn = get_conn()
            try:
                rows = conn.execute(
                    "SELECT set_id FROM fc_my_sets WHERE username=?", (username,)
                ).fetchall()
            finally:
                conn.close()
            ids = [r["set_id"] for r in rows]
            self._send_json(200, {"ids": ids})
            return
        # K20: GET /api/leaderboard — top-5 Match (fastest time) and top-5 Blast
        # (highest score) across ALL users, each with the owning user's nickname
        # and the set's topic. Readable by anyone (logged-in or guest).
        if path == "/api/leaderboard":
            conn = get_conn()
            try:
                match_rows = conn.execute(
                    "SELECT username, set_id, value, date FROM fc_leaderboard "
                    "WHERE mode='match' ORDER BY value ASC LIMIT 5"
                ).fetchall()
                blast_rows = conn.execute(
                    "SELECT username, set_id, value, date FROM fc_leaderboard "
                    "WHERE mode='blast' ORDER BY value DESC LIMIT 5"
                ).fetchall()
                # Resolve each set's topic for display.
                topics = {}
                for r in list(match_rows) + list(blast_rows):
                    sid = r["set_id"]
                    if sid in topics:
                        continue
                    row = conn.execute(
                        "SELECT json FROM sets WHERE id=?", (sid,)
                    ).fetchone()
                    if row is not None:
                        try:
                            topics[sid] = json.loads(row["json"]).get("topic", "")
                        except (ValueError, TypeError):
                            topics[sid] = ""
                    else:
                        topics[sid] = ""
            finally:
                conn.close()
            match = [{
                "username": r["username"],
                "set_id": r["set_id"],
                "topic": topics.get(r["set_id"], "") or "Без названия",
                "value": r["value"],
                "date": r["date"],
            } for r in match_rows]
            blast = [{
                "username": r["username"],
                "set_id": r["set_id"],
                "topic": topics.get(r["set_id"], "") or "Без названия",
                "value": r["value"],
                "date": r["date"],
            } for r in blast_rows]
            self._send_json(200, {"match": match, "blast": blast})
            return
        if path == "/api/sets":
            conn = get_conn()
            try:
                rows = conn.execute("SELECT json FROM sets").fetchall()
            finally:
                conn.close()
            sets = []
            for r in rows:
                try:
                    obj = json.loads(r["json"])
                    sets.append(self._clean(obj, obj.get("id") or ""))
                except (ValueError, TypeError):
                    continue
            self._send_json(200, sets)
            return
        if path.startswith("/api/sets/"):
            sid = self._set_id()
            obj = self._api_json(sid) if sid else None
            if obj is None:
                self._send_json(404, {"ok": False, "error": "not found"})
                return
            self._send_json(200, self._clean(obj, sid))
            return
        self._serve_static(path)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/auth/register":
            username, password = self._auth_creds()
            if username is None:
                self._send_json(400, {"ok": False, "error": "invalid body"})
                return
            # K28: throttle registration attempts per client IP.
            if _rate_limited(self.client_address[0] if self.client_address else None):
                self._send_json(429, {"ok": False, "error": "too many attempts"})
                return
            conn = get_conn()
            try:
                taken = conn.execute(
                    "SELECT 1 FROM fc_users WHERE username=?", (username,)
                ).fetchone()
                if taken is not None:
                    self._send_json(409, {"ok": False, "error": "username taken"})
                    return
                salt = _new_salt()
                # K28 (#6): registration NEVER grants admin from a self-chosen
                # username. Everyone (including a fresh 'Danya' sign-up) gets
                # role 'user'. Admin is only ever established by the init_db()
                # promotion of a pre-existing 'Danya' account.
                conn.execute(
                    "INSERT INTO fc_users (username, password_hash, created, role) VALUES (?, ?, ?, ?)",
                    (username, salt + ":" + _hash_password(password, salt), _now(), "user"),
                )
                conn.commit()
            finally:
                conn.close()
            token = self._issue_session(username)
            self._send_json(200, {"token": token, "username": username})
            return
        if path == "/api/auth/login":
            username, password = self._auth_creds()
            if username is None:
                self._send_json(400, {"ok": False, "error": "invalid body"})
                return
            # K28: throttle login attempts per client IP (counts failures first).
            if _rate_limited(self.client_address[0] if self.client_address else None):
                self._send_json(429, {"ok": False, "error": "too many attempts"})
                return
            conn = get_conn()
            try:
                row = conn.execute(
                    "SELECT password_hash FROM fc_users WHERE username=?", (username,)
                ).fetchone()
            finally:
                conn.close()
            ok = False
            if row is not None:
                stored = row["password_hash"]
                if ":" in stored:
                    salt, digest = stored.split(":", 1)
                    ok = _hash_password(password, salt) == digest
            if not ok:
                self._send_json(401, {"ok": False, "error": "bad credentials"})
                return
            token = self._issue_session(username)
            self._send_json(200, {"token": token, "username": username})
            return
        if path == "/api/auth/logout":
            token = self._auth_bearer()
            if token:
                conn = get_conn()
                try:
                    conn.execute("DELETE FROM fc_sessions WHERE token=?", (token,))
                    conn.commit()
                finally:
                    conn.close()
            self._send_json(200, {"ok": True})
            return
        # K20: POST /api/leaderboard — record/update the acting user's best
        # result for a set+mode (requires a valid Bearer session; a guest cannot
        # write). Body {set_id, mode ('match'|'blast'), value}. Per user+set+mode
        # only an improvement overwrites the stored value (match: lower time is
        # better; blast: higher score is better).
        if path == "/api/leaderboard":
            username = self._acting_user()
            if username is None:
                self._send_json(401, {"ok": False, "error": "unauthorized"})
                return
            body = self._read_json_body()
            if not isinstance(body, dict):
                self._send_json(400, {"ok": False, "error": "invalid body"})
                return
            set_id = body.get("set_id")
            mode = body.get("mode")
            value = body.get("value")
            if (
                not isinstance(set_id, str) or not set_id
                or mode not in ("match", "blast")
                or not isinstance(value, (int, float))
            ):
                self._send_json(400, {"ok": False, "error": "invalid body"})
                return
            if self._api_json(set_id) is None:
                self._send_json(404, {"ok": False, "error": "set not found"})
                return
            value = float(value)
            conn = get_conn()
            try:
                row = conn.execute(
                    "SELECT value FROM fc_leaderboard "
                    "WHERE username=? AND mode=? AND set_id=?",
                    (username, mode, set_id),
                ).fetchone()
                if row is not None:
                    existing = row["value"]
                    better = value < existing if mode == "match" else value > existing
                    if better:
                        conn.execute(
                            "UPDATE fc_leaderboard SET value=?, date=? "
                            "WHERE username=? AND mode=? AND set_id=?",
                            (value, _now(), username, mode, set_id),
                        )
                else:
                    conn.execute(
                        "INSERT INTO fc_leaderboard (username, mode, set_id, value, date) "
                        "VALUES (?, ?, ?, ?, ?)",
                        (username, mode, set_id, value, _now()),
                    )
                conn.commit()
            finally:
                conn.close()
            self._send_json(200, {"ok": True})
            return
        # K18: POST /api/sets/{id}/bookmark adds a set to the acting user's list.
        if path.startswith("/api/sets/") and path.endswith("/bookmark"):
            username = self._acting_user()
            if username is None:
                self._send_json(401, {"ok": False, "error": "unauthorized"})
                return
            sid = unquote(path[len("/api/sets/"):-len("/bookmark")])
            if self._api_json(sid) is None:
                self._send_json(404, {"ok": False, "error": "not found"})
                return
            conn = get_conn()
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO fc_my_sets (username, set_id, added) VALUES (?, ?, ?)",
                    (username, sid, _now()),
                )
                conn.commit()
            finally:
                conn.close()
            self._send_json(200, {"ok": True})
            return
        # K22: POST /api/sets/{id}/cards — append new cards to an EXISTING set.
        # Requires a valid Bearer session. Authorization mirrors the K21 DELETE
        # gate exactly: anonymous -> 401, set missing -> 404, non-author
        # non-admin -> 403; admin (Danya) or the set's author allowed. New cards
        # are deduplicated by lowercased `word` against existing words AND within
        # the incoming batch (first occurrence wins). The existing
        # topic/lesson_meta/author are preserved.
        if path.startswith("/api/sets/") and path.endswith("/cards"):
            username = self._acting_user()
            if username is None:
                self._send_json(401, {"ok": False, "error": "unauthorized"})
                return
            sid = unquote(path[len("/api/sets/"):-len("/cards")])
            body = self._read_json_body()
            if (
                not isinstance(body, dict)
                or not isinstance(body.get("cards"), list)
                or not body["cards"]
            ):
                self._send_json(400, {"ok": False, "error": "invalid body"})
                return
            conn = get_conn()
            try:
                row = conn.execute(
                    "SELECT json, author FROM sets WHERE id=?", (sid,)
                ).fetchone()
            finally:
                conn.close()
            if row is None:
                self._send_json(404, {"ok": False, "error": "not found"})
                return
            allowed = self._is_admin(username) or row["author"] == username
            if not allowed:
                self._send_json(403, {"ok": False, "error": "forbidden: only the author or admin can add cards to this set"})
                return
            # Validate every incoming card: needs a non-empty word + translation.
            parsed = []
            for card in body["cards"]:
                if not isinstance(card, dict):
                    self._send_json(400, {"ok": False, "error": "invalid body"})
                    return
                word = card.get("word")
                translation = card.get("translation")
                if (
                    not isinstance(word, str) or not word.strip()
                    or not isinstance(translation, str) or not translation.strip()
                ):
                    self._send_json(400, {"ok": False, "error": "invalid body"})
                    return
                newcard = {"word": word, "translation": translation}
                if isinstance(card.get("examples"), list):
                    newcard["examples"] = card["examples"]
                if isinstance(card.get("family"), str):
                    newcard["family"] = card["family"]
                parsed.append(newcard)
            obj = json.loads(row["json"])
            existing = obj.get("cards", []) if isinstance(obj, dict) else []
            seen = {
                c["word"].strip().lower()
                for c in existing
                if isinstance(c, dict) and isinstance(c.get("word"), str) and c["word"].strip()
            }
            added = []
            for card in parsed:
                key = card["word"].strip().lower()
                if key and key not in seen:
                    seen.add(key)
                    added.append(card)
            # Preserve the existing set shape (topic/lesson_meta/author intact);
            # only the cards array grows.
            obj["cards"] = existing + added
            conn = get_conn()
            try:
                conn.execute(
                    "UPDATE sets SET json=? WHERE id=?",
                    (json.dumps(obj, ensure_ascii=False), sid),
                )
                conn.commit()
            finally:
                conn.close()
            self._send_json(200, {
                "id": sid,
                "added": len(added),
                "cards": len(obj["cards"]),
                "ok": True,
            })
            return
        if path != "/api/sets":
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        body = self._read_json_body()
        if not isinstance(body, dict):
            self._send_json(400, {"ok": False, "error": "invalid JSON body"})
            return
        sid = uuid.uuid4().hex
        author = self._acting_user() or "guest"
        obj = self._clean(body, sid, author)
        conn = get_conn()
        try:
            conn.execute(
                "INSERT INTO sets (id, json, created, author) VALUES (?, ?, ?, ?)",
                (sid, json.dumps(obj, ensure_ascii=False), _now(), author),
            )
            # The set's author automatically has it in their own list.
            if author != "guest":
                conn.execute(
                    "INSERT OR IGNORE INTO fc_my_sets (username, set_id, added) VALUES (?, ?, ?)",
                    (author, sid, _now()),
                )
            conn.commit()
        finally:
            conn.close()
        self._send_json(200, {"id": sid, "ok": True})

    def do_PUT(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/sets/"):
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        sid = self._set_id()
        body = self._read_json_body()
        if not isinstance(body, dict):
            self._send_json(400, {"ok": False, "error": "invalid JSON body"})
            return
        existing = self._api_json(sid)
        if existing is None:
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        # K30: authorization gate on updating a set — mirror the K21 DELETE
        # permission policy so PUT is not an unauthenticated write path:
        #   - anonymous: denied (401)
        #   - admin (Danya): may edit any set
        #   - any other logged-in user: may edit ONLY sets they authored
        #     (author == username); editing someone else's set -> 403.
        username = self._acting_user()
        if username is None:
            self._send_json(401, {"ok": False, "error": "unauthorized"})
            return
        row = get_conn().execute(
            "SELECT author FROM sets WHERE id=?", (sid,)
        ).fetchone()
        if row is None:
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        allowed = self._is_admin(username) or row["author"] == username
        if not allowed:
            self._send_json(
                403, {"ok": False, "error": "forbidden: only the author or admin can edit this set"}
            )
            return
        # Preserve the existing author across updates.
        obj = self._clean(body, sid, existing.get("author"))
        conn = get_conn()
        try:
            conn.execute(
                "UPDATE sets SET json=? WHERE id=?",
                (json.dumps(obj, ensure_ascii=False), sid),
            )
            conn.commit()
        finally:
            conn.close()
        self._send_json(200, {"id": sid, "ok": True})

    def do_DELETE(self):
        path = urlparse(self.path).path
        # K18: DELETE /api/sets/{id}/bookmark removes a set from the user's list.
        if path.startswith("/api/sets/") and path.endswith("/bookmark"):
            username = self._acting_user()
            if username is None:
                self._send_json(401, {"ok": False, "error": "unauthorized"})
                return
            sid = unquote(path[len("/api/sets/"):-len("/bookmark")])
            conn = get_conn()
            try:
                conn.execute(
                    "DELETE FROM fc_my_sets WHERE username=? AND set_id=?", (username, sid)
                )
                conn.commit()
            finally:
                conn.close()
            self._send_json(200, {"ok": True})
            return
        if not path.startswith("/api/sets/"):
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        sid = self._set_id()
        # K21: permission gate on deleting a set from the shared collection.
        #   - anonymous: denied (401)
        #   - admin (Danya): may delete any set
        #   - any other logged-in user: may delete ONLY sets they authored
        #     (author == username); deleting someone else's set -> 403.
        # Removing a set from one's own list (unbookmark) is a separate call,
        # DELETE /api/sets/{id}/bookmark, and stays open to any logged-in user.
        username = self._acting_user()
        if username is None:
            self._send_json(401, {"ok": False, "error": "unauthorized"})
            return
        conn = get_conn()
        try:
            row = conn.execute(
                "SELECT author FROM sets WHERE id=?", (sid,)
            ).fetchone()
            if row is None:
                self._send_json(404, {"ok": False, "error": "not found"})
                return
            allowed = self._is_admin(username) or row["author"] == username
            if not allowed:
                self._send_json(
                    403, {"ok": False, "error": "forbidden: only the author or admin can delete this set"}
                )
                return
            # Remove the set and drop its references from my-sets/leaderboard so
            # no stale bookmark or score points at a deleted set.
            conn.execute("DELETE FROM sets WHERE id=?", (sid,))
            conn.execute("DELETE FROM fc_my_sets WHERE set_id=?", (sid,))
            conn.execute("DELETE FROM fc_leaderboard WHERE set_id=?", (sid,))
            conn.commit()
        finally:
            conn.close()
        self._send_json(200, {"ok": True})


def _now():
    return datetime.now(timezone.utc).isoformat()


def main():
    init_db()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print("FC sets backend listening on http://localhost:%d (db: %s)" % (PORT, DB_PATH))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        httpd.server_close()


if __name__ == "__main__":
    main()
