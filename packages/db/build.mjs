// Bundles the command-line entry points into self-contained ESM files, so a
// deploy needs only Node, dist/ and migrations/.
import { build } from 'esbuild';

await build({
  entryPoints: [
    'src/bin/migrate.ts',
    'src/bin/admin-grant.ts',
    'src/bin/admin-disable.ts',
    'src/bin/rate-limits-prune.ts',
  ],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  external: ['pg-native'],
  // pg is CommonJS and calls require(); an ESM bundle has to provide one.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
