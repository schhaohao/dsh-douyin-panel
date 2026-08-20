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
const profile = mkdtempSync(join(tmpdir(), 'dy-msg-'))
const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: { width: 1600, height: 1000 } })
const page = context.pages()[0] ?? await context.newPage()
try {
  await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
  // hook BEFORE opening the panel
  await page.evaluate(() => {
    window.__msgs = []
    window.addEventListener('message', (e) => {
      const d = e.data
      if (d && d.__douyinPanel === true) window.__msgs.push({ origin: e.origin, kind: d.kind, width: d.width })
    })
  })
  await page.waitForSelector('[data-douyin-panel] .douyin-tab', { timeout: 60_000 })
  await page.click('[data-douyin-panel] .douyin-tab')
  await page.waitForSelector('[data-douyin-panel] iframe', { timeout: 15_000 })
  await page.waitForTimeout(12_000)
  const msgs = await page.evaluate(() => window.__msgs.slice(0, 12))
  console.log('messages received:', JSON.stringify(msgs, null, 1))
  const dockW = await page.evaluate(() => document.querySelector('[data-douyin-panel] .douyin-dock')?.getBoundingClientRect().width)
  console.log('dock width now:', dockW)
} finally { await context.close() }
