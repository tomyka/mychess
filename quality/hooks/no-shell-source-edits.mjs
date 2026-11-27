// PreToolUse hook: source is edited with Edit and Write, never by a shell
// splice (docs/agent-team.md, "Edit source with Edit and Write"; S7, and five
// breaches in #381 part 4). Blocks Bash commands that rewrite a source file
// under apps/ or packages/ in place: sed -i / perl -i, a node or python
// one-liner that writes files, and a redirect or heredoc into one. Moving a
// file (mv, git mv) stays allowed.
import { readInput } from './read-input.mjs';

const SOURCE =
  /(?:^|[\s'"=])(?:\.\/)?(?:apps|packages)\/[^\s'"]+\.(?:ts|tsx|mts|mjs|cjs|js|css|json|md)\b/;
const IN_PLACE = /\b(?:sed|perl)\s[^|;&]*-i/;
const SCRIPTED =
  /\b(?:node|python3?)\s+(?:-e|--eval|-c)\b[\s\S]*(?:writeFileSync|writeFile|appendFile|\.write\()/;
const REDIRECT =
  /(?:^|[^0-9&<])>{1,2}\s*["']?((?:\.\/)?(?:apps|packages)\/[^\s"'&|;]+)/;

function deny() {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Edit source files with the Edit and Write tools, not a shell splice (docs/agent-team.md). Moving a file with mv or git mv is fine.',
      },
    }),
  );
  process.exit(0);
}

const input = await readInput();
if ((input.tool_name ?? '') !== 'Bash') process.exit(0);
const cmd = String(input.tool_input?.command ?? '');
for (const segment of cmd.split(/&&|\|\||;|\n(?![^<]*EOF)/)) {
  if (IN_PLACE.test(segment) && SOURCE.test(segment)) deny();
  if (REDIRECT.test(segment)) deny();
}
if (SCRIPTED.test(cmd) && /(?:apps|packages)\//.test(cmd)) deny();
process.exit(0);
