/** Round 6 retry: dock-vs-grid geometry e2e after the frameOf fix. */
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

const GUI = 'http://127.0.0.1:3080/'
const profile = mkdtempSync(join(tmpdir(), 'dsh-douyin-verify-'))
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome',
  headless: true,
  viewport: { width: 1600, height: 1000 },
  args: ['--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'],
})
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false })
})
const page = context.pages()[0] ?? await context.newPage()

const failures = []
const check = (label, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`)
  if (!cond) failures.push(label)
}
const tracks = () => page.evaluate(() => {
  const overlay = document.querySelector('[data-shell-overlay]')
  const frame = overlay?.parentElement ?? null
  if (frame === null) return null
  const style = frame.style.gridTemplateColumns
  const nums = [...style.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => parseFloat(m[1]))
  return { style, sidebar: nums[0], center: nums.length >= 3 ? null : null, last: nums[nums.length - 1], width: frame.clientWidth }
})
const dockWidth = () => page.evaluate(() => document.querySelector('[data-douyin-panel] .douyin-dock')?.getBoundingClientRect().width ?? -1)
const centerWidth = () => page.evaluate(() => {
  const overlay = document.querySelector('[data-shell-overlay]')
  const frame = overlay?.parentElement ?? null
  if (frame === null) return -1
  // centerCol = the grid item between sidebarCol and detailsCol: second child
  const kids = [...frame.children].filter((c) => !c.hasAttribute('data-shell-overlay') && !c.classList.toString().includes('handle'))
  return kids[1]?.getBoundingClientRect().width ?? -1
})

try {
  await page.goto(GUI, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForSelector('[data-douyin-panel] .douyin-tab', { timeout: 60_000 })
  await page.waitForTimeout(400)
  const before = await tracks()
  const centerBefore = await centerWidth()
  console.log('before open:', JSON.stringify(before), 'center:', centerBefore)
  check('dock closed → third track 0', before.last === 0)
  check('dock closed → sidebar open', before.sidebar > 64)

  await page.click('[data-douyin-panel] .douyin-tab')
  await page.waitForSelector('[data-douyin-panel] .douyin-dock', { timeout: 15_000 })
  await page.waitForTimeout(900)
  const opened = await tracks()
  const dockW = await dockWidth()
  const centerOpened = await centerWidth()
  console.log('after open:', JSON.stringify(opened), 'dock:', dockW, 'center:', centerOpened)
  check('sidebar auto-collapsed to the 56 rail', opened.sidebar === 56)
  check('dock owns the third track (≈380 the user-tuned default)', opened.last !== undefined && Math.abs(opened.last - 380) < 8)
  check('dock rendered (≈380)', Math.abs(dockW - 380) < 8)
  check('center = before − dock + sidebar-freed exactly', Math.abs(centerBefore - centerOpened - (380 - (280 - 56))) < 12)

  const grip = page.locator('[data-douyin-panel] .douyin-grip')
  const box = await grip.boundingBox()
  if (box === null) throw new Error('grip not found')
  await page.mouse.move(box.x + box.width / 2, box.y + 500)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 400, box.y + 500, { steps: 5 })
  await page.waitForTimeout(300)
  const mid = await tracks()
  const centerMid = await centerWidth()
  await page.mouse.up()
  await page.waitForTimeout(400)
  console.log('after drag:', JSON.stringify(mid), 'center:', centerMid)
  check('no 520 cap anymore (drag → ≈780)', mid.last !== undefined && mid.last > 760 && mid.last < 800)
  check('center gave up exactly 400px', Math.abs(centerOpened - centerMid - 400) < 8)
  const persisted = await page.evaluate(() => localStorage.getItem('dsh-douyin:width'))
  check('drag persisted', persisted !== null && Math.abs(JSON.parse(persisted) - 780) < 12)

  // The dock concedes only against fit = viewport − sidebar − CENTER_FLOOR(240).
  await page.setViewportSize({ width: 1080, height: 1000 })
  await page.waitForTimeout(900)
  const narrow = await tracks()
  const narrowDock = await dockWidth()
  const narrowCenter = await centerWidth()
  console.log('narrow:', JSON.stringify(narrow), 'dock:', narrowDock, 'center:', narrowCenter)
  check('1080: dock = fit 1080-56-240=784', Math.abs(narrowDock - 784) < 8)
  check('1080: center at the 240 last-resort floor', Math.abs(narrowCenter - 240) < 8)

  await page.setViewportSize({ width: 400, height: 1000 })
  await page.waitForTimeout(900)
  const hiddenDock = await dockWidth()
  const iframeStillThere = await page.locator('[data-douyin-panel] iframe').count()
  console.log('extreme narrow 400: dock:', hiddenDock, 'iframe:', iframeStillThere)
  check('400: fit < min → dock hid', hiddenDock === 0)
  check('400: iframe subtree survived (never unmount)', iframeStillThere === 1)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.waitForTimeout(900)
  const revived = await tracks()
  check('dock revives from concession ≈780', revived.last !== undefined && Math.abs(revived.last - 780) < 12)

  await page.click('[data-douyin-panel] .douyin-action:has-text("收起")')
  await page.waitForSelector('[data-douyin-panel] .douyin-tab', { timeout: 15_000 })
  await page.waitForTimeout(900)
  const closed = await tracks()
  console.log('after close:', JSON.stringify(closed))
  check('third track restored to 0', closed.last === 0)
  check('sidebar restored (280)', closed.sidebar === 280)
  check('grid back to React style', closed.style === '280px minmax(0px, 1fr) 0px')
} finally {
  await context.close()
}
if (failures.length > 0) process.exit(1)
console.log('\nAll dock-geometry checks passed.')
