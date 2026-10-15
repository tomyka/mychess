// node --test quality/ (plain Node: the kit's scripts are outside the vitest projects).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  completeShardSet,
  MUTANT_COST,
  mergeReports,
  mutantProfile,
  mutatePattern,
  onlyFiles,
  parseShard,
  scoreReport,
  shardWeights,
  splitShards,
} from './mutation-shards.mjs';

test('parseShard reads i/N and refuses anything else', () => {
  assert.deepEqual(parseShard('3/16'), { index: 3, total: 16 });
  for (const text of ['0/16', '17/16', '3', '3/', 'a/b', '-1/2', undefined])
    assert.equal(parseShard(text), null, String(text));
});

test('splitShards balances weights, deterministically', () => {
  const weights = [
    { file: 'e.ts', weight: 1 },
    { file: 'a.ts', weight: 10 },
    { file: 'b.ts', weight: 6 },
    { file: 'c.ts', weight: 5 },
    { file: 'd.ts', weight: 0 },
  ];
  const shards = splitShards(weights, 2);
  assert.deepEqual(shards, [
    { files: ['a.ts', 'd.ts', 'e.ts'], weight: 11 },
    { files: ['b.ts', 'c.ts'], weight: 11 },
  ]);
  assert.deepEqual(splitShards([...weights].reverse(), 2), shards);
  assert.deepEqual(
    splitShards(weights, 7).map((s) => s.files.length),
    [1, 1, 1, 1, 1, 0, 0],
  );
});

test('splitShards gives equal weights to shards by file name', () => {
  const shards = splitShards(
    [
      { file: 'b.ts', weight: 3 },
      { file: 'a.ts', weight: 3 },
    ],
    2,
  );
  assert.deepEqual(
    shards.map((s) => s.files),
    [['a.ts'], ['b.ts']],
  );
});

const statuses = (file, list) => ({
  files: {
    [file]: {
      mutants: list.map(([status, isStatic]) => ({
        status,
        static: isStatic,
      })),
    },
  },
});

test('mutantProfile counts timed out, else static, else not covered', () => {
  const profile = mutantProfile([
    statuses('b.ts', [
      ['Timeout', true],
      ['Timeout', false],
      ['Killed', true],
      ['Survived', true],
      ['NoCoverage', false],
      ['Killed', false],
    ]),
    statuses('a.ts', [['Killed', false]]),
  ]);
  assert.deepEqual(profile, {
    files: {
      'a.ts': { mutants: 1, timeout: 0, static: 0, noCoverage: 0 },
      'b.ts': { mutants: 6, timeout: 2, static: 2, noCoverage: 1 },
    },
  });
  assert.deepEqual(Object.keys(profile.files), ['a.ts', 'b.ts']);
});

test("mutantProfile keeps a file's previous entry when no report holds it", () => {
  const previous = {
    files: {
      'gone-shard.ts': { mutants: 4, timeout: 4, static: 0, noCoverage: 0 },
      'a.ts': { mutants: 9, timeout: 9, static: 0, noCoverage: 0 },
    },
  };
  const profile = mutantProfile(
    [statuses('a.ts', [['Killed', false]])],
    previous,
  );
  assert.deepEqual(profile.files['a.ts'], {
    mutants: 1,
    timeout: 0,
    static: 0,
    noCoverage: 0,
  });
  assert.deepEqual(
    profile.files['gone-shard.ts'],
    previous.files['gone-shard.ts'],
  );
  assert.deepEqual(mutantProfile([]), { files: {} });
});

test('shardWeights prices each mutant by its class last time, scaled to today', () => {
  const { run, static: stat, timeout, noCoverage } = MUTANT_COST;
  const profile = {
    files: {
      // 1 timed out, 1 static, 1 not covered, 1 run normally.
      'mixed.ts': { mutants: 4, timeout: 1, static: 1, noCoverage: 1 },
      'empty.ts': { mutants: 0, timeout: 0, static: 0, noCoverage: 0 },
    },
  };
  const mixed = timeout + stat + noCoverage + run;
  assert.deepEqual(
    shardWeights(
      [
        { file: 'mixed.ts', mutants: 4 },
        { file: 'empty.ts', mutants: 3 },
      ],
      profile,
    ),
    [
      { file: 'mixed.ts', weight: mixed },
      { file: 'empty.ts', weight: 3 * run },
    ],
  );
  // The file grew from 4 to 6 mutants: the same mix, one and a half times.
  assert.deepEqual(shardWeights([{ file: 'mixed.ts', mutants: 6 }], profile), [
    { file: 'mixed.ts', weight: Math.round((6 * mixed) / 4) },
  ]);
  assert.ok(timeout > 10 * run, 'a timeout costs far more than a mutant run');
});

test('shardWeights without a profile: db schema mutants as static, mostly timing out', () => {
  const none = { files: {} };
  const [schema, nested, other, notDb] = shardWeights(
    [
      { file: 'packages/db/src/points/schema.ts', mutants: 10 },
      { file: 'packages/db/src/schema.ts', mutants: 1 },
      { file: 'packages/db/src/points/save.ts', mutants: 10 },
      { file: 'packages/domain/src/points/schema.ts', mutants: 10 },
    ],
    none,
  );
  const each = Math.round(0.6 * MUTANT_COST.timeout + 0.4 * MUTANT_COST.static);
  assert.equal(schema.weight, 10 * each);
  assert.equal(nested.weight, each);
  assert.equal(other.weight, 10 * MUTANT_COST.run);
  assert.equal(notDb.weight, 10 * MUTANT_COST.run);
});

test("onlyFiles keeps a shard's own files, whatever its incremental file carried", () => {
  // Run 38229211298: each shard's cached incremental file was from the old
  // split, and Stryker reported those files too, so every file was in two
  // shard reports.
  const carried = (own, old) => ({
    schemaVersion: '1.0',
    files: Object.fromEntries(
      [...own, ...old].map((f) => [
        f,
        { language: 'typescript', source: '', mutants: [] },
      ]),
    ),
    testFiles: {
      'x.test.ts': { source: '', tests: [{ id: '0', name: 'one' }] },
    },
  });
  const shard1 = carried(['a.ts'], ['b.ts']);
  const shard2 = carried(['b.ts'], ['a.ts']);
  assert.throws(() => mergeReports([shard1, shard2]), /is in more than one/);
  const own1 = onlyFiles(shard1, ['a.ts']);
  assert.deepEqual(Object.keys(own1.files), ['a.ts']);
  assert.deepEqual(own1.testFiles, shard1.testFiles);
  assert.equal(own1.schemaVersion, '1.0');
  assert.deepEqual(
    Object.keys(mergeReports([own1, onlyFiles(shard2, ['b.ts'])]).files),
    ['a.ts', 'b.ts'],
  );
  assert.deepEqual(onlyFiles(shard1, []).files, {});
  assert.equal(Object.keys(shard1.files).length, 2, 'the input is not changed');
});

test('mutatePattern escapes the glob characters of a Next.js route', () => {
  assert.equal(
    mutatePattern('apps/web/src/app/tournament/[slug]/page.tsx'),
    'apps/web/src/app/tournament/[[]slug[]]/page.tsx',
  );
  assert.equal(
    mutatePattern('a/(group)/{x}*?.ts'),
    'a/[(]group[)]/[{]x[}][*][?].ts',
  );
  assert.equal(
    mutatePattern('packages/domain/src/a.ts'),
    'packages/domain/src/a.ts',
  );
});

test('completeShardSet wants every shard of one split', () => {
  assert.deepEqual(
    completeShardSet(['shard-2-of-2.json', 'other.txt', 'shard-1-of-2.json']),
    { files: ['shard-1-of-2.json', 'shard-2-of-2.json'] },
  );
  assert.deepEqual(
    completeShardSet(['shard-1-of-3.json', 'shard-3-of-3.json']),
    {
      error: 'Missing shard reports: 2/3.',
    },
  );
  assert.deepEqual(
    completeShardSet(['shard-1-of-2.json', 'shard-1-of-3.json']),
    {
      error: 'Shard reports of different splits: of 2, of 3.',
    },
  );
  assert.deepEqual(completeShardSet([]), {
    error: 'No shard reports to merge.',
  });
});

const at = { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } };
const mutant = (id, status, tests = {}) => ({
  id,
  mutatorName: 'BooleanLiteral',
  replacement: 'false',
  location: at,
  status,
  ...tests,
});

function shardReport(file, mutants, tests) {
  return {
    schemaVersion: '1.0',
    thresholds: { high: 80, low: 60, break: 50 },
    projectRoot: '/repo',
    files: { [file]: { language: 'typescript', source: 'true', mutants } },
    testFiles: { 'x.test.ts': { source: '', tests } },
  };
}

test('mergeReports keeps every mutant, with ids and tests made unique', () => {
  const merged = mergeReports([
    shardReport(
      'a.ts',
      [
        mutant('0', 'Killed', { coveredBy: ['0', '1'], killedBy: ['1'] }),
        mutant('1', 'Survived', { coveredBy: ['0'] }),
      ],
      [
        { id: '0', name: 'one' },
        { id: '1', name: 'two' },
      ],
    ),
    shardReport(
      'b.ts',
      [
        mutant('0', 'NoCoverage', { coveredBy: [] }),
        mutant('1', 'Timeout', { coveredBy: ['0'], killedBy: ['0'] }),
      ],
      [{ id: '0', name: 'two' }],
    ),
  ]);
  assert.deepEqual(Object.keys(merged.files), ['a.ts', 'b.ts']);
  const ids = Object.values(merged.files).flatMap((f) =>
    f.mutants.map((m) => m.id),
  );
  assert.deepEqual(ids, ['1-0', '1-1', '2-0', '2-1']);
  assert.deepEqual(merged.testFiles['x.test.ts'].tests, [
    { id: '1-0', name: 'one' },
    { id: '1-1', name: 'two' },
  ]);
  // Shard 2's test "two" is shard 1's test "two".
  assert.deepEqual(merged.files['b.ts'].mutants[1].killedBy, ['1-1']);
  assert.deepEqual(merged.files['a.ts'].mutants[0].coveredBy, ['1-0', '1-1']);
  assert.equal(merged.files['b.ts'].mutants[0].killedBy, undefined);
  assert.equal(merged.thresholds.break, 50);
  // 2 detected (Killed, Timeout) of 4: 1 survived, 1 not covered.
  const { score, detected, counts, survivors } = scoreReport(merged);
  assert.equal(score, 50);
  assert.equal(detected, 2);
  assert.equal(counts.Survived, 1);
  assert.equal(counts.NoCoverage, 1);
  assert.deepEqual(
    survivors.map(({ file, mutant: m }) => `${file} ${m.id}`),
    ['a.ts 1-1', 'b.ts 2-0'],
  );
});

test("mergeReports takes the thresholds from a shard with files, not an empty shard's", () => {
  const merged = mergeReports([
    { schemaVersion: '1.0', files: {} },
    shardReport('a.ts', [mutant('0', 'Killed')], []),
  ]);
  assert.deepEqual(merged.thresholds, { high: 80, low: 60, break: 50 });
  assert.deepEqual(merged.files['a.ts'].mutants[0].id, '2-0');
});

test('mergeReports refuses a file in two shards, and no shards', () => {
  const report = shardReport('a.ts', [mutant('0', 'Killed')], []);
  assert.throws(
    () => mergeReports([report, report]),
    /a\.ts is in more than one/,
  );
  assert.throws(() => mergeReports([]), /No shard reports/);
});

test('scoreReport: no counted mutants scores 100, other statuses do not count', () => {
  const report = shardReport(
    'a.ts',
    [mutant('0', 'CompileError'), mutant('1', 'Ignored')],
    [],
  );
  assert.equal(scoreReport(report).score, 100);
  assert.equal(scoreReport({ files: {} }).score, 100);
});
