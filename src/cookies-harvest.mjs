/**
 * Chrome-profile session harvester, macOS + zero npm deps.
 *
 * Chrome encrypts cookie VALUES with the old saltysalt scheme:
 *   key = PBKDF2(SHA1)(Chrome Safe Storage password, 'saltysalt', iter: 1003, 16B)
 *   IV  = 16 bytes of 0x20
 *   blob = 'v10' || AES-128-CBC(key, IV, value)
 *
 * The Safe Storage password itself is fetched with the macOS `security` CLI —
 * which pops the keychain consent dialog ONCE under the dsh host process
 * (『总是允许』 it, forever). The SQLite read goes through Apple's built-in
 * sqlite3 on a COPIED db dir (the running Chrome owns the lock).
 *
 * Chromium-family each gets one slot: find the first dir that actually has
 * douyin cookies. Everything fails soft: the harvester degrades into a no-op.
 */
import { execFile } from 'node:child_process'
import { mkdirSync, cpSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { pbkdf2Sync, createDecipheriv, createHash } from 'node:crypto'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

/** Chromium-family browsers we know how to read. */
const BROWSERS = [
  {
    name: 'chrome',
    profileRoot: join(homedir(), 'Library/Application Support/Google/Chrome'),
    keychainService: 'Chrome Safe Storage',
  },
  {
    name: 'edge',
    profileRoot: join(homedir(), 'Library/Application Support/Microsoft Edge'),
    keychainService: 'Microsoft Edge Safe Storage',
  },
  {
    name: 'chromium',
    profileRoot: join(homedir(), 'Library/Application Support/Chromium'),
    keychainService: 'Chromium Safe Storage',
  },
]

/** Cookie rows we care about — the whole .douyin.com estate. */
const COOKIE_QUERY = "SELECT host_key, name, value, quote(encrypted_value), expires_utc FROM cookies WHERE host_key LIKE '%douyin.com'";

/** Chrome's cookies epoch offset from Unix microseconds — 11644473600s. */
const CHROME_EPOCH_DELTA_US = 11_644_473_600n * 1_000_000n

/** Scratch dir for the copied cookie db. */
const WORK_DIR = join(tmpdir(), 'dsh-douyin-harvest')

/**
 * Reply the Chrome Safe Storage password for one browser. One exec; the OS
 * may pop the keychain consent dialog (指定一次『总是允许』).
 * @param {string} service - keychain service name.
 * @returns {Promise<string|undefined>} password, or undefined on denial.
 */
export async function fetchSafeStoragePassword(service) {
  try {
    const { stdout } = await execFileP('security', ['find-generic-password', '-s', service, '-w'], { timeout: 60_000 })
    const password = stdout.trim()
    return password === '' ? undefined : password
  } catch {
    return undefined
  }
}

/**
 * Locate the first browser profile dir that actually EXISTS.
 * @returns {{ name: string, profileRoot: string, keychainService: string, profileDir: string } | undefined}
 */
function findBrowser() {
  for (const browser of BROWSERS) {
    if (!existsSync(browser.profileRoot)) continue
    // prefer "Default", take any "Profile N" as backup
    const candidates = ['Default', ...readdirSync(browser.profileRoot).filter((d) => /^Profile \d+/.test(d))]
    for (const profile of candidates) {
      const dir = join(browser.profileRoot, profile)
      if (existsSync(join(dir, 'Cookies'))) {
        return { ...browser, profileDir: dir }
      }
    }
  }
  return undefined
}

/**
 * Copy the live SQLite trio to scratch and query it read-only.
 * @param {string} profileDir - the profile dir.
 * @returns {Promise<string>} raw sqlite output rows.
 */
async function queryCookies(profileDir) {
  mkdirSync(WORK_DIR, { recursive: true })
  for (const name of ['Cookies', 'Cookies-wal', 'Cookies-shm']) {
    try { cpSync(join(profileDir, name), join(WORK_DIR, name)) } catch { /* wal/shm may miss */ }
  }
  const { stdout } = await execFileP('sqlite3', ['-readonly', '-separator', '', join(WORK_DIR, 'Cookies'), COOKIE_QUERY], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 })
  return stdout
}

/**
 * Decrypt one Chrome v10 blob with the saltysalt recipe.
 * @param {Buffer} blob - encrypted_value BLOB.
 * @param {string} password - Safe Storage password.
 * @returns {string | undefined} plaintext value, undefined when it doesn't match.
 */
function decryptV10(blob, password) {
  try {
    if (blob.length <= 3 || blob.subarray(0, 3).toString('utf8') !== 'v10') return undefined
    const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1')
    const cipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
    const plain = Buffer.concat([cipher.update(blob.subarray(3)), cipher.final()])
    return plain.toString('utf8')
  } catch {
    return undefined
  }
}

/** Parse sqlite's `-separator` row text: hostnameplaintext-X``hex``. */
function parseRows(raw) {
  /** @type {{ host: string, name: string, plain: string, v10: Buffer | undefined, expiresMicros: bigint }[]} */
  const rows = []
  for (const line of raw.split('\n')) {
    if (line === '') continue
    // sqlite text columns can't carry 0x1f (our separator token; empty separator → sqlite3 defaults to '|' — silent parse death).
    const parts = line.split('')
    if (parts.length < 5) continue
    const [host, name, plain, quoteText, expiresText] = parts
    let v10
    const hexMatch = /^X'([0-9A-Fa-f]+)'$/.exec(quoteText ?? '')
    if (hexMatch !== null) v10 = Buffer.from(hexMatch[1], 'hex')
    let expiresMicros = 0n
    try { expiresMicros = BigInt(expiresText ?? '0') } catch { expiresMicros = 0n }
    rows.push({ host, name, plain: plain ?? '', v10, expiresMicros })
  }
  return rows
}

/**
 * Harvest: pull every live douyin cookie out of the current browser profile.
 * @returns {Promise<{ count: number, cookies: Record<string, string>, source: string } | undefined>} map (name→value), undefined when nothing/blocked.
 */
export async function harvestChromeDouyinCookies() {
  const browser = findBrowser()
  if (browser === undefined) return undefined
  const password = await fetchSafeStoragePassword(browser.keychainService)
  if (password === undefined) return undefined
  const raw = await queryCookies(browser.profileDir)
  const nowMicros = BigInt(Date.now()) * 1000n
  /** @type {Record<string, string>} */
  const cookies = {}
  for (const row of parseRows(raw)) {
    // prefer decrypted v10 when the plaintext column is empty
    let value = row.plain
    if (value === '' && row.v10 !== undefined) {
      value = decryptV10(row.v10, password) ?? ''
    }
    if (value === '') continue
    // expires_utc==0 means session cookie; otherwise honor the stamp
    if (row.expiresMicros !== 0n && row.expiresMicros - CHROME_EPOCH_DELTA_US < nowMicros) continue
    cookies[row.name] = value
  }
  const count = Object.keys(cookies).length
  if (count === 0) return undefined
  const now = new Date().toISOString()
  return { count, cookies, source: `${browser.name}:${now}` }
}
