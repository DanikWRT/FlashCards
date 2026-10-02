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
POST   /api/auth/register {username,password} -> {token, username} (409 if taken)
POST   /api/auth/login    {username,password} -> {token, username} (401 bad creds)
POST   /api/auth/logout   Bearer token        -> {ok:true}
GET    /api/me            Bearer token        -> {username} (401 if invalid)
anything else           -> static file from dist/ (else index.html SPA fallback)
"""

import hashlib
import json
import os
import secrets
import sqlite3
import uuid
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
            "created TEXT"
            ")"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS fc_sessions ("
            "token TEXT PRIMARY KEY, "
            "username TEXT, "
            "created TEXT"
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
        # Guard against path traversal.
        clean = os.path.normpath(unquote(path)).lstrip("/\\")
        file_path = os.path.join(DIST_DIR, clean)
        if not file_path.startswith(os.path.normpath(DIST_DIR)):
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
        """Resolve the username for a valid Bearer session token, else None."""
        token = self._auth_bearer()
        if not token:
            return None
        conn = get_conn()
        try:
            row = conn.execute(
                "SELECT username FROM fc_sessions WHERE token=?", (token,)
            ).fetchone()
        finally:
            conn.close()
        return row["username"] if row else None

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
            conn = get_conn()
            try:
                taken = conn.execute(
                    "SELECT 1 FROM fc_users WHERE username=?", (username,)
                ).fetchone()
                if taken is not None:
                    self._send_json(409, {"ok": False, "error": "username taken"})
                    return
                salt = _new_salt()
                conn.execute(
                    "INSERT INTO fc_users (username, password_hash, created) VALUES (?, ?, ?)",
                    (username, salt + ":" + _hash_password(password, salt), _now()),
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
        conn = get_conn()
        try:
            row = conn.execute("SELECT 1 FROM sets WHERE id=?", (sid,)).fetchone()
            if row is not None:
                conn.execute("DELETE FROM sets WHERE id=?", (sid,))
                conn.commit()
            else:
                self._send_json(404, {"ok": False, "error": "not found"})
                return
        finally:
            conn.close()
        self._send_json(200, {"ok": True})


def _now():
    from datetime import datetime, timezone
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
