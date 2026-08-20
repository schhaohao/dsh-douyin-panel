/**
 * Shim geometry test — REAL-WORLD METHODOLOGY: the page is a LIVE persistent
 * document; the iframe carrying the shim is INSERTED into it — the exact
 * mechanism the GUI panel uses. Never page.setContent: that swaps the whole
 * document and your listener silently dies with it.
 *
 * Asserts: shim runs → reports arrive → overflow = scrollWidth − clientWidth
 * at 300 → one-step answer ≈ the design's min 576 → at 580 zero overflow →
 * back to 300 the overflow reports again.
 */
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildShim } from '../src/index.mjs'

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

const profile = mkdtempSync(join(tmpdir(), 'dy-shim-'))
const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true })
const page = context.pages()[0] ?? await context.newPage()
page.on('pageerror', (e) => { console.log('[pageerror]', e.message.slice(0, 200)) })

const failures = []
const check = (label, cond, got) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${got === undefined ? '' : ` → ${JSON.stringify(got)}`}`)
  if (!cond) failures.push(label)
}

const INNER = `<!doctype html><html><head>${buildShim('www.douyin.com')}</head><body>
<div style="width:560px;height:40px;background:#123"></div>
</body></html>`

const fits = []
page.on('console', (m) => { if (m.text().startsWith('FIT ')) fits.push(JSON.parse(m.text().slice(4))) })

try {
  await page.goto('about:blank')
  await page.evaluate((src) => {
    window.addEventListener('message', (e) => {
      if (e.data?.__douyinPanel === true) console.log(`FIT ${JSON.stringify(e.data)}`)
    })
    const f = document.createElement('iframe')
    f.srcdoc = src
    f.style.width = '300px'
    f.style.height = '400px'
    f.style.border = 'none'
    document.body.appendChild(f)
  }, INNER)
  await page.waitForTimeout(1500)
  console.log('reports:', fits.length)
  if (fits.length === 0) throw new Error('no fit reports arrived at all')
  const last = fits[fits.length - 1]
  check('overflow ≈ 276', last.overflowPx >= 250 && last.overflowPx <= 300, last.overflowPx)
  const answer = last.clientWidth + last.overflowPx
  check(`one-step answer ${String(answer)} ≈ 576`, answer >= 540 && answer <= 600, last)

  // widen the iframe into zero-overflow territory
  await page.evaluate(() => { document.querySelector('iframe').style.width = '580px' })
  await page.waitForTimeout(1500)
  const fits2 = fits[fits.length - 1]
  check('at 580: overflow ≈ 0', fits2.overflowPx === 0, fits2.overflowPx)

  // and narrowing back reports the overflow again — no sticky state
  await page.evaluate(() => { document.querySelector('iframe').style.width = '300px' })
  await page.waitForTimeout(1500)
  const fits3 = fits[fits.length - 1]
  check('back at 300: overflow ≈ 276 again', fits3.overflowPx >= 250 && fits3.overflowPx <= 300, fits3.overflowPx)
} finally {
  await context.close()
}
if (failures.length > 0) process.exit(1)
console.log('\nShim geometry checks passed.')
