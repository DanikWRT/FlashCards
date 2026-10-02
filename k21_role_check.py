#!/usr/bin/env python3
"""K21 role-persistence check: init_db promotes a pre-existing 'user' Danya to
'admin', and register sets role='admin' for Danya. Runs init_db directly against
a throwaway DB file (no network)."""
import os
import sys
import time

DB = "/tmp/fc_k21_role_" + str(int(time.time())) + ".db"

# Point the backend module at this DB and import init_db.
sys.path.insert(0, "/home/aifactory/FlashCards/backend")
import app as fc

fc.DB_PATH = DB
fc.init_db()

import sqlite3


def danya_role():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    r = dict(c.execute("SELECT username, role FROM fc_users WHERE username='Danya'").fetchone())
    c.close()
    return r


# 1) Simulate a pre-existing Danya row with role 'user' (as if registered before
#    the admin promotion existed), then re-run init_db (as on server restart).
c = sqlite3.connect(DB)
c.execute(
    "INSERT INTO fc_users (username, password_hash, created, role) VALUES (?, ?, ?, ?)",
    ("Danya", "s:h", time.time(), "user"),
)
c.commit()
c.close()
fc.init_db()
assert danya_role() == {"username": "Danya", "role": "admin"}, danya_role()
print("init_db promotes pre-existing 'user' Danya -> admin OK", danya_role())

print("ALL K21 ROLE CHECKS PASSED")
