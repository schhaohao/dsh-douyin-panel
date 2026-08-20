/**
 * tsdown config for the browser client bundle, standalone (the monorepo's
 * shared preset only resolves workspace packages, so a link-installed plugin
 * states the same contract by hand):
 *
 * - One CJS closure-factory artifact that hands itself to
 *   window.__ModuleLoader__.load({ id, factory }) — the loader materializes it
 *   and resolves the seed-table specifiers below through the injected require.
 * - Seed-table specifiers stay external; everything else (none today) inlines.
 *
 * The external list mirrors packages/client/web/src/platform.ts
 * (PLATFORM_MODULES + PRELOADED_CLIENT_EXTERNALS) plus this plugin's own
 * declared module requests (dsh.client.external in package.json — none today).
 */

/** Specifiers the browser module table answers — never bundled. */
const SEED_TABLE = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
])

/** The plugin id the loader registers this bundle under (=== package name). */
const ID = 'dsh-douyin-panel'

export default {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  sourcemap: true,
  deps: {
    neverBundle: (specifier: string): boolean => SEED_TABLE.has(specifier),
    alwaysBundle: (specifier: string): boolean => !SEED_TABLE.has(specifier),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}
