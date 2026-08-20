/**
 * Pure host-half self test — no network. Covers:
 *   mirror target routing (/~h/<host>/…), upstream header mapping per station
 *   (identity rebuild, referer rebasing per mirrored host, browser stack
 *   pass-through), and per-document shim baking.
 */
import { buildUpstreamHeaders, parseMirrorTarget, buildShim, mergeCookies, importCookies, clearImportedCookies } from '../src/index.mjs'

const failures = []
const check = (label, cond, got) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${got === undefined ? '' : ` → ${JSON.stringify(got)}`}`)
  if (!cond) failures.push(label)
}

// --- routing
check('bare path → www host', parseMirrorTarget('/aweme/v1/web/tab/feed/?a=1').host === 'www.douyin.com' && parseMirrorTarget('/aweme/v1/web/tab/feed/?a=1').path === '/aweme/v1/web/tab/feed/?a=1')
check('/ → www root', JSON.stringify(parseMirrorTarget('/')) === JSON.stringify({ host: 'www.douyin.com', path: '/' }))
check('~h passport routes', JSON.stringify(parseMirrorTarget('/~h/passport.douyin.com/passport/web/qrconnect/?x=1')) === JSON.stringify({ host: 'passport.douyin.com', path: '/passport/web/qrconnect/?x=1' }))
check('~h unknown host → NOT routed (falls to www with the literal path)', parseMirrorTarget('/~h/evil.example.com/x').host === 'www.douyin.com', parseMirrorTarget('/~h/evil.example.com/x'))

// --- header mapping, www station
const headers = buildUpstreamHeaders({
  'host': '127.0.0.1:39577',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126',
  'sec-ch-ua': '"Chromium";v="126"',
  'sec-fetch-dest': 'document',
  'accept': 'text/html',
  'cookie': 'ttwid=fake',
  'referer': 'http://127.0.0.1:39577/discover?x=1',
  'connection': 'keep-alive',
}, { host: 'www.douyin.com', path: '/aweme/v1/web/tab/feed/?a=1' })

check('browser UA passes through (desktop stack 不粘锅)', headers['user-agent'] === 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126', headers['user-agent'])
check('client hints pass through', headers['sec-ch-ua'] === '"Chromium";v="126"')
check('sec-fetch-dest kept', headers['sec-fetch-dest'] === 'document')
check('jar cookie merges when nothing imported', headers['cookie'] === 'ttwid=fake')
check('mergeCookies union', mergeCookies('a=1; b=2') === 'a=1; b=2')
importCookies('tt_csrf_token=imported-csrf')
check('imported overrides jar', mergeCookies('ttwid=fake; tt_csrf_token=OLD') === 'ttwid=fake; tt_csrf_token=imported-csrf', mergeCookies('ttwid=fake; tt_csrf_token=OLD'))
clearImportedCookies()
import { buildUpstreamHeaders as b2 } from '../src/index.mjs'
check('after clear: plain jar again', mergeCookies('ttwid=fake') === 'ttwid=fake')
check('referer rebased onto www.douyin.com', headers['referer'] === 'https://www.douyin.com/discover?x=1')
check('host is the routed station', headers['host'] === 'www.douyin.com')
check('hop-by-hop dropped', headers['connection'] === undefined)

// --- header mapping, passport station + mirrored referer
const pheaders = buildUpstreamHeaders({
  'referer': 'http://127.0.0.1:39577/~h/passport.douyin.com/passport/web/login/?type=qr',
}, { host: 'passport.douyin.com', path: '/passport/web/qrconnect/' })
check('passport host', pheaders['host'] === 'passport.douyin.com')
check('origin rebuilt onto the station', pheaders['origin'] === 'https://passport.douyin.com')
check('mirrored referer → true upstream referer', pheaders['referer'] === 'https://passport.douyin.com/passport/web/login/?type=qr', pheaders['referer'])

// --- shim baking
const shim = buildShim('passport.douyin.com')
check('shim has the station baked', shim.includes('var STATION = "passport.douyin.com"'))
check('shim has the whitelist baked', shim.includes('"passport.douyin.com"') && shim.includes('"www.douyin.com"'))
check('no placeholders left', !shim.includes('__STATION__') && !shim.includes('__MIRRORABLE__'))

if (failures.length > 0) process.exit(1)
console.log('\nAll upstream-routing + header checks passed.')
