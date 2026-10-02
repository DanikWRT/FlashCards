#!/usr/bin/env python3
"""K22 API verification: POST /api/sets/{id}/cards permission + append/dedup.

Runs against a temp DB started by the harness. Cases:
  1. unauth POST -> 401
  2. user B POST to A's set -> 403
  3. A POST 2 new cards -> 200, count grows, GET shows appended; dedup skips existing word
  4. admin Danya POST -> 200
"""
import json
import time
import urllib.request
import urllib.error

def call(method, path, body=None, token=None):
    url = 'http://127.0.0.1:5199' + path
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        b = e.read().decode('utf-8')
        try:
            return e.code, json.loads(b)
        except Exception:
            return e.code, {'raw': b}

tag = 'k22' + str(int(time.time()))[-6:]
A = 'alice' + tag
B = 'bob' + tag
P = 'pass1234'

print('== register A / B / Danya ==')
st, ra = call('POST', '/api/auth/register', {'username': A, 'password': P})
assert st == 200, (st, ra)
st, rb = call('POST', '/api/auth/register', {'username': B, 'password': P})
assert st == 200, (st, rb)
st, rd = call('POST', '/api/auth/register', {'username': 'Danya', 'password': P})
assert st == 200, (st, rd)
ta, tb, td = ra['token'], rb['token'], rd['token']

print('== A creates a set ==')
st, rs = call('POST', '/api/sets', {'topic': 'K22 set', 'cards': [{'word': 'alpha', 'translation': 'альфа'}, {'word': 'BETA', 'translation': 'бета'}]}, ta)
assert st == 200, (st, rs)
sid = rs['id']

results = []

def case(name, ok):
    results.append((name, ok))
    print(('  PASS' if ok else '  FAIL') + '  ' + name)

st, r = call('POST', '/api/sets/%s/cards' % sid, {'cards': [{'word': 'x', 'translation': 'y'}]})
case('unauth POST -> 401', st == 401 and r.get('error') == 'unauthorized')

st, r = call('POST', '/api/sets/%s/cards' % sid, {'cards': [{'word': 'gamma', 'translation': 'гамма'}]}, tb)
case('user B POST -> 403', st == 403 and 'forbidden' in r.get('error', ''))

st, r = call('POST', '/api/sets/%s/cards' % sid, {'cards': [
    {'word': 'gamma', 'translation': 'гамма'},
    {'word': 'delta', 'translation': 'дельта'},
    {'word': 'delta', 'translation': 'дубликат'},
    {'word': 'beta', 'translation': 'дубликат2'},
]}, ta)
case('A POST -> 200 added==2, cards==4', st == 200 and r.get('added') == 2 and r.get('cards') == 4 and r.get('ok') is True)

st, r = call('GET', '/api/sets/%s' % sid)
words = [c['word'] for c in r['cards']]
case('GET shows appended cards', st == 200 and r['topic'] == 'K22 set' and words == ['alpha', 'BETA', 'gamma', 'delta'])
case('author preserved', r.get('author') == A)

st, r = call('POST', '/api/sets/%s/cards' % sid, {'cards': [{'word': 'epsilon', 'translation': 'эпсилон', 'family': 'eps'}]}, td)
case('admin Danya POST -> 200 added==1', st == 200 and r.get('added') == 1 and r.get('cards') == 5)

st, r = call('POST', '/api/sets/%s/cards' % sid, {'cards': []}, ta)
case('empty cards -> 400', st == 400)
st, r = call('POST', '/api/sets/%s/cards' % sid, {'cards': [{'word': 'x'}]}, ta)
case('missing translation -> 400', st == 400)

print('\n=== K22 API SUMMARY ===')
allok = all(ok for _, ok in results)
for n, ok in results:
    print(('PASS' if ok else 'FAIL'), '-', n)
print('OVERALL:', 'PASS' if allok else 'FAIL')
