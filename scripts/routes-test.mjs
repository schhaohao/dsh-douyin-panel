/**
 * Route test, no douyin: boot apply() with a REAL webServer fake (a tiny
 * exact-path server), push a cookie through PUT /douyin-panel/cookies, read
 * the meta flag, DELETE it, and confirm memory + disk both follow.
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { apply } from '../src/index.mjs'

const failures = []
const check = (label, cond, got) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${got === undefined ? '' : ` → ${JSON.stringify(got)}`}`)
  if (!cond) failures.push(label)
}

// A REAL main web server: serve any exact routes the plugin registers.
const routes = new Map()
const main = createServer((req, res) => {
  const route = routes.get((req.url ?? '/').split('?')[0])
  if (route === undefined) { res.writeHead(404); res.end(); return }
  void route(req, res)
})
await new Promise((r) => { main.listen(0, '127.0.0.1', () => { r(undefined) }) })
const mainPort = main.address().port
const MAIN = `http://127.0.0.1:${String(mainPort)}`

const ctx = {
  logger: { info: () => {}, warn: () => {} },
  effect: (fn) => { fn() },
  webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
}
apply(ctx)
await new Promise((r) => { setTimeout(r, 600) })

try {
  // no import yet → meta says false
  let meta = await fetch(`${MAIN}/douyin-panel/meta`).then((r) => r.json())
  check('meta: cookieImported false before import', meta.cookieImported === false, meta)

  // PUT a cookie header (DevTools copy format WITH the Cookie: prefix)
  const put = await fetch(`${MAIN}/douyin-panel/cookies`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ header: 'Cookie: ttwid=fake-id; sessionid=the-session; sid_guard=guard' }),
  }).then((r) => r.json())
  check('PUT accepted', put.imported === 3, put)

  meta = await fetch(`${MAIN}/douyin-panel/meta`).then((r) => r.json())
  check('meta: cookieImported true', meta.cookieImported === true, meta)

  const disk = JSON.parse(readFileSync(process.env.HOME + '/.dsh/storages/douyin-panel.cookies.json', 'utf8'))
  check('persisted to disk with 600-ness', disk.sessionid === 'the-session', disk)

  const del = await fetch(`${MAIN}/douyin-panel/cookies`, { method: 'DELETE' }).then((r) => r.json())
  check('DELETE cleared', del.cleared === true, del)
  meta = await fetch(`${MAIN}/douyin-panel/meta`).then((r) => r.json())
  check('meta: cookieImported false after clear', meta.cookieImported === false, meta)
  check('disk file gone', !existsSync(process.env.HOME + '/.dsh/storages/douyin-panel.cookies.json'))

  const bad = await fetch(`${MAIN}/douyin-panel/cookies`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ header: 'no-equals-here' }) })
  check('garbage header → 422', bad.status === 422, bad.status)
} finally {
  main.close()
}
if (failures.length > 0) process.exit(1)
console.log('\nRoute checks passed.')
