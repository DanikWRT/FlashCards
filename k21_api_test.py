#!/usr/bin/env python3
"""K21 API verification: delete permissions (author / admin / anon).

Exercises the live backend (/tmp/fc_k21.db, port 5198) on a FRESH db:
  1. register users B and C (regular) and Danya (admin)
  2. each creates a set (authorship recorded)
  3. anonymous DELETE -> 401
  4. user B deleting C's set -> 403
  5. user B deleting his own set -> 200 (and it leaves shared collection)
  6. admin Danya deletes any other user's set -> 200
  7. DELETE /bookmark ("удалить из моих") removes from fc_my_sets for any
     logged-in user but leaves the set in the shared collection.
Uses only stdlib (urllib) so it runs headless.
"""
import json
import time
import urllib.request
import urllib.error

B = "http://127.0.0.1:5199/api"


def call(method, path, body=None, token=None):
    url = B + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, None


def reg(u):
    st, d = call("POST", "/auth/register", {"username": u, "password": "pass1234"})
    assert st == 200, (u, st, d)
    return d["token"]


def create_set(token, topic):
    st, d = call("POST", "/sets", {"topic": topic, "cards": [{"word": "x", "translation": "y"}]}, token)
    assert st == 200, (st, d)
    return d["id"]


def main():
    tag = "k21r" + str(int(time.time()))[-6:]
    UB, UC = "bob" + tag, "carol" + tag
    TB = reg(UB)
    TC = reg(UC)
    TD = reg("Danya")
    print("registered", UB, UC, "Danya")

    # 1) B and C author sets. Danya creates one too.
    sid_b = create_set(TB, "B's set")
    sid_c = create_set(TC, "C's set")
    sid_d = create_set(TD, "Danya's set")
    print("created sets:", sid_b[:6], sid_c[:6], sid_d[:6])

    # 2) anonymous DELETE -> 401
    st, _ = call("DELETE", "/sets/" + sid_c)
    assert st == 401, ("anon delete", st)
    print("anon DELETE -> 401 OK")

    # 3) B deleting C's (someone else's) set -> 403
    st, d = call("DELETE", "/sets/" + sid_c, token=TB)
    assert st == 403, ("B deletes C's set", st, d)
    # set must still exist
    st, d = call("GET", "/sets/" + sid_c)
    assert st == 200 and d["topic"] == "C's set", (st, d)
    print("B deletes C's set -> 403, set survives OK")

    # 4) B deleting his OWN set -> 200, gone from shared
    st, d = call("DELETE", "/sets/" + sid_b, token=TB)
    assert st == 200, (st, d)
    st, _ = call("GET", "/sets/" + sid_b)
    assert st == 404, ("set should be gone", st)
    print("B deletes own set -> 200, gone from shared OK")

    # 5) admin Danya deletes C's set -> 200
    st, d = call("DELETE", "/sets/" + sid_c, token=TD)
    assert st == 200, (st, d)
    st, _ = call("GET", "/sets/" + sid_c)
    assert st == 404
    print("admin Danya deletes C's set -> 200 OK")

    # 6) verify Danya's admin role lets them delete any recreated set.
    sid_d2 = create_set(TC, "C's second set")
    st, d = call("DELETE", "/sets/" + sid_d2, token=TD)
    assert st == 200, (st, d)
    print("admin Danya deletes another new set -> 200 OK")

    # 7) bookmark + unbookmark: adding to my-sets must NOT be blocked by the
    #    delete permission gate; unbookmark leaves the set in shared.
    st, d = call("POST", "/sets/" + sid_d + "/bookmark", token=TB)
    assert st == 200, (st, d)
    st, data = call("GET", "/my/sets", token=TB)
    assert sid_d in data["ids"], (data, sid_d)
    st, d = call("DELETE", "/sets/" + sid_d + "/bookmark", token=TB)
    assert st == 200, (st, d)
    st, _ = call("GET", "/sets/" + sid_d)
    assert st == 200, ("set must remain in shared after unbookmark", st)
    st, data = call("GET", "/my/sets", token=TB)
    assert sid_d not in data["ids"], data
    print("bookmark/unbookmark works; set stays in shared OK")

    # 8) B (non-admin) still cannot delete Danya's set -> 403
    st, d = call("DELETE", "/sets/" + sid_d, token=TB)
    assert st == 403, ("B deletes Danya's set", st, d)
    print("B deletes Danya's set -> 403 OK")

    print("ALL K21 API CHECKS PASSED")


if __name__ == "__main__":
    main()
