/**
 * Standalone mirror bootstrap for full-flow verification INDEPENDENT of the
 * running GUI (whose cordis Loader has the first module instance cached —
 * this fakes the cordis surface apply() actually needs and nothing more).
 */
import { apply } from '../src/index.mjs'

const disposers = []
const ctx = {
  logger: console,
  effect: (fn) => { disposers.push(fn()); },
  webServer: { register: () => () => {} },
}
apply(ctx)
const meta = await new Promise((resolve) => {
  const poll = setInterval(async () => {
    try {
      const port = await fetch('http://127.0.0.1:39577/').then(() => 39577).catch(() => undefined)
      if (port !== undefined) { clearInterval(poll); resolve({ url: `http://127.0.0.1:${String(port)}/` }) }
    } catch { /* retry */ }
  }, 200)
})
console.log(JSON.stringify(meta))
