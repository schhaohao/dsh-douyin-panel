// Synthetic unit: parse + decrypt round-trip with the exact recipe.
import { pbkdf2Sync, createCipheriv, createDecipheriv } from 'node:crypto'
import { readFileSync } from 'node:fs'

// pull the module's own decrypt recipe inline (mirrors cookies-harvest.mjs)
function decryptV10(blob, password) {
  try {
    if (blob.length <= 3 || blob.subarray(0, 3).toString('utf8') !== 'v10') return undefined
    const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1')
    const cipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
    return Buffer.concat([cipher.update(blob.subarray(3)), cipher.final()]).toString('utf8')
  } catch { return undefined }
}
function pbkdf(password) { return pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1') }
function encryptV10(value, password) {
  const key = pbkdf(password)
  const c = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
  return Buffer.concat([Buffer.from('v10'), c.update(value, 'utf8'), c.final()])
}

// 1) round-trip
const blob = encryptV10('the-real-ttwid-value-12345', 'my-test-password')
const plain = decryptV10(blob, 'my-test-password')
console.log('round-trip:', plain === 'the-real-ttwid-value-12345' ? 'PASS' : `FAIL → ${String(plain)}`)

// 2) wrong password doesn't silently decrypt to garbage: should throw → undefined
console.log('wrong-key guarded:', decryptV10(blob, 'WRONG') === undefined ? 'PASS' : 'FAIL')

// 3) last block: odd-length values
for (const v of ['a', 'ab', 'sessionid=abcdef0123456789ABCDEF0123456789x', '汉化token']) {
  console.log('odd len:', v.slice(0, 14), '→', decryptV10(encryptV10(v, 'k'), 'k') === v ? 'PASS' : 'FAIL')
}
