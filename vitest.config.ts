// Quality-gate test config. Protected from agent edits.
//
// One run over the workspace (#25): each package's tests run under that
// package's own vitest config, as a vitest project, and one coverage report
// holds the kit's thresholds over `sourceGlobs`.
//
// The suites outside the gate, each with its reason, are `testsOutsideGate`
// in quality/quality.config.json; the test gate fails on any other test file
// no project runs (quality/gate.mjs).
import { readFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

interface QualityConfig {
  sourceGlobs: string[];
  testGlobs: string[];
  testsOutsideGate: { glob: string; reason: string }[];
  coverage: {
    lines: number;
    branches: number;
    functions: number;
    statements: number;
  };
}

interface PackageJson {
  name?: string;
  exports?: Record<string, string>;
}

const ROOT = fileURLToPath(new URL('.', import.meta.url));

const quality = JSON.parse(
  readFileSync(
    new URL('./quality/quality.config.json', import.meta.url),
    'utf8',
  ),
) as QualityConfig;

function packageJsonOf(dir: string): PackageJson | null {
  try {
    return JSON.parse(
      readFileSync(`${ROOT}${dir}/package.json`, 'utf8'),
    ) as PackageJson;
  } catch {
    return null;
  }
}

// Every workspace package's exports, resolved to its source in this tree.
// Without them @mychess/* resolves through node_modules to the real repo,
// and in Stryker's sandbox (a copy) another package's tests would load the
// unmutated files: a mutant could then be killed only by its own package's
// tests, while coverage counts every package's.
const workspaceAliases = ['apps', 'packages'].flatMap((group) =>
  readdirSync(`${ROOT}${group}`).flatMap((name) => {
    const dir = `${group}/${name}`;
    const pkg = packageJsonOf(dir);
    if (pkg?.name === undefined || pkg.exports === undefined) return [];
    const packageName = pkg.name;
    return Object.entries(pkg.exports).map(([subpath, target]) => ({
      find: new RegExp(
        `^${posix.join(packageName, subpath).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`,
      ),
      replacement: `${ROOT}${posix.join(dir, target)}`,
    }));
  }),
);

// The suites outside the gate under a project's root, relative to it.
function outsideGateUnder(root: string): string[] {
  return quality.testsOutsideGate
    .map(({ glob }) => glob)
    .filter((glob) => glob.startsWith(`${root}/`))
    .map((glob) => glob.slice(root.length + 1));
}

// One package's tests under its own config, with what the kit's root config
// set for every test.
function project(name: string, root: string, config: string) {
  return {
    extends: `./${root}/${config}`,
    root: `./${root}`,
    resolve: { alias: workspaceAliases },
    test: {
      name,
      allowOnly: false,
      sequence: { shuffle: false },
      exclude: ['**/node_modules/**', ...outsideGateUnder(root)],
    },
  };
}

export default defineConfig({
  test: {
    passWithNoTests: false,
    projects: [
      project('domain', 'packages/domain', 'vitest.config.ts'),
      project('db', 'packages/db', 'vitest.config.ts'),
      project('chess', 'packages/chess', 'vitest.config.ts'),
      project('web', 'apps/web', 'vitest.component.config.ts'),
      project('web-feature', 'apps/web', 'vitest.feature.config.ts'),
    ],
    coverage: {
      provider: 'v8',
      include: quality.sourceGlobs,
      exclude: quality.testGlobs,
      reporter: ['text-summary', 'json', 'html'],
      reportsDirectory: 'coverage',
      thresholds: quality.coverage,
    },
  },
});
