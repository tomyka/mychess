import js from '@eslint/js';
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import nextPlugin from '@next/eslint-plugin-next';
import vitest from '@vitest/eslint-plugin';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// The quality kit's strict rules: the complexity and size budget and
// explicit boundary types, with no inline config (linterOptions below).
const TEST_FILES = ['**/*.test.ts', '**/*.test.tsx'];
const strictRules = [
  {
    plugins: { sonarjs },
    rules: {
      complexity: ['error', 10],
      'sonarjs/cognitive-complexity': ['error', 15],
      'max-depth': ['error', 4],
      'max-params': ['error', 4],
      'max-lines-per-function': [
        'error',
        { max: 60, skipBlankLines: true, skipComments: true },
      ],
      'max-lines': [
        'error',
        { max: 400, skipBlankLines: true, skipComments: true },
      ],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': true,
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
        },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: TEST_FILES,
    rules: {
      'vitest/no-conditional-expect': 'error',
      'vitest/no-identical-title': 'error',
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
];

// The direction of dependencies: web -> db -> domain -> chess, chess on its
// own (chess.js, ts-fsrs and zod only), and integrations (external API
// clients) beside them, reaching chess but never web or db.
const deepImport = {
  regex: '^@mychess/[^/]+/(src|dist)(/|$)',
  message: 'Import another package through its entry point, not its files.',
};
// A relative import that climbs out of its own package (e.g. `../../db/src/client`
// from domain, or `../../../apps/web/src/i18n` from db) reaches another package's
// files without going through `@mychess/*`, silently bypassing every rule below.
const crossPackageRelative = {
  regex: '^(\\.\\./)+(packages|apps|chess|db|domain|integrations|web)(/|$)',
  message:
    'Cross-package imports go through @mychess/*, never a relative path.',
};
// A relative import of a package's own test-only entry (`./testing`,
// `../testing`), which runtime code must no more reach than `@mychess/*/testing`.
const relativeTesting = {
  regex: '^(\\.\\.?/)+(.*/)?testing(/|$)',
  message: "Runtime code never imports its package's test-only entry.",
};
const restrictImports = (...patterns) => ({
  'no-restricted-imports': [
    'error',
    { patterns: [deepImport, crossPackageRelative, ...patterns] },
  ],
});
// Time and randomness are injected into the pure packages (domain, chess).
const pureSyntax = (pkg) => [
  'error',
  {
    selector: 'ImportExpression',
    message: `${pkg} does no dynamic imports.`,
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: `time and randomness are injected into ${pkg}.`,
  },
  {
    selector:
      "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: `time and randomness are injected into ${pkg}.`,
  },
  {
    selector:
      "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message: `time and randomness are injected into ${pkg}.`,
  },
];

export default defineConfig(
  {
    ignores: [
      '**/node_modules/',
      '**/.next/',
      '**/dist/',
      'packages/db/migrations/',
      '**/test-results/',
      '**/playwright-report/',
      '**/next-env.d.ts',
      '**/coverage/',
      // v1, kept as it was at tag v1-final: outside every gate.
      'archive/',
      // Claude Code's agent worktrees: full copies of the repository.
      '.claude/worktrees/',
      // The quality kit: its scripts, its reports and the root configs it owns.
      'quality/',
      // Repository tooling scripts (plain Node CLIs that print to stdout), as
      // quality/ above.
      'scripts/',
      'reports/',
      '.stryker-tmp/',
      '**/*.d.ts',
      '*.config.*',
      '.dependency-cruiser.cjs',
    ],
  },
  {
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  comments.recommended,
  {
    rules: {
      '@eslint-community/eslint-comments/require-description': 'error',
      '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
      // No `any`, no unchecked `as` (const assertions stay allowed).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'never' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      // Every switch over a union is exhaustive, and a `default` does not
      // count as covering the missing cases.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        {
          considerDefaultExhaustiveForUnions: false,
          requireDefaultForNonUnion: true,
        },
      ],
    },
  },
  ...strictRules,
  {
    files: TEST_FILES,
    ...vitest.configs.recommended,
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/expect-expect': [
        'error',
        { assertFunctionNames: ['expect', 'expectTypeOf'] },
      ],
    },
  },
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    plugins: { '@next/next': nextPlugin },
    settings: { next: { rootDir: 'apps/web' } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  { rules: restrictImports() },
  {
    files: ['packages/chess/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      ...restrictImports(relativeTesting, {
        regex: '^(?!(chess\\.js|ts-fsrs|zod)$)(?!\\.\\.?/)',
        message:
          'chess imports only chess.js, ts-fsrs, zod and its own files: no other package, framework, database or I/O.',
      }),
      'no-restricted-syntax': pureSyntax('chess'),
    },
  },
  {
    files: ['packages/chess/src/**/*.test.ts'],
    rules: restrictImports({
      regex: '^(?!(chess\\.js|ts-fsrs|zod|vitest)$)(?!\\.\\.?/)',
      message:
        'chess tests import only chess.js, ts-fsrs, zod, vitest and chess files.',
    }),
  },
  {
    files: ['packages/domain/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      ...restrictImports(relativeTesting, {
        regex: '^(?!(zod|@mychess/chess)$)(?!\\.\\.?/)',
        message:
          'domain imports only zod, @mychess/chess and its own files: no framework, database or I/O.',
      }),
      'no-restricted-syntax': pureSyntax('domain'),
    },
  },
  {
    files: ['packages/domain/src/**/*.test.ts'],
    rules: restrictImports({
      regex: '^(?!(zod|@mychess/chess|vitest)$)(?!\\.\\.?/)',
      message:
        'domain tests import only zod, @mychess/chess, vitest and domain files.',
    }),
  },
  {
    // db runtime code: never web, next or react, and never a test-only entry
    // or test tooling - only packages/db/test and db's own test entry
    // (src/testing) may reach those (see the block below).
    files: ['packages/db/**/*.ts'],
    ignores: [
      'packages/db/test/**/*.ts',
      'packages/db/src/testing/**/*.ts',
      'packages/db/vitest.config.ts',
    ],
    rules: restrictImports(relativeTesting, {
      regex:
        '^(@mychess/web|next|react|react-dom|vitest|@testcontainers/postgresql)(/|$)',
      message:
        'db must not depend on web (web -> db), nor on test tooling outside tests.',
    }),
  },
  {
    files: ['packages/db/test/**/*.ts', 'packages/db/src/testing/**/*.ts'],
    rules: restrictImports({
      regex: '^(@mychess/web|next|react|react-dom)(/|$)',
      message: 'db must not depend on web (web -> db).',
    }),
  },
  {
    // integrations: external API clients. They may reach chess and zod, never
    // web or the database.
    files: ['packages/integrations/**/*.ts'],
    rules: restrictImports(relativeTesting, {
      regex:
        '^(@mychess/web|@mychess/db|next|react|react-dom|pg|drizzle-orm)(/|$)',
      message:
        'integrations never depend on web or the database (@mychess/db, pg, drizzle-orm).',
    }),
  },
  {
    files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
    ignores: ['*