// Stop hook: when the agent says it is done, run the quality gate on the working tree:
// "check" (the fast gate), or "all" (check + mutation) when quality.config.json's
// stopHook.mutation is "changed". mychess sets it to "off": mutation runs in CI.
// If anything fails, exit code 2 blocks the stop and hands the report to the agent.
// - Skips when nothing changed since the last passing run (hash of git diff + untracked files).
// - After N consecutive failed attempts it lets the agent stop and warns you, so it cannot loop forever.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, isGitRepo, loadConfig, run } from '../lib.mjs';
import { readInput } from './read-input.mjs';

const config = loadConfig();
const cacheDir = join(ROOT, 'node_modules', '.cache', 'ts-quality');
const statePath = join(cacheDir, 'stop-state.json');
mkdirSync(cacheDir, { recursive: true });
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, 'utf8'))
  : { passedHash: null, blocks: 0 };
const save = () => writeFileSync(statePath, JSON.stringify(state));

await readInput();

function workingTreeHash() {
  if (!isGitRepo()) return null;
  const h = createHash('sha256');
  h.update(run('git', ['diff', 'HEAD', '--binary']).out);
  h.update(run('git', ['rev-parse', 'HEAD']).out);
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard'])
    .out.split('\n')
    .filter(Boolean);
  for (const f of untracked.sort()) {
    h.update(f);
    try {
      h.update(readFileSync(join(ROOT, f)));
    } catch {
      /* deleted meanwhile */
    }
  }
  return h.digest('hex');
}

const hash = workingTreeHash();
if (hash && hash === state.passedHash) process.exit(0);

const mode = config.stopHook.mutation === 'changed' ? 'all' : 'check';
const r = run(process.execPath, [join('quality', 'gate.mjs'), mode]);

if (r.code === 0) {
  state.passedHash = hash;
  state.blocks = 0;
  save();
  process.exit(0);
}

state.blocks += 1;
if (state.blocks > config.stopHook.maxConsecutiveBlocks) {
  state.blocks = 0;
  save();
  process.stdout.write(
    JSON.stringify({
      systemMessage: `Quality gate still failing after ${config.stopHook.maxConsecutiveBlocks} attempts. Run "node quality/gate.mjs check" to see what is left.`,
    }),
  );
  process.exit(0);
}
save();
process.stderr.write(
  `Quality gate failed (attempt ${state.blocks}/${config.stopHook.maxConsecutiveBlocks}). You are not done yet. ` +
    `Fix every item below, then finish again. Do not edit gate configuration or add suppressions.\n\n${r.out}`,
);
process.exit(2);
