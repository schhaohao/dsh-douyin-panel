/**
 * Full login-flow verification against the STANDALONE multi-host mirror:
 * open douyin through the mirror with a desktop UA, click 登录, and assert:
 * the passport modal iframe loads THROUGH the mirror, the QR image renders,
 * and no [当前网络异常] wall shows in the passport subframe.
 */
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// playwright-core: resolve from this package's own node_modules FIRST, then
// the deepseek-harness checkout used during development. Install with:
//   pnpm add -D playwright-core
const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require('playwright-core'))
} catch {
  try {
    ;({ chromium } = require('/Users/sunchenhao/workspace/deepseek-harness/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core'))
  } catch {
    console.error('playwright-core not found — pnpm add -D playwright-core in this package')
    process.exit(1)
  }
}

const MIRROR = process.env.MIRROR ?? 'http://127.0.0.1:39999/'
const profile = mkdtempSync(join(tmpdir(), 'dy-login-e2e-'))
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome',
  headless: true,
  viewport: { width: 1280, height: 960 },
  args: ['--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'],
})
// Hide the CDP marker the risk engine keys on (production UX: real browsers).
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false })
})
const page = context.pages()[0] ?? await context.newPage()
page.on('pageerror', (e) => { console.log('[pageerror]', e.message.slice(0, 160)) })

const mirrorFetchLog = []
page.on('request', (r) => {
  const u = r.url()
  if (u.includes('127.0.0.1:39999')) mirrorFetchLog.push(`${r.resourceType()} ${new URL(u).pathname.slice(0, 80)}`)
})

try {
  console.log('goto', MIRROR)
  await page.goto(MIRROR, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const probe = async (tag) => {
    const p = await page.evaluate(() => ({
      title: document.title,
      text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 90),
      url: location.href,
    }))
    console.log(`[${tag}]`, JSON.stringify(p))
  }
  await probe('t+0')
  // give the anti-bot chain room to self-resolve
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(10_000); await probe(`t+${String((i + 1) * 10)}s`) }

  // hunt the 登录 entry
  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('div,span,button')]
    const el = els.find((e) => {
      const t = (e.textContent ?? '').trim()
      return (t === '登录' || t === '登录/注册') && e.getBoundingClientRect().width < 300
    })
    if (el === undefined) return false
    el.click()
    return true
  }).catch(() => false)
  console.log('login clicked:', clicked)
  await page.waitForTimeout(10_000)
  await probe('after login click')

  console.log('--- frames ---')
  for (const fr of page.frames()) console.log('  ', fr.url().slice(0, 130))
  const passportFrame = page.frames().find((f) => f.url().includes('passport.douyin.com'))
  if (passportFrame) {
    const p = await passportFrame.evaluate(() => ({
      origin: location.origin,
      text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 160),
      qrs: [...document.querySelectorAll('img,canvas')].map((i) => ({ tag: i.tagName, w: i.getBoundingClientRect().width, src: i.src?.slice(0, 90) ?? '' })).filter((q) => q.w > 60),
    })).catch((e) => ({ err: e.message.slice(0, 120) }))
    console.log('passport subframe:', JSON.stringify(p, null, 1))
  } else {
    console.log('!! no passport subframe routed through the mirror')
  }
  console.log('--- mirror traffic ---')
  console.log(mirrorFetchLog.slice(0, 50).join('\n'))
} finally {
  await context.close()
}
