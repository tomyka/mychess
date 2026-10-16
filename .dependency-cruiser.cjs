// Architecture rules. Protected from agent edits.
// The kit's rules, over every workspace package's src, then the repo's
// layering: the same rules lint holds in eslint.config.mjs, proved a second
// way on the resolved import graph.

// A package's source, its test files and its test-only entries.
const PACKAGE_SRC = '^(apps|packages)/[^/]+/src/';
const TEST_FILE = '\\.(test|spec)\\.[cm]?tsx?$';
// Test-only code that lives in src: db's test entry and web's component-test
// setup. Runtime code never imports them (rule below).
const TEST_ONLY_SRC = [
  '^packages/db/src/testing/',
  '^apps/web/src/test-setup\\.ts$',
];
// A package from node_modules, however pnpm lays it out.
const npm = (names) => `(^|/)node_modules/(${names})/`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make code hard to change and test.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-test-imports-in-src',
      severity: 'error',
      comment: 'Production code must not import test files.',
      from: { pathNot: TEST_FILE },
      to: { path: TEST_FILE },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment:
        "Production code must not depend on devDependencies (each package's own package.json).",
      from: { path: PACKAGE_SRC, pathNot: [TEST_FILE, ...TEST_ONLY_SRC] },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] },
    },

    // The direction of dependencies: web -> db -> domain -> chess, chess on
    // its own, and integrations beside them, reaching chess but never web or db.
    {
      name: 'chess-imports-only-chess-js-ts-fsrs-and-zod',
      severity: 'error',
      comment:
        'chess imports only chess.js, ts-fsrs, zod and its own files: no other package, framework, database or I/O.',
      from: { path: '^packages/chess/src/', pathNot: TEST_FILE },
      to: {
        pathNot: ['^packages/chess/src/', npm('chess\\.js|ts-fsrs|zod')],
      },
    },
    {
      name: 'chess-tests-import-only-chess-js-ts-fsrs-zod-vitest-and-fast-check',
      severity: 'error',
      comment:
        'chess tests import only chess.js, ts-fsrs, zod, vitest, fast-check and chess files.',
      from: { path: `^packages/chess/src/.*${TEST_FILE}` },
      to: {
        pathNot: [
          '^packages/chess/src/',
          npm('chess\\.js|ts-fsrs|zod|vitest|@vitest/[^/]+|fast-check'),
        ],
      },
    },
    {
      name: 'integrations-not-to-web-or-db',
      severity: 'error',
      comment:
        'integrations (external API clients) never depend on web or the database.',
      from: { path: '^packages/integrations/' },
      to: {
        path: [
          '^apps/',
          '^packages/db/',
          npm('next|react|react-dom|pg|drizzle-orm'),
        ],
      },
    },
    {
      name: 'domain-imports-only-zod-and-chess',
      severity: 'error',
      comment:
        'domain imports only zod, @mychess/chess and its own files: no framework, database or I/O.',
      from: { path: '^packages/domain/src/', pathNot: TEST_FILE },
      to: {
        pathNot: ['^packages/domain/src/', '^packages/chess/src/', npm('zod')],
      },
    },
    {
      name: 'domain-tests-import-only-zod-chess-and-vitest',
      severity: 'error',
      comment:
        'domain tests import only zod, @mychess/chess, vitest and domain files.',
      from: { path: `^packages/domain/src/.*${TEST_FILE}` },
      to: {
        pathNot: [
          '^packages/(domain|chess)/src/',
          npm('zod|vitest|@vitest/[^/]+'),
        ],
      },
    },
    {
      name: 'db-not-to-web',
      severity: 'error',
      comment: 'db must not depend on web (web -> db).',
      from: { path: '^packages/db/' },
      to: { path: ['^apps/', npm('next|react|react-dom')] },
    },
    {
      name: 'db-imports-only-domain-chess-drizzle-pg-and-zod',
      severity: 'error',
      comment:
        'db imports only @mychess/domain, @mychess/chess, drizzle-orm, pg, zod, Node built-ins and its own files.',
      from: {
        path: '^packages/db/src/',
        pathNot: [TEST_FILE, '^packages/db/src/testing/'],
      },
      to: {
        dependencyTypesNot: ['core'],
        pathNot: [
          '^packages/(db|domain|chess)/src/',
          npm('drizzle-orm|pg|zod'),
        ],
      },
    },
    {
      name: 'db-test-code-imports-only-db-deps-vitest-and-testcontainers',
      severity: 'error',
      comment:
        "db's test entry (src/testing) and tests import only what db imports, plus vitest and Testcontainers.",
      from: {
        path: ['^packages/db/src/testing/', `^packages/db/src/.*${TEST_FILE}`],
      },
      to: {
        dependencyTypesNot: ['core'],
        pathNot: [
          '^packages/(db|domain|chess)/src/',
          npm('drizzle-orm|pg|zod|vitest|@vitest/[^/]+|@testcontainers/[^/]+'),
        ],
      },
    },
    {
      name: 'web-reaches-the-database-only-through-db',
      severity: 'error',
      comment:
        'web reaches the database only through @mychess/db, never its migrations, nor a driver of its own.',
      from: { path: '^apps/web/src/' },
      to: {
        path: [npm('pg|drizzle-orm'), '^packages/db/src/migrations\\.ts$'],
      },
    },
    {
      name: 'runtime-not-to-test-only-entries',
      severity: 'error',
      comment:
        'Runtime code never imports a test-only entry (@mychess/db/testing) or test tooling.',
      from: { path: PACKAGE_SRC, pathNot: [TEST_FILE, ...TEST_ONLY_SRC] },
      to: {
        path: [
          ...TEST_ONLY_SRC,
          npm('vitest|@vitest/[^/]+|@testing-library/[^/]+'),
        ],
      },
    },
    {
      name: 'cross-package-through-entry-points',
      severity: 'error',
      comment:
        'Another package is reached only through its package.json exports, never its files.',
      from: { path: '^((apps|packages)/[^/]+)/' },
      to: {
        path: '^(apps|packages)/',
        pathNot: [
          '^$1/',
          '^packages/(domain|chess|integrations)/src/index\\.ts$',
          '^packages/db/src/(index|migrations)\\.ts$',
          '^packages/db/src/testing/index\\.ts$',
        ],
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage|reports|\\.stryker-tmp|\\.next)/' },
    tsPreCompilationDeps: true,
    // No tsConfig: there is no root project (each package has its own), and
    // no package uses `paths`; @mychess/* resolves through the workspace's
    // node_modules links and each package.json's exports.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
