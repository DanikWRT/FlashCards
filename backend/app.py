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
anything else           -> static file from dist/ (else index.html SPA fallback)
"""

import json
import os
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
    """Create the DB file's parent dir and the `sets` table if missing."""
    parent = os.path.dirname(DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = get_conn()
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS sets ("
            "id TEXT PRIMARY KEY, "
            "json TEXT, "
            "created TEXT"
            ")"
        )
        conn.commit()
    finally:
        conn.close()


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
    def _clean(obj, sid):
        """Shape a stored/request set into {id, topic, lesson_meta, cards}."""
        return {
            "id": sid,
            "topic": obj.get("topic", "") if isinstance(obj, dict) else "",
            "lesson_meta": obj.get("lesson_meta", {}) if isinstance(obj, dict) else {},
            "cards": obj.get("cards", []) if isinstance(obj, dict) else [],
        }

    # ---------------- methods ----------------

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/sets":
            conn = get_conn()
            try:
                rows = conn.execute("SELECT json FROM sets").fetchall()
            finally:
                conn.close()
            sets = []
            for r in rows:
                try:
                    sets.append(json.loads(r["json"]))
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
        if path != "/api/sets":
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        body = self._read_json_body()
        if not isinstance(body, dict):
            self._send_json(400, {"ok": False, "error": "invalid JSON body"})
            return
        sid = uuid.uuid4().hex
        obj = self._clean(body, sid)
        conn = get_conn()
        try:
            conn.execute(
                "INSERT INTO sets (id, json, created) VALUES (?, ?, ?)",
                (sid, json.dumps(obj, ensure_ascii=False), _now()),
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
        if self._api_json(sid) is None:
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        obj = self._clean(body, sid)
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
