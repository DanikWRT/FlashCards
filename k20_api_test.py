#!/usr/bin/env python3
"""K20 API verification: shared leaderboard linked to nicknames.

Exercises the live backend (/tmp/fc_k20.db, port 5199):
  1. register users A and B
  2. POST best-keep leaderboard entries (match lower-better, blast higher-better)
  3. guest POST must 401
  4. GET returns top-5 with usernames + topics
Uses only stdlib (urllib) so it runs headless.
"""
import json
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


def lb_post(token, mode, value, SID):
    st, d = call("POST", "/leaderboard", {"set_id": SID, "mode": mode, "value": value}, token)
    assert st == 200, (mode, value, st, d)
    return d


def main():
    import time
    # Create a fresh shared set for this run (the DB is fresh on first run,
    # then accumulates rows; the test asserts on THIS run's rows only).
    st, d = call("POST", "/sets", {"topic": "K20 Test Set", "cards": [{"word": "apple", "translation": "яблоко"}]})
    assert st == 200, (st, d)
    SID = d["id"]

    tag = "k20r" + str(int(time.time()))[-6:]
    UA, UB = "alice" + tag, "bob" + tag
    TA = reg(UA)
    TB = reg(UB)
    print("registered", UA, UB, "set", SID)

    # match: 30000 then worse 50000 -> keep 30000
    lb_post(TA, "match", 30000, SID)
    lb_post(TA, "match", 50000, SID)
    # bob match 20000 (new)
    lb_post(TB, "match", 20000, SID)
    # blast: A 150, B 250
    lb_post(TA, "blast", 150, SID)
    lb_post(TB, "blast", 250, SID)

    # guest POST -> 401
    st, d = call("POST", "/leaderboard", {"set_id": SID, "mode": "match", "value": 100})
    assert st == 401, (st, d)
    print("guest POST -> 401 OK")

    # GET (public)
    st, data = call("GET", "/leaderboard")
    assert st == 200, (st, data)
    print("GET leaderboard:")
    print(json.dumps(data, ensure_ascii=False, indent=2))

    match = data["match"]
    blast = data["blast"]
    # match sorted ascending by value; both bob rows carry the fastest 20000,
    # alice rows 30000. Ties may reorder, so assert presence + order by value.
    assert match[0]["value"] == 20000, match
    names_at_min = {r["username"] for r in match if r["value"] == 20000}
    assert UB in names_at_min, names_at_min
    names_30000 = {r["username"] for r in match if r["value"] == 30000}
    assert UA in names_30000, names_30000
    # blast sorted descending; bob rows carry max 250, alice 150.
    assert blast[0]["value"] == 250, blast
    names_at_max = {r["username"] for r in blast if r["value"] == 250}
    assert UB in names_at_max, names_at_max
    names_150 = {r["username"] for r in blast if r["value"] == 150}
    assert UA in names_150, names_150
    for r in match + blast:
        assert r["topic"] == "K20 Test Set", r
        assert r["username"]
    assert all(r["value"] >= match[0]["value"] for r in match[1:])  # ascending

    print("ALL K20 API CHECKS PASSED")


if __name__ == "__main__":
    main()
