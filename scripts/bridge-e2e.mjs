/**
 * The Cookie-bridge card e2e — idempotent: starts by clearing the bridge,
 * then walks the whole storyboard (open card → CTA visible → garbage → error
 * → paste OK → label+refresh bump → reopen → clear → the CTA back).
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

const failures = []
const check = (label, cond, got) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${got === undefined ? '' : ` → ${JSON.stringify(got)}`}`)
  if (!cond) failures.push(label)
}

// start from a clean slate
await fetch('http://127.0.0.1:3080/douyin-panel/cookies', { method: 'DELETE' })
const profile = mkdtempSync(join(tmpdir(), 'dy-bridge-'))
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome', headless: true, viewport: { width: 1600, height: 1000 },
  args: ['--no-first-run', '--no-default-browser-check'],
})
const page = context.pages()[0] ?? await context.newPage()

try {
  await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForSelector('[data-douyin-panel] .douyin-tab', { timeout: 60_000 })
  await page.waitForTimeout(800)
  await page.click('[data-douyin-panel] .douyin-tab')
  await page.waitForSelector('[data-douyin-panel] .douyin-root', { timeout: 15_000 })
  await page.waitForTimeout(1500)
  const src = await page.evaluate(() => document.querySelector('[data-douyin-panel] iframe')?.src ?? null)
  check('entry is /jingxuan', src?.includes('/jingxuan') === true, src)
  check('label is 🔑 登录', (await page.evaluate(() => document.querySelector('[data-douyin-panel] .douyin-action')?.textContent)) === '🔑 登录')

  await page.click('[data-douyin-panel] .douyin-action:has-text("登录")')
  await page.waitForSelector('.douyin-bridge', { timeout: 10_000 })
  check('card: CTA 去登录 exists', (await page.evaluate(() => document.querySelector('.douyin-bridge-btn.primary')?.textContent)) === '打开 douyin.com 去登录 →')
  await page.fill('.douyin-bridge-input', 'no-equals-in-here')
  await page.click('.douyin-bridge-btn.primary:has-text("导入并刷新")')
  await page.waitForFunction(() => {
    const notes = [...document.querySelectorAll('.douyin-bridge-note')]
    return notes.some((n) => (n.textContent ?? '').includes('❌'))
  }, undefined, { timeout: 10_000 })
  const errorNote = await page.evaluate(() => [...document.querySelectorAll('.douyin-bridge-note')].map((n) => n.textContent).find((t) => t?.includes('❌')))
  check('garbage → 导入失败 note', (errorNote ?? '').includes('❌'), errorNote)

  await page.fill('.douyin-bridge-input', 'Cookie: ttwid=test-id; prov=x; custom=y')
  await page.click('.douyin-bridge-btn.primary:has-text("导入并刷新")')
  await page.waitForFunction(() => {
    const notes = [...document.querySelectorAll('.douyin-bridge-note')]
    return notes.some((n) => (n.textContent ?? '').includes('✅'))
  }, undefined, { timeout: 10_000 })
  const okNote = await page.evaluate(() => [...document.querySelectorAll('.douyin-bridge-note')].map((n) => n.textContent).find((t) => t?.includes('已导入')))
  check('paste → 已导入 note', (okNote ?? '').includes('已导入'), okNote)
  check('label flipped to 🔑 已登录', (await page.evaluate(() => document.querySelector('[data-douyin-panel] .douyin-action')?.textContent)) === '🔑 已登录')
  const src2 = await page.evaluate(() => document.querySelector('[data-douyin-panel] iframe')?.src ?? null)
  check('iframe bumped (r=1) while STILL /jingxuan', src2?.includes('/jingxuan') === true && src2.includes('r=1'), src2)

  // the card is still open after the refresh — click 清除 straight away
  await page.click('.douyin-bridge-btn.danger:has-text("清除")')
  await page.waitForFunction(() => {
    const notes = [...document.querySelectorAll('.douyin-bridge-note')]
    return notes.some((n) => (n.textContent ?? '').includes('已清除'))
  }, undefined, { timeout: 10_000 })
  check('clear → 已清除 note + CTA 去登录 back', (await page.evaluate(() => document.querySelector('.douyin-bridge-btn.primary')?.textContent)) === '打开 douyin.com 去登录 →')
  check('label back to 🔑 登录', (await page.evaluate(() => document.querySelector('[data-douyin-panel] .douyin-action')?.textContent)) === '🔑 登录')
} finally { await context.close() }
if (failures.length > 0) process.exit(1)
console.log('\nAll bridge-card checks passed.')
