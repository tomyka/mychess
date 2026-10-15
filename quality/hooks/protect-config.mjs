// PreToolUse hook: stop the agent from weakening the quality gates.
// Blocks Edit/Write/MultiEdit on gate config files, and Bash commands that modify them
// or skip git hooks. You (a human) can still edit these files normally.
import { relative, resolve, sep } from 'node:path';
import { ROOT, matchesAny } from '../lib.mjs';
import { readInput } from './read-input.mjs';

const PROTECTED = [
  'eslint.config.mjs',
  'tsconfig.strict.json',
  'vitest.config.ts',
  // Each package's gate configs (#25): the vitest project the root config
  // extends, the strict project and the tsconfig it extends, and the base
  // every package tsconfig extends.
  '{apps,packages}/*/tsconfig.json',
  '{apps,packages}/*/tsconfig.strict.json',
  '{apps,packages}/*/vitest*.config.ts',
  'tsconfig.base.json',
  'stryker.config.mjs',
  'knip.json',
  '.dependency-cruiser.cjs',
  '.prettierrc.json',
  '.prettierignore',
  'quality/**',
  '.claude/settings.json',
  '.github/workflows/quality.yml',
];
const PROTECTED_NAMES = [
  'eslint.config',
  'tsconfig.strict',
  'tsconfig.json',
  'tsconfig.base',
  'vitest.config',
  'vitest.component.config',
  'vitest.feature.config',
  'vitest.smoke.config',
  'stryker.config',
  'knip.json',
  '.dependency-cruiser',
  '.prettierrc',
  '.prettierignore',
  'quality/',
  '.claude/settings',
  'workflows/quality',
  'crap-baseline',
];
const WRITE_COMMAND =
  /^\s*(sudo\s+)?(sed\s.*-i|perl\s.*-i|tee|mv|cp|rm|truncate|chmod|ln|git\s+(checkout|restore|rm|mv))\b/;
const REDIRECT_TARGET = /(?:^|[^0-9&])>{1,2}\s*([^\s&|;]+)/g;
const SCRIPTED_WRITE =
  /(writeFile|appendFile|open\(.*['"][wa]['"]|--write-baseline)/;

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `${reason} Quality gate configuration is owned by the human. Fix the code instead; if you believe a rule is wrong, stop and explain why to the user.`,
      },
    }),
  );
  process.exit(0);
}

const input = await readInput();
const tool = input.tool_name ?? '';
const ti = input.tool_input ?? {};

if (tool === 'Bash') {
  const cmd = String(ti.command ?? '');
  if (/--no-verify\b/.test(cmd))
    deny('Skipping git hooks (--no-verify) is not allowed.');
  const mentions = (text) => PROTECTED_NAMES.some((n) => text.includes(n));
  for (const segment of cmd.split(/&&|\|\||;|\||\n/)) {
    if (!mentions(segment)) continue;
    const redirects = [...segment.matchAll(REDIRECT_TARGET)].map((m) => m[1]);
    if (
      WRITE_COMMAND.test(segment) ||
      SCRIPTED_WRITE.test(segment) ||
      redirects.some(mentions)
    ) {
      deny('This command appears to modify a protected quality-gate file.');
    }
  }
  process.exit(0);
}

const target = ti.file_path ?? ti.notebook_path;
if (target) {
  const rel = relative(ROOT, resolve(input.cwd ?? ROOT, target))
    .split(sep)
    .join('/');
  if (!rel.startsWith('..') && matchesAny(rel, PROTECTED))
    deny(`"${rel}" is a protected quality-gate file.`);
}
process.exit(0);
