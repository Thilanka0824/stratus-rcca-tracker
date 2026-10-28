// Node module-resolution hook for scripts/dump_rules.mjs.
//
// The app's modules import each other without file extensions
// (`import { authorize } from './auth'`), which Vite and vitest resolve and
// plain Node does not. When a relative specifier has no extension and the
// `.js` file exists next to the importer, resolve to that file; everything
// else passes through untouched. Registered with module.register(), so the
// app source is executed as-is — nothing is parsed by hand.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../');
  if (relative && context.parentURL && !/\.[cm]?jsx?$/.test(specifier)) {
    const candidate = new URL(`${specifier}.js`, context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
  }
  return next(specifier, context);
}
