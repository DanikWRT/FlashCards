#!/usr/bin/env node
// PRIO verify: exercises the shared server-side set storage (python3 backend +
// SQLite) end-to-end via the REST API on :5199. Prints PASS/FAIL per check and
// exits 0 only when every check passes.
//
// Usage: node prio_verify.cjs   (backend must be running, e.g.
//        FC_DB_PATH=/tmp/fc.db python3 backend/app.py)

const BASE = process.env.FC_API_BASE || 'http://localhost:5199'

let failures = 0
function check(name, cond, extra) {
  const ok = !!cond
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  [' + extra + ']' : ''))
  if (!ok) failures++
  return ok
}

function expectStatus(res, want, name) {
  return check(name + ' (status ' + want + ')', res.status === want, 'got ' + res.status)
}

async function main() {
  console.log('PRIO verify against ' + BASE)

  // 0) health: root serves the app/SPA
  const root = await fetch(BASE + '/')
  expectStatus(root, 200, 'GET / serves app/SPA')
  const rootText = await root.text()
  check('GET / returns index.html content', /FlashCards|<div id="root">/.test(rootText), rootText.length + ' bytes')

  // 1) initial list is a JSON array
  const list0 = await fetch(BASE + '/api/sets')
  expectStatus(list0, 200, 'GET /api/sets')
  const sets0 = await list0.json()
  check('GET /api/sets returns an array', Array.isArray(sets0))

  // 2) create
  const payload = {
    topic: 'Демо приорити',
    lesson_meta: { unit: 1 },
    cards: [
      { word: 'apple', translation: 'яблоко' },
      { word: 'cat', translation: 'кот' },
    ],
  }
  const cre = await fetch(BASE + '/api/sets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  expectStatus(cre, 200, 'POST /api/sets creates')
  const creBody = await cre.json()
  check('POST returns {id, ok:true}', !!creBody.id && creBody.ok === true, 'id=' + creBody.id)
  const sid = creBody.id

  // 3) list contains it
  const list1 = await (await fetch(BASE + '/api/sets')).json()
  const found = list1.find((s) => s.id === sid)
  check('list contains newly created set', !!found && found.topic === payload.topic)

  // 4) get single
  const one = await fetch(BASE + '/api/sets/' + sid)
  expectStatus(one, 200, 'GET /api/sets/{id}')
  const oneBody = await one.json()
  check('single set has id/topic/cards shape',
    oneBody.id === sid && oneBody.topic === payload.topic &&
    Array.isArray(oneBody.cards) && oneBody.cards.length === 2 &&
    typeof oneBody.lesson_meta === 'object' && !('created' in oneBody),
    JSON.stringify({ id: oneBody.id, cards: oneBody.cards && oneBody.cards.length }))

  // 5) update
  const put = await fetch(BASE + '/api/sets/' + sid, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, topic: 'Демо изменено' }),
  })
  expectStatus(put, 200, 'PUT /api/sets/{id} updates')
  const putBody = await put.json()
  check('PUT returns {id, ok:true}', putBody.id === sid && putBody.ok === true)
  const afterPut = await (await fetch(BASE + '/api/sets/' + sid)).json()
  check('GET reflects the update (topic changed)', afterPut.topic === 'Демо изменено', afterPut.topic)

  // 6) 404 for missing id on GET
  const missing = await fetch(BASE + '/api/sets/deadbeef')
  expectStatus(missing, 404, 'GET /api/sets/{unknown} -> 404')

  // 7) delete
  const del = await fetch(BASE + '/api/sets/' + sid, { method: 'DELETE' })
  expectStatus(del, 200, 'DELETE /api/sets/{id}')
  const delBody = await del.json()
  check('DELETE returns {ok:true}', delBody.ok === true)

  // 8) gone from list, and single get 404
  const list2 = await (await fetch(BASE + '/api/sets')).json()
  check('list no longer contains deleted set', !list2.find((s) => s.id === sid))
  const delGet = await fetch(BASE + '/api/sets/' + sid)
  expectStatus(delGet, 404, 'GET deleted set -> 404')

  // 9) SPA fallback for a non-API path
  const spa = await fetch(BASE + '/some/spa/route')
  expectStatus(spa, 200, 'non-API path -> SPA fallback 200')
  check('SPA fallback serves index.html', /<div id="root">/.test(await spa.text()))

  // 10) malformed POST -> 400
  const bad = await fetch(BASE + '/api/sets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  })
  expectStatus(bad, 400, 'malformed POST -> 400')

  console.log('')
  if (failures === 0) {
    console.log('ALL CHECKS PASSED')
    process.exit(0)
  } else {
    console.log(failures + ' CHECK(S) FAILED')
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('FATAL: could not verify backend - is it running on ' + BASE + '?')
  console.error(String((e && e.message) || e))
  process.exit(1)
})
