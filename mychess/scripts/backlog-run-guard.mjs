// mychess/scripts/backlog-run-guard.mjs
//
// A hard cap on what one agent run may spend, enforced by the harness rather
// than by the agent's own judgement (GitHub issue #193, epic #188).
//
// Wired as a SubagentStart hook, this runs BEFORE each subagent is created and
// can refuse. That distinction is the whole point: caps written into CLAUDE.md
// are protocol discipline an agent checks against itself, and an agent that has
// lost the thread is exactly the one that will not check. A hook cannot be
// reasoned past.
//
// It caps the two things that actually drive cost in a backlog run:
//
//   subagents  — epic #184 averaged ~3 per task (one implementer plus one or
//                two reviewers). A run spawning far more has usually lost its
//                way rather than found more work.
//   wall clock — a runaway loop burns tokens indefinitely otherwise.
//
// It ALSO stops a run when the context window is nearly full, wired as a
// PreCompact hook on the "auto" matcher. Auto-compaction is what lets a session
// keep going indefinitely: it summarises the conversation and carries on, so a
// run that should have stopped instead sheds its history and continues with
// less of it. Refusing that compaction converts "compact and continue" into
// "stop", which is the enforceable form of "stop when the session is nearly
// full".
//
// A caveat worth stating plainly: a hook receives no live context percentage,
// so an exact 90% threshold is NOT observable here. Auto-compaction fires when
// the window is nearly exhausted, which is close to that and — unlike a number
// an agent reads and decides about — cannot be talked past. Tune when it fires
// with the `autoCompactWindow` setting.
//
// NOT a dollar cap. Claude Code has no per-session spend setting, and this
// script cannot invent one — it counts spawns and minutes, which correlate with
// spend but are not it. For a real dollar ceiling, launch with
// `claude --max-budget-usd <n>`; that is enforced against actual billed cost.
//
// Override the defaults per run:
//   BACKLOG_MAX_SUBAGENTS=12  BACKLOG_MAX_MINUTES=90
//   BACKLOG_ALLOW_AUTOCOMPACT=1   (let a full session compact and continue)
//
// State lives in one file per session under the OS temp directory, so
// concurrent sessions never share a budget and nothing needs cleaning up.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const MAX_SUBAGENTS = Number(process.env.BACKLOG_MAX_SUBAGENTS ?? 20);
const MAX_MINUTES = Number(process.env.BACKLOG_MAX_MINUTES ?? 120);

/** Everything this hook writes goes here, keyed by session. */
const STATE_DIR = join(tmpdir(), 'mychess-backlog-guard');

function readStdin() {
	try {
		return readFileSync(0, 'utf8');
	} catch {
		return '';
	}
}

/**
 * Allowing on any internal error is deliberate. A guard that fails closed on
 * its own bug would block every subagent in every session — including ordinary
 * supervised work that never asked for a cap. The cap is a safety net, not a
 * gate on normal use, so its failure mode should be invisible rather than
 * total.
 */
function allow() {
	process.exit(0);
}

function block(reason) {
	process.stdout.write(
		JSON.stringify({
			continue: false,
			stopReason: reason,
			systemMessage: `Backlog run guard: ${reason}`
		})
	);
	process.exit(0);
}

let payload;
try {
	payload = JSON.parse(readStdin() || '{}');
} catch {
	allow();
}

/**
 * PreCompact path: the context window is nearly full and Claude Code is about
 * to summarise the conversation so the session can continue. Refuse, so the
 * session stops here instead.
 *
 * Only automatic compaction is refused. A person typing /compact has decided
 * they want to keep going, and this should not override them — the matcher in
 * settings already scopes to "auto", and this re-checks so a mis-wired matcher
 * cannot block a manual compact.
 */
if (payload.hook_event_name === 'PreCompact' || payload.trigger !== undefined) {
	const isAutomatic = payload.trigger === 'auto' || payload.matcher === 'auto';
	if (!isAutomatic || process.env.BACKLOG_ALLOW_AUTOCOMPACT === '1') allow();
	block(
		`the context window is nearly full, so this session is stopping rather than compacting and continuing. ` +
			`Auto-compaction would drop conversation history and carry on, which is how a run that should have ` +
			`stopped keeps going with less of the context it started from. ` +
			`Follow the blocked-run convention in mychess/CLAUDE.md: comment on the issue with what you did and ` +
			`what remains, apply the 'blocked' label, and push partial work to a named branch so nothing is lost. ` +
			`Set BACKLOG_ALLOW_AUTOCOMPACT=1 to permit compaction instead.`
	);
}

// Without a session id the counter has no key, so there is nothing to enforce
// against. Allow rather than guess at a shared bucket.
const sessionId = String(payload.session_id ?? '').replace(/[^A-Za-z0-9_-]/g, '');
if (!sessionId) allow();

let state = { firstSeen: Date.now(), subagents: 0 };
const stateFile = join(STATE_DIR, `${sessionId}.json`);

try {
	if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
	// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is STATE_DIR plus a session id stripped to [A-Za-z0-9_-], so it cannot traverse
	if (existsSync(stateFile)) {
		// eslint-disable-next-line security/detect-non-literal-fs-filename -- same sanitised path as above
		state = { ...state, ...JSON.parse(readFileSync(stateFile, 'utf8')) };
	}
} catch {
	allow();
}

const elapsedMinutes = (Date.now() - state.firstSeen) / 60_000;

// Checked BEFORE incrementing, so the reported count is the number already
// spawned rather than the one being requested.
if (elapsedMinutes > MAX_MINUTES) {
	block(
		`wall-clock cap reached — ${elapsedMinutes.toFixed(0)} minutes elapsed, limit ${MAX_MINUTES}. ` +
			`Stop, and follow the blocked-run convention in mychess/CLAUDE.md: comment on the issue saying ` +
			`what you were doing and what remains, apply the 'blocked' label, and push partial work to a named branch. ` +
			`Raise the limit with BACKLOG_MAX_MINUTES if this run is legitimately long.`
	);
}

if (state.subagents >= MAX_SUBAGENTS) {
	block(
		`subagent cap reached — ${state.subagents} already spawned, limit ${MAX_SUBAGENTS}. ` +
			`A run needing more than this has usually lost the thread rather than found more work. ` +
			`Stop and follow the blocked-run convention in mychess/CLAUDE.md. ` +
			`Raise the limit with BACKLOG_MAX_SUBAGENTS if this run genuinely needs more.`
	);
}

state.subagents += 1;

try {
	// eslint-disable-next-line security/detect-non-literal-fs-filename -- same sanitised path as above
	writeFileSync(stateFile, JSON.stringify(state));
} catch {
	// Losing the counter is better than blocking real work; see allow().
}

allow();
