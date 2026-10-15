// PostToolUse hook: after the agent edits a file, format it, auto-fix lint, and report
// what is left. Exit code 2 sends the report back to the agent so it fixes it right away.
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { ROOT, bin, loadConfig, run, trimOutput } from '../lib.mjs';
import { readInput } from './read-input.mjs';

const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const input = await readInput();
const target = input.tool_input?.file_path;
if (!target) process.exit(0);

const abs = resolve(input.cwd ?? ROOT, target);
const rel = relative(ROOT, abs).split(sep).join('/');
if (rel.startsWith('..') || !existsSync(abs)) process.exit(0);
if (
  /^(node_modules|dist|build|coverage|reports|\.stryker-tmp|quality|archive)\//.test(
    rel,
  )
)
  process.exit(0);

const problems = [];

// Formatting is mechanical: just do it.
run(bin('prettier'), [
  '--write',
  '--ignore-unknown',
  '--log-level',
  'silent',
  rel,
]);

if (CODE.test(rel)) {
  const config = loadConfig();
  const text = readFileSync(abs, 'utf8');
  const markers = config.forbiddenMarkers.filter((m) => text.includes(m));
  if (markers.length)
    problems.push(
      `Forbidden suppression markers in ${rel}: ${markers.join(', ')}. Remove them and fix the real issue.`,
    );

  const lint = run(bin('eslint'), [
    '--fix',
    '--max-warnings',
    '0',
    '--no-warn-ignored',
    rel,
  ]);
  if (lint.code !== 0)
    problems.push(`ESLint problems in ${rel}:\n${trimOutput(lint.out, 40)}`);
}

if (problems.length) {
  process.stderr.write(`${problems.join('\n\n')}\n`);
  process.exit(2);
}
process.exit(0);
