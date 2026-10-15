// Auto-fix what can be fixed mechanically: formatting and auto-fixable lint rules.
import { bin, run } from './lib.mjs';

for (const [name, cmd, args] of [
  ['prettier', bin('prettier'), ['--write', '.', '--log-level', 'warn']],
  ['eslint --fix', bin('eslint'), ['.', '--fix']],
]) {
  const r = run(cmd, args);
  console.log(
    `${name}: ${r.code === 0 ? 'done' : 'done, remaining issues need manual fixes'}`,
  );
}
