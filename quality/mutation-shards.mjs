// The full mutation run in shards (#26): the source files split into N
// shards of about equal cost (MUTANT_COST, from the previous run's profile),
// one Stryker run per shard (a CI matrix job each), and the shards'
// mutation.json merged into one report whose score is checked against
// breakFull.
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib.mjs';

/** "3/16" -> { index: 3, total: 16 }; null if it is not i/N with 1 <= i <= N. */
export function parseShard(text) {
  const match = /^(\d+)\/(\d+)$/.exec(text ?? '');
  if (!match) return null;
  const index = Number(match[1]);
  const total = Number(match[2]);
  return index >= 1 && index <= total ? { index, total } : null;
}

export function shardName({ index, total }) {
  return `shard-${index}-of-${total}`;
}

/**
 * The shard reports in a directory listing, in shard order: { files } when
 * they are shard-1-of-N.json to shard-N-of-N.json for one N, else { error }.
 * A run missing a shard has no total score.
 */
export function completeShardSet(fileNames) {
  const shards = fileNames
    .filter(isShardReportName)
    .map((f) => ({ f, m: /^shard-(\d+)-of-(\d+)\.json$/.exec(f) }))
    .map(({ f, m }) => ({ f, index: Number(m[1]), total: Number(m[2]) }));
  if (shards.length === 0) return { error: 'No shard reports to merge.' };
  const totals = [...new Set(shards.map((s) => s.total))];
  if (totals.length > 1)
    return {
      error: `Shard reports of different splits: of ${totals.join(', of ')}.`,
    };
  const [total] = totals;
  const files = Array.from(
    { length: total },
    (_, i) => shards.find((s) => s.index === i + 1)?.f,
  );
  const missing = files.flatMap((f, i) => (f ? [] : [i + 1]));
  if (missing.length > 0)
    return {
      error: `Missing shard reports: ${missing.map((i) => `${i}/${total}`).join(', ')}.`,
    };
  return { files };
}

export function isShardReportName(fileName) {
  return /^shard-\d+-of-\d+\.json$/.test(fileName);
}

/**
 * Split [{ file, weight }] into `total` shards of about equal weight: the
 * heaviest file first, each to the lightest shard so far (the lower index on
 * a tie). The same files and weights always give the same split.
 */
export function splitShards(weights, total) {
  const shards = Array.from({ length: total }, () => ({
    files: [],
    weight: 0,
  }));
  const heaviestFirst = [...weights].sort(
    (a, b) =>
      b.weight - a.weight || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
  );
  for (const { file, weight } of heaviestFirst) {
    const lightest = shards.reduce((min, s) =>
      s.weight < min.weight ? s : min,
    );
    lightest.files.push(file);
    lightest.weight += weight;
  }
  for (const s of shards) s.files.sort();
  return shards;
}

/**
 * What one mutant costs a shard, in integer units (so every shard computes
 * the same split), fitted on run 38189247116's 39 finished shards of 40.
 * Shard minutes were ~ 0.067 per mutant + 1.55 more per timed-out one
 * (RMSE 17 minutes, against 41 for a flat time per shard), and a static
 * mutant ~ 0.10. 10 units are a mutant's 0.067 minutes. A timeout waits out
 * Stryker's timeout and restarts the worker; nearly all are static mutants
 * of widely imported modules (a db schema, a module-level value). The
 * number of related test files added nothing once timeouts were known, so
 * the split does not use it. Not covered: never run.
 */
export const MUTANT_COST = { run: 10, static: 15, timeout: 240, noCoverage: 1 };

/**
 * A db schema file's mutant with no previous result: every one is static, and
 * 3 in 5 timed out (the 39 shards' schema files: 280 of 473).
 */
const SCHEMA_MUTANT_COST = Math.round(
  0.6 * MUTANT_COST.timeout + 0.4 * MUTANT_COST.static,
);
const SCHEMA_FILE = /^packages\/db\/src\/(?:.+\/)?schema\.ts$/;

/** A profile entry's counts -> what its mutants cost together. */
function profileCost({ mutants, timeout, static: stat, noCoverage }) {
  return (
    timeout * MUTANT_COST.timeout +
    stat * MUTANT_COST.static +
    noCoverage * MUTANT_COST.noCoverage +
    (mutants - timeout - stat - noCoverage) * MUTANT_COST.run
  );
}

/**
 * [{ file, mutants }] (today's counts) -> [{ file, weight }]. A file the
 * profile holds costs what its mutants cost last time, per mutant; a file it
 * does not (new, or no previous run) costs SCHEMA_MUTANT_COST per mutant if it
 * is a db schema file, else MUTANT_COST.run.
 */
export function shardWeights(counts, profile) {
  return counts.map(({ file, mutants }) => {
    const entry = profile.files[file];
    if (entry && entry.mutants > 0)
      return {
        file,
        weight: Math.round((mutants * profileCost(entry)) / entry.mutants),
      };
    const each = SCHEMA_FILE.test(file) ? SCHEMA_MUTANT_COST : MUTANT_COST.run;
    return { file, weight: mutants * each };
  });
}

/**
 * The shard reports' classes of mutant per file, over the previous profile:
 * a file no report holds (its shard failed) keeps its previous entry. Classes
 * do not overlap: timed out (static or not), else static, else not covered.
 */
export function mutantProfile(shardReports, previous = { files: {} }) {
  const files = { ...previous.files };
  for (const report of shardReports)
    for (const [file, data] of Object.entries(report.files)) {
      const entry = { mutants: 0, timeout: 0, static: 0, noCoverage: 0 };
      for (const m of data.mutants) {
        entry.mutants++;
        if (m.status === 'Timeout') entry.timeout++;
        else if (m.static) entry.static++;
        else if (m.status === 'NoCoverage') entry.noCoverage++;
      }
      files[file] = entry;
    }
  const sorted = Object.fromEntries(
    Object.keys(files)
      .sort()
      .map((f) => [f, files[f]]),
  );
  return { files: sorted };
}

/**
 * A file path as a Stryker --mutate pattern: Stryker matches patterns with
 * minimatch, so a Next.js route such as app/tournament/[slug]/page.tsx would
 * not match itself. Each glob character becomes a one-character class.
 */
export function mutatePattern(file) {
  return file.replace(/[[\]{}()*?]/g, '[$&]');
}

/** The gate's score: (killed + timeout) / (those + survived + not covered). */
export function scoreReport(report) {
  const counts = { Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0 };
  const survivors = [];
  for (const [file, data] of Object.entries(report.files)) {
    for (const m of data.mutants) {
      if (m.status in counts) counts[m.status]++;
      if (m.status === 'Survived' || m.status === 'NoCoverage')
        survivors.push({ file, mutant: m });
    }
  }
  const detected = counts.Killed + counts.Timeout;
  const total = detected + counts.Survived + counts.NoCoverage;
  const score = total === 0 ? 100 : Math.round((detected / total) * 1000) / 10;
  return { score, detected, counts, survivors };
}

/**
 * The report with only the given source files. Stryker keeps every file of
 * its incremental file in the report, mutated this run or not, so a shard
 * whose cached incremental file is from another split (or another shard
 * count) would also report that split's files; the merge refuses a file in
 * two shards. Test files stay: they describe the tests, not the split.
 */
export function onlyFiles(report, files) {
  const own = new Set(files);
  return {
    ...report,
    files: Object.fromEntries(
      Object.entries(report.files).filter(([file]) => own.has(file)),
    ),
  };
}

/**
 * Merge the shards' mutation.json reports into one. Each Stryker run numbers
 * its mutants and tests from 0, so ids get the shard's prefix ("3-17"); a test
 * file several shards report keeps one entry per test name. A source file in
 * two shards is an error: the split gives every file to exactly one.
 */
export function mergeReports(shardReports) {
  if (shardReports.length === 0) throw new Error('No shard reports to merge.');
  // An empty shard's report carries only its schema version.
  const base =
    shardReports.find((r) => Object.keys(r.files).length > 0) ??
    shardReports[0];
  const merged = {
    schemaVersion: base.schemaVersion,
    thresholds: base.thresholds,
    projectRoot: base.projectRoot,
    files: {},
    testFiles: {},
  };
  shardReports.forEach((report, i) => mergeShard(merged, report, `${i + 1}-`));
  return merged;
}

function mergeShard(merged, report, prefix) {
  const testIds = mergeTestFiles(merged.testFiles, report.testFiles, prefix);
  const renameTests = (ids) =>
    ids === undefined ? undefined : ids.map((id) => testIds.get(id) ?? id);
  for (const [file, data] of Object.entries(report.files)) {
    if (file in merged.files)
      throw new Error(`${file} is in more than one shard report.`);
    merged.files[file] = {
      ...data,
      mutants: data.mutants.map((m) => ({
        ...m,
        id: `${prefix}${m.id}`,
        coveredBy: renameTests(m.coveredBy),
        killedBy: renameTests(m.killedBy),
      })),
    };
  }
}

/** Adds one shard's test files; returns its test ids -> the merged ids. */
function mergeTestFiles(mergedTestFiles, testFiles = {}, prefix) {
  const ids = new Map();
  for (const [file, data] of Object.entries(testFiles)) {
    const target = (mergedTestFiles[file] ??= { ...data, tests: [] });
    for (const test of data.tests) {
      const known = target.tests.find((t) => t.name === test.name);
      if (known) ids.set(test.id, known.id);
      else {
        const id = `${prefix}${test.id}`;
        target.tests.push({ ...test, id });
        ids.set(test.id, id);
      }
    }
  }
  return ids;
}

// Stryker's own dependencies, resolved from @stryker-mutator/core (pnpm does
// not hoist them), so the counts and the report match the installed Stryker.
function strykerRequire() {
  const core = realpathSync(
    join(ROOT, 'node_modules', '@stryker-mutator', 'core'),
  );
  return createRequire(join(core, 'package.json'));
}

const quietLogger = {
  isTraceEnabled: () => false,
  isDebugEnabled: () => false,
  isInfoEnabled: () => false,
  isWarnEnabled: () => false,
  isErrorEnabled: () => false,
  isFatalEnabled: () => false,
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
};

/**
 * Each file's source and mutants, from Stryker's instrumenter with Stryker's
 * default mutator options (stryker.config.mjs sets none).
 */
async function instrumentEach(files) {
  const { Instrumenter } = await import(
    pathToFileURL(strykerRequire().resolve('@stryker-mutator/instrumenter'))
      .href
  );
  const instrumenter = new Instrumenter(quietLogger);
  const instrumented = [];
  for (const file of files) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    const { mutants } = await instrumenter.instrument(
      [{ name: join(ROOT, file), mutate: true, content: source }],
      { plugins: null, excludedMutations: [], ignorers: [] },
    );
    instrumented.push({ file, source, mutants });
  }
  return instrumented;
}

/** [{ file, mutants }]: each file's mutant count. */
export async function countMutants(files) {
  return (await instrumentEach(files)).map(({ file, mutants }) => ({
    file,
    mutants: mutants.length,
  }));
}

/**
 * The report of a shard whose files no test imports. Stryker's vitest runner
 * runs only the tests related to the mutated files, finds none and stops
 * without a report; the full run would have reported every one of these
 * mutants as not covered, so the shard does.
 */
export async function noCoverageReport(files) {
  const position = ({ line, column }) => ({
    line: line + 1,
    column: column + 1,
  });
  const report = { schemaVersion: '1.0', files: {} };
  for (const { file, source, mutants } of await instrumentEach(files))
    report.files[file] = {
      language: /\.tsx?$/.test(file) ? 'typescript' : 'javascript',
      source,
      mutants: mutants.map((m) => ({
        id: m.id,
        mutatorName: m.mutatorName,
        replacement: m.replacement,
        location: {
          start: position(m.location.start),
          end: position(m.location.end),
        },
        status: 'NoCoverage',
        coveredBy: [],
      })),
    };
  return report;
}

/** The report as one HTML page, as Stryker's html reporter writes it. */
export function reportHtml(report) {
  const elements = readFileSync(
    strykerRequire().resolve(
      'mutation-testing-elements/dist/mutation-test-elements.js',
    ),
    'utf8',
  );
  // "</script>" inside the JSON would end the script element.
  const json = JSON.stringify(report).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script>${elements}</script>
</head>
<body>
  <mutation-test-report-app titlePostfix="Stryker (merged shards)"></mutation-test-report-app>
  <script>
    const app = document.querySelector('mutation-test-report-app');
    app.report = ${json};
    function updateTheme() {
      document.body.style.backgroundColor = app.themeBackgroundColor;
    }
    app.addEventListener('theme-changed', updateTheme);
    updateTheme();
  </script>
</body>
</html>
`;
}
