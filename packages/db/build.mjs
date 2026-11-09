// Bundles the command-line entry points into self-contained ESM files, so a
// deploy needs only Node, dist/ and migrations/.
import { build } from 'esbuild';

const options = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outExtension: { '.js': '.mjs' },
  external: ['pg-native'],
  // pg is CommonJS and calls require(); an ESM bundle has to provide one.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
};

await build({
  ...options,
  entryPoints: [
    'src/bin/migrate.ts',
    'src/bin/admin-grant.ts',
    'src/bin/admin-disable.ts',
    'src/bin/rate-limits-prune.ts',
  ],
  outdir: 'dist',
});

// The persona seed (R-32, R-168) goes to local/dist, not dist/: the app image
// copies dist/ only, so the seed never reaches production.
await build({
  ...options,
  entryPoints: ['src/testing/personas/seed-personas.ts'],
  outdir: 'local/dist',
});
