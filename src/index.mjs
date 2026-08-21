/**
 * Douyin panel — host half: the MULTI-HOST mirror.
 *
 * douyin.com sends `X-Frame-Options: DENY` plus a ByteDance-only CSP
 * `frame-ancestors`, so a plain iframe from the GUI origin can never load it.
 * And the estate spans MULTIPLE hosts — www.douyin.com for page+API work,
 * passport.douyin.com for the QR/SMS login modal — which in the real web act
 * as ONE client because Domain=.douyin.com unions their cookie jar.
 *
 * This proxy presses the whole estate onto ONE loopback origin:
 *
 *   http://127.0.0.1:<port>/~h/www.douyin.com/aweme/...    → https://www.douyin.com/aweme/...
 *   http://127.0.0.1:<port>/~h/passport.douyin.com/...     → https://passport.douyin.com/...
 *   http://127.0.0.1:<port>/                               → https://www.douyin.com/
 *
 * Every Set-Cookie Domain is stripped, so every mirrored host's cookies land
 * in ONE browser jar — the union is rebuilt exactly the way the estate
 * expects it. Douyin code runs in the mirror origin only, so it can never
 * reach the GUI's /api bridge. Media bytes stream straight from the CDNs.
 */
import { createServer } from 'node:http'
import { Agent, request as httpsRequest } from 'node:https'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { harvestChromeDouyinCookies } from './cookies-harvest.mjs'

export const name = 'dsh-douyin-panel'
export const inject = ['webServer']

const UPSTREAM_HOST = 'www.douyin.com'
const UPSTREAM_ORIGIN = `https://${UPSTREAM_HOST}`

/**
 * Hosts that must live inside the mirror for the estate to act as one client
 * (page + login). Everything else — CDNs, captcha widget, telemetry — goes
 * DIRECT; it never touches the mirror, by design.
 */
const MIRRORABLE_HOSTS = new Set([
  UPSTREAM_HOST,
  'passport.douyin.com',
  'login.douyin.com', // ── the QR + challenge + SMS center (the jssdk hits IT, not passport)
  'live.douyin.com', //   直播 sub-app
])

const REQUEST_TIMEOUT_MS = 20_000
const HTML_BUFFER_LIMIT = 24 * 1024 * 1024

/**
 * The session bridge: a user-pasted `Cookie:` header from their real browser
 * (DevTools → Network → any douyin.com request → copy request headers). The
 * mirror prepends these values to every upstream call, so the panel IS the
 * user's real logged-in session — no QR, no SMS, no slider walls ever again.
 *
 * Precedence per cookie name: imported value > browser jar.
 */
const COOKIE_FILE = process.env.DSH_DOUYIN_COOKIES_FILE
  ?? join(homedir(), '.dsh', 'storages', 'douyin-panel.cookies.json')

/** @type {Record<string, string> | undefined} */
let importedCookies

/**
 * Load (or reload) the imported-cookie map from disk.
 * @returns {Record<string, string>} parsed map, empty when absent/corrupt.
 */
function loadImportedCookies() {
  try {
    const parsed = JSON.parse(readFileSync(COOKIE_FILE, 'utf8'))
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      importedCookies = parsed
      return importedCookies
    }
  } catch { /* absent/corrupt */ }
  importedCookies = undefined
  return {}
}

/**
 * Parse raw `Cookie:` header text into a name→value map and persist it.
 * @param {string} raw - the pasted header (with or without the `Cookie:` prefix).
 * @returns {number} how many cookies were imported.
 */
export function importCookies(raw) {
  const text = raw.trim().replace(/^cookie:\s*/i, '').trim()
  if (text.length === 0 || text.length > 32_768) return -1
  /** @type {Record<string, string>} */
  const map = {}
  for (const pair of text.split(';')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (name === '' || /[^\w%.-]/.test(name) || /[\r\n;]/.test(value)) continue
    map[name] = value
  }
  const count = Object.keys(map).length
  if (count === 0) return -1
  mkdirSync(join(COOKIE_FILE, '..'), { recursive: true })
  writeFileSync(COOKIE_FILE, JSON.stringify(map, null, 2), { mode: 0o600 })
  importedCookies = map
  return count
}

/** Drop the import. */
export function clearImportedCookies() {
  try { unlinkSync(COOKIE_FILE) } catch { /* absent */ }
  importedCookies = undefined
}

/** The imported-cookie map — lazy-loaded on first request. */
function imported() {
  return importedCookies ?? loadImportedCookies()
}

/**
 * Auto-harvested session: pulled out of the user's REAL browser profile on a
 * timer — always-fresher than any pasted copy (session cookies rotate).
 * @type {Record<string, string>}
 */
let harvestedCookies = {}
/** @type {string} */
let harvestSource = ''

/**
 * Feed one successful harvest into the picture.
 * @param {Record<string, string>} cookies - name→value.
 * @param {string} source - e.g. "chrome:2026-08-20T…".
 */
export function setHarvest(cookies, source) {
  harvestedCookies = cookies
  harvestSource = source
}

/** The auto-harvest picture, with provenance. */
export function harvest() {
  return { cookies: harvestedCookies, source: harvestSource }
}

/** Transport-level headers that must not be forwarded in either direction. */
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
])

/** Upstream response headers that keep the page out of an iframe or pin TLS/reporting to the real origin. */
const DROP_RESPONSE_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'strict-transport-security',
  'report-to',
])

/**
 * Script shim injected at the very top of <head> of every mirrored page. The
 * page's dynamic URL minting — fetch/XHR/history/window.open, element
 * property writes like `iframe.src` (the login modal is one of those!),
 * anchor clicks, location.assign — gets every whitelisted absolute URL pulled
 * into the mirror scheme BEFORE it ships. `__STATION__` and `__MIRRORABLE__`
 * are baked per document by the server. Service workers are neutered: a
 * worker cache on a mirror origin is pure trouble.
 * Exported for scripts/shim-test.mjs.
 */
export const SHIM = `<script>(function () {
  try { Object.defineProperty(navigator, 'serviceWorker', { value: undefined }) } catch (e) {}
  var STATION = __STATION__
  var MIRRORED = __MIRRORABLE__
  function toLocal(u) {
    try {
      var url = new URL(u, location.href)
      if (MIRRORED.indexOf(url.hostname) !== -1) {
        // Hilarious bug we once shipped: carrying the SOURCE's protocol made
        // an http mirror go https:// — always keep the MIRROR's own scheme.
        return location.protocol + '//' + location.host + '/~h/' + url.hostname + url.pathname + url.search + url.hash
      }
      return url
    } catch (e) { return u }
  }
  // --- network entry points
  if (typeof window.fetch === 'function') {
    var ofetch = window.fetch
    window.fetch = function (input, init) {
      try {
        if (typeof input === 'string') input = toLocal(input)
        else if (input != null && typeof input.url === 'string') input = new Request(toLocal(input.url), input)
      } catch (e) {}
      return ofetch.call(this, input, init)
    }
  }
  var oopen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments)
    if (args.length > 1 && args[1] != null) args[1] = toLocal(String(args[1]))
    return oopen.apply(this, args)
  }
  // --- history + window.open
  function patchHistory(method) {
    var orig = history[method]
    history[method] = function (state, title, url) {
      return url == null ? orig.call(this, state, title) : orig.call(this, state, title, toLocal(url))
    }
  }
  try { patchHistory('pushState'); patchHistory('replaceState') } catch (e) {}
  if (typeof window.open === 'function') {
    var owopen = window.open
    window.open = function (url, target, features) {
      return owopen.call(this, url == null ? url : toLocal(String(url)), target, features)
    }
  }
  // --- location.assign/replace (configurable in Chrome; tolerate failure)
  try {
    var Loc = window.Location
    if (Loc && Loc.prototype) {
      var locNames = ['assign', 'replace']
      for (var li = 0; li < locNames.length; li++) {
        ;(function (n) {
          var orig = Loc.prototype[n]
          if (typeof orig === 'function') {
            Object.defineProperty(Loc.prototype, n, {
              configurable: true, writable: true,
              value: function (url) { return orig.call(this, toLocal(String(url))) },
            })
          }
        })(locNames[li])
      }
    }
  } catch (e) {}
  // --- element property writes: iframe.src (the login modal!), script.src, link.href
  try {
    var ePatches = [[window.HTMLIFrameElement, ['src']], [window.HTMLScriptElement, ['src']], [window.HTMLLinkElement, ['href']]]
    for (var p = 0; p < ePatches.length; p++) {
      var proto = ePatches[p][0] && ePatches[p][0].prototype
      var attrs = ePatches[p][1]
      if (!proto) continue
      for (var q = 0; q < attrs.length; q++) {
        ;(function (proto, attr) {
          var desc = Object.getOwnPropertyDescriptor(proto, attr)
          if (!desc || !desc.configurable || typeof desc.set !== 'function') return
          Object.defineProperty(proto, attr, {
            configurable: true, enumerable: desc.enumerable,
            get: desc.get,
            set: function (v) { return desc.set.call(this, toLocal(String(v))) },
          })
        })(proto, attrs[q])
      }
    }
  } catch (e) {}
  // --- anchor catches: SPA routers miss them; plain clicks otherwise escape
  document.addEventListener('click', function (event) {
    try {
      var a = event.target && event.target.closest ? event.target.closest('a[href]') : null
      if (a !== null) {
        var href = a.getAttribute('href')
        if (typeof href === 'string') {
          var local = toLocal(href)
          if (local !== href) a.setAttribute('href', local)
        }
      }
    } catch (e) {}
  }, true)
  // --- geometry channel → the embedding panel (narrowest no-scrollbar width)
  function reportFit() {
    try {
      if (window.parent === window) return
      var de = document.documentElement
      if (!de) return
      // scrollWidth forces a SYNCHRONOUS LAYOUT FLUSH — never run it on a
      // timer on a page full of <video>; only when the DOM actually changed,
      // inside an idle slice. Busy skipping: ONE pending callback at a time.
      var cw = de.clientWidth
      var sw = Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0)
      window.parent.postMessage({ __douyinPanel: true, kind: 'content-fit', clientWidth: cw, scrollWidth: sw, overflowPx: Math.max(0, sw - cw) }, '*')
    } catch (e) {}
  }
  var fitPending = false
  function scheduleFit() {
    if (fitPending) return
    fitPending = true
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(function () { fitPending = false; reportFit() }, { timeout: 900 })
    } else {
      setTimeout(function () { fitPending = false; reportFit() }, 250)
    }
  }
  // THE CHEAP OBSERVER PATTERN: mutation-driven + resize + load —no periodic reflush.
  try {
    new MutationObserver(scheduleFit).observe(document.documentElement, { childList: true, subtree: true, attributes: true })
  } catch (e) {}
  window.addEventListener('DOMContentLoaded', reportFit)
  window.addEventListener('load', reportFit)
  window.addEventListener('resize', scheduleFit)
  reportFit()
})()</script>`

/**
 * Bake the per-document shim: the page's own station id + the whitelist.
 * @param {string} station - the upstream host this document is served for.
 * @returns {string} the ready <script> tag.
 */
export function buildShim(station) {
  return SHIM
    .replace('__STATION__', JSON.stringify(station))
    .replace('__MIRRORABLE__', JSON.stringify([...MIRRORABLE_HOSTS]))
}

/**
 * Shared upstream agent: keep-alive so the SPA's API bursts do not pay a TLS
 * handshake per call.
 */
const upstreamAgent = new Agent({ keepAlive: true, maxSockets: 32 })

/**
 * Strip the fixes pinning a cookie to the real site: Domain scoping is the
 * estate's union model — dropping it rebuilds that union over the mirror's
 * own single origin; SameSite=None requires Secure, and Secure is refused
 * over plain http on loopback.
 * @param {string} value - one raw Set-Cookie header value.
 * @returns {string} the loopback-safe value.
 */
function rewriteSetCookie(value) {
  return value
    .replace(/;\s*domain=[^;]*/gi, '')
    .replace(/;\s*samesite=None/gi, '; SameSite=Lax')
    .replace(/;\s*secure\b/gi, '')
}

/**
 * All whitelisted absolute-URL forms inside an HTML document — plain AND
 * JSON-escaped — get pulled into the mirror scheme. SPA runtime configs carry
 * their API bases this way (the login modal's passport URL is one of those);
 * CDN/foreign hosts pass untouched.
 * @param {string} html - decoded document.
 * @returns {string} rewritten document.
 */
function pullAbsoluteUrlsIntoMirror(html) {
  for (const host of MIRRORABLE_HOSTS) {
    const hostPattern = host.replace(/\./g, '\\.')
    html = html
      .split(`https://${host}`).join(`/~h/${host}`)
      .split(`http://${host}`).join(`/~h/${host}`)
      .split(`https:\\/\\/${hostPattern}`).join(`\\/~h\\/${hostPattern}`)
  }
  return html
}

/**
 * Strip the inline CSP meta tags Douyin ships in its SSR head; the header
 * variant is already dropped at the proxy layer.
 * @param {string} html - decoded document.
 * @returns {string} document without CSP metas.
 */
function stripCspMetas(html) {
  return html.replace(/<meta\b[^>]*http-equiv=(["']?)\s*content-security-policy\s*\1[^>]*>/gi, '')
}

/**
 * The station's own <base> + shim land FIRST inside <head>: the base gives
 * EVERY relative reference in the doc a home on the right mirrored host (the
 * passport modal's relative XHRs resolve to its own station!), and the shim
 * runs before any preempted Douyin script sets up wrappers of its own.
 * @param {string} html - decoded document.
 * @param {string} station - the upstream host this document is served for.
 * @returns {string} document with base + shim installed.
 */
function injectBaseAndShim(html, station) {
  const inject = `<base href="/~h/${station}/">` + buildShim(station)
  const match = /<head(\s[^>]*)?>/i.exec(html)
  if (match === null) return inject + html
  return html.slice(0, match.index + match[0].length) + inject + html.slice(match.index + match[0].length)
}

/**
 * Decode a buffered upstream HTML body according to its content encoding.
 * @param {Buffer} body - buffered body.
 * @param {string | undefined} encoding - upstream content-encoding.
 * @returns {string} decoded text (identity on unknown encodings).
 */
function decodeBody(body, encoding) {
  try {
    if (encoding === 'br') return brotliDecompressSync(body).toString('utf8')
    if (encoding === 'gzip') return gunzipSync(body).toString('utf8')
    if (encoding === 'deflate') return inflateSync(body).toString('utf8')
  } catch { /* serve what arrived rather than failing the page */ }
  return body.toString('utf8')
}

/**
 * Parse one mirror request into its upstream leg. `/~h/<host>/<path>` maps to
 * the named whitelisted host; anything else maps to the main site.
 * @param {string | undefined} rawUrl - IncomingMessage.url.
 * @returns {{ host: string, path: string }}
 */
export function parseMirrorTarget(rawUrl) {
  const raw = typeof rawUrl === 'string' && rawUrl.startsWith('/') ? rawUrl : '/'
  const match = /^\/~h\/([^/]+)(\/.*)?$/.exec(raw)
  if (match !== null && MIRRORABLE_HOSTS.has(match[1])) {
    return { host: match[1], path: match[2] ?? '/' }
  }
  return { host: UPSTREAM_HOST, path: raw }
}

/**
 * The upstream Location for a redirect: whitelisted hosts collapse onto the
 * mirror scheme; everything else keeps its absolute form and goes direct.
 * @param {string} value - raw Location header.
 * @returns {string} rewritten Location.
 */
function rewriteLocation(value) {
  try {
    const url = new URL(value, `${UPSTREAM_ORIGIN}/`)
    if (MIRRORABLE_HOSTS.has(url.hostname)) {
      return `/~h/${url.hostname}${url.pathname}${url.search}${url.hash}`
    }
  } catch { /* leave exotic values untouched */ }
  return value
}

/**
 * The Referer the browser sent belongs to the mirror origin; rebase it onto
 * the SAME upstream host — estate servers expect douyin.com referers from
 * themselves. Defaults to the request URL itself (the document referer for
 * first-party API calls).
 * @param {string | undefined} referer - incoming Referer.
 * @param {{ host: string, path: string }} target - the routed upstream target.
 * @returns {string} the upstream Referer.
 */
function rewriteReferer(referer, target) {
  if (typeof referer === 'string') {
    try {
      const url = new URL(referer)
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
        // The referer may itself be in mirror scheme; rebase to true upstream form.
        const inner = parseMirrorTarget(url.pathname + url.search)
        return `https://${inner.host}${inner.path}`
      }
      return referer
    } catch { /* fall through */ }
  }
  return `https://${target.host}${target.path}`
}

/**
 * Build the upstream request headers for one mirror request: browser headers
 * forward (user-agent, client hints, sec-fetch-* — the estate expects an
 * ordinary desktop browser); the transport/identity set is rebuilt onto the
 * routed upstream host.
 * Exported for scripts/selftest.mjs.
 * @param {import('node:http').IncomingHttpHeaders} reqHeaders - mirror request headers.
 * @param {{ host: string, path: string }} target - routed upstream target.
 * @returns {Record<string, string | string[] | undefined>} upstream headers.
 */
/**
 * Merge the cookie picture for one upstream call: browser jar first,
 * imported (session-bridged) values override per name.
 * @param {string | undefined} jarHeader - the request's Cookie header.
 * @returns {string | undefined} the merged Cookie header, or none.
 */
export function mergeCookies(jarHeader) {
  /** @type {Record<string, string>} */
  const merged = {}
  if (typeof jarHeader === 'string') {
    for (const pair of jarHeader.split(';')) {
      const eq = pair.indexOf('=')
      if (eq > 0) merged[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
    }
  }
  Object.assign(merged, imported())
  Object.assign(merged, harvestedCookies) // auto-harvest wins: always the freshest
  if (Object.keys(merged).length === 0) return undefined
  return Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('; ')
}

/**
 * Build the upstream request headers for one mirror request: browser headers
 * forward (user-agent, client hints, sec-fetch-* — the estate expects an
 * ordinary desktop browser); the transport/identity set is rebuilt onto the
 * routed upstream host; the cookie picture merges jar + session bridge.
 * Exported for scripts/selftest.mjs.
 * @param {import('node:http').IncomingHttpHeaders} reqHeaders - mirror request headers.
 * @param {{ host: string, path: string }} target - routed upstream target.
 * @returns {Record<string, string | string[] | undefined>} upstream headers.
 */
export function buildUpstreamHeaders(reqHeaders, target) {
  /** @type {Record<string, string | string[] | undefined>} */
  const headers = {}
  for (const [key, value] of Object.entries(reqHeaders)) {
    if (HOP_BY_HOP.has(key) || key === 'host' || key === 'referer' || key === 'origin' || key === 'cookie') continue
    headers[key] = value
  }
  headers['host'] = target.host
  headers['origin'] = `https://${target.host}`
  headers['referer'] = rewriteReferer(reqHeaders.referer, target)
  const cookie = mergeCookies(reqHeaders.cookie)
  if (cookie !== undefined) headers['cookie'] = cookie
  return headers
}

/**
 * One mirror request → one upstream request. Streams non-HTML; buffers,
 * decodes, and rewrites HTML (csp strip → absolute-URL pull → base+shim)
 * before the browser sees a byte.
 * @param {import('node:http').IncomingMessage} req - mirror request.
 * @param {import('node:http').ServerResponse} res - mirror response.
 */
function proxyRequest(req, res) {
  const target = parseMirrorTarget(req.url)
  const headers = buildUpstreamHeaders(req.headers, target)

  const upstream = httpsRequest({
    host: target.host,
    path: target.path,
    method: req.method,
    headers,
    agent: upstreamAgent,
    timeout: REQUEST_TIMEOUT_MS,
  }, (up) => {
    const contentType = String(up.headers['content-type'] ?? '')
    const isHtml = contentType.includes('text/html')
    /** @type {Record<string, string | string[]>} */
    const out = {}
    for (const [key, value] of Object.entries(up.headers)) {
      if (value === undefined) continue
      if (HOP_BY_HOP.has(key) || DROP_RESPONSE_HEADERS.has(key)) continue
      if (key === 'content-length' || key === 'content-encoding' || key === 'set-cookie' || key === 'location') continue
      out[key] = value
    }
    if (typeof up.headers.location === 'string') out['location'] = rewriteLocation(up.headers.location)
    const setCookie = up.headers['set-cookie']
    if (setCookie !== undefined) out['set-cookie'] = setCookie.map(rewriteSetCookie)

    if (!isHtml) {
      // Assets/media stream straight through, compression included.
      if (typeof up.headers['content-length'] === 'string') out['content-length'] = up.headers['content-length']
      if (typeof up.headers['content-encoding'] === 'string') out['content-encoding'] = up.headers['content-encoding']
      res.writeHead(up.statusCode ?? 502, out)
      up.pipe(res)
      return
    }

    const chunks = []
    let buffered = 0
    let overflow = false
    up.on('data', (chunk) => {
      if (overflow) return
      buffered += chunk.length
      if (buffered > HTML_BUFFER_LIMIT) {
        overflow = true
        chunks.length = 0
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('douyin-panel: upstream HTML exceeded the buffer limit')
        return
      }
      chunks.push(chunk)
    })
    up.on('end', () => {
      if (overflow) return
      const html = injectBaseAndShim(stripCspMetas(pullAbsoluteUrlsIntoMirror(decodeBody(Buffer.concat(chunks), up.headers['content-encoding']))), target.host)
      out['content-type'] = contentType === '' ? 'text/html; charset=utf-8' : contentType
      out['content-length'] = String(Buffer.byteLength(html))
      out['cache-control'] = 'no-store'
      res.writeHead(up.statusCode ?? 502, out)
      res.end(html)
    })
    up.on('error', () => {
      if (res.headersSent) { res.destroy(); return }
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('douyin-panel: failed to read upstream response')
    })
  })

  upstream.on('timeout', () => { upstream.destroy(new Error('douyin-panel: upstream timeout')) })
  upstream.on('error', (err) => {
    req.socket.emit('douyin-panel-upstream-error', err)
    if (res.headersSent) { res.destroy(); return }
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`douyin-panel: cannot reach ${target.host} (${err instanceof Error ? err.message : String(err)})`)
  })
  req.on('aborted', () => { upstream.destroy() })
  req.pipe(upstream)
}

/**
 * Host plugin body: bring up the mirror on a PINNED loopback port and expose
 * it through the main web server's well-known meta route.
 *
 * Why pinned: Douyin's risk engine scores the (origin, cookie-jar) pair. A
 * churning port resets BOTH on every restart — cold-scan, slider walls,
 * broken QR login, 「当前网络异常」 — AND leaves residual pages pointing at
 * dead ports (the user's 「没有网络」). Pin it: the pair stays warm across
 * restarts. A genuine EADDRINUSE falls back to an OS-assigned port loudly.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 */
export function apply(ctx) {
  /** @type {import('node:http').Server} */
  let server
  const mirrorOrigin = () => {
    const address = server.address()
    return address !== null && typeof address === 'object' ? `http://127.0.0.1:${address.port}` : undefined
  }
  const envPort = Number(process.env.DSH_DOUYIN_PORT)
  const PINNED_PORT = Number.isSafeInteger(envPort) && envPort > 0 ? envPort : 39577

  ctx.effect(() => {
    server = createServer((req, res) => {
      try {
        proxyRequest(req, res)
      } catch (error) {
        ctx.logger.warn('douyin-panel: mirror request failed', error)
        if (!res.headersSent) { res.writeHead(500); res.end('douyin-panel: internal proxy error') }
      }
    })
    // Douyin keeps its websockets on its own hosts; nothing should upgrade here.
    server.on('upgrade', (_req, socket) => { socket.destroy() })
    server.on('error', (error) => {
      if (error?.code === 'EADDRINUSE') {
        ctx.logger.warn(`douyin-panel: port ${String(PINNED_PORT)} is occupied; a stale mirror may still hold it — falling back to a random port (the cookie jar goes cold this run)`)
        server.listen(0, '127.0.0.1')
      } else {
        ctx.logger.warn('douyin-panel: mirror server error', error)
      }
    })
    server.listen(PINNED_PORT, '127.0.0.1', () => {
      ctx.logger.info(`douyin-panel: Douyin mirror ready at ${mirrorOrigin()} — open the 抖音 tab in the GUI`)
    })
    return async () => {
      server.closeAllConnections()
      await new Promise((resolve) => { server.close(() => { resolve(undefined) }) })
    }
  }, 'douyin-panel: mirror server')

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/douyin-panel/meta',
      handler: (req, res) => {
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
        const origin = mirrorOrigin()
        if (origin === undefined) {
          res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'mirror-starting' }))
          return
        }
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        const picture = harvest()
        res.end(JSON.stringify({
          url: `${origin}/`,
          upstream: `${UPSTREAM_ORIGIN}/`,
          cookieImported: Object.keys(imported()).length > 0,
          harvest: Object.keys(picture.cookies).length > 0 ? { count: Object.keys(picture.cookies).length, source: picture.source } : undefined,
        }))
      },
    }),
    'douyin-panel: meta route',
  )

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/douyin-panel/cookies',
      handler: (req, res) => {
        if (req.method === 'PUT') {
          let body = ''
          req.on('data', (chunk) => {
            body += chunk
            if (body.length > 64_1024) { res.writeHead(413); res.end(); req.destroy() }
          })
          req.on('end', () => {
            let header = ''
            try {
              header = String(JSON.parse(body)?.header ?? '')
            } catch {
              res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ error: 'bad-json' }))
              return
            }
            const count = importCookies(header)
            if (count < 0) {
              res.writeHead(422, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ error: 'no-cookies-parsed' }))
              return
            }
            ctx.logger.info(`douyin-panel: session bridge imported ${String(count)} cookies`)
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ imported: count }))
          })
        } else if (req.method === 'DELETE') {
          clearImportedCookies()
          ctx.logger.info('douyin-panel: session bridge cleared')
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ cleared: true }))
        } else {
          res.writeHead(405)
          res.end()
        }
      },
    }),
    'douyin-panel: cookie route',
  )

  // Chrome-profile auto-harvest: pull the douyin session out of the user's
  // REAL browser profile every 15 minutes — pasted snacks keep being honored,
  // harvested ones always override Fresher-than-any-paste.
  ctx.effect(() => {
    const run = async () => {
      try {
        const result = await harvestChromeDouyinCookies()
        if (result === undefined) {
          ctx.logger.info('douyin-panel: session harvest — browser cookies low or blocked (user has never logged douyin there)')
          return
        }
        const same = JSON.stringify(result.cookies) === JSON.stringify(harvest().cookies)
        setHarvest(result.cookies, result.source)
        if (!same) ctx.logger.info(`douyin-panel: session harvest refreshed — ${String(result.count)} douyin cookies from ${result.source}`)
      } catch (error) {
        ctx.logger.warn('douyin-panel: session harvest failed', error)
      }
    }
    void run()
    const timer = setInterval(() => { void run() }, 15 * 60 * 1000)
    return () => { clearInterval(timer) }
  }, 'douyin-panel: session harvest')
}
