// mychess/scripts/pick-backlog-issue.mjs
//
// Picks the one backlog issue an on-demand agent run should work next, and
// claims it so a second run cannot take the same one (GitHub issue #193,
// epic #188).
//
// The selection rules are here rather than in a prompt because they are
// mechanical, easy to get subtly wrong, and must give the same answer every
// time. What an agent then DOES with the issue is a judgement call and lives in
// the run protocol (see `mychess/CLAUDE.md`).
//
// Usage:
//   node scripts/pick-backlog-issue.mjs           list candidates, change nothing
//   node scripts/pick-backlog-issue.mjs --claim    claim the oldest and print it
//   node scripts/pick-backlog-issue.mjs --release <n>   hand an issue back
//
// Requires an authenticated `gh`.

import { spawnSync } from 'node:child_process';

const REPO = 'tomyka/mychess';

/** Marks a claim comment machine-readably, so a later run can recognise it. */
const CLAIM_MARKER = '<!-- backlog-run-claim -->';
const RELEASE_MARKER = '<!-- backlog-run-release -->';

/**
 * How long a claim holds. A run that dies without releasing would otherwise
 * park an issue forever; after this it is fair game again. Long enough that a
 * genuinely working run is never stolen from, short enough that a crash does
 * not need manual cleanup.
 */
const CLAIM_HOURS = 6;

function gh(args) {
	const result = spawnSync('gh', args, { encoding: 'utf8', shell: true });
	if (result.status !== 0) {
		throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${result.stderr?.trim()}`);
	}
	return result.stdout;
}

function ghJson(args) {
	return JSON.parse(gh(args) || 'null');
}

/**
 * Issue numbers mentioned by any OPEN pull request. An issue whose work is
 * already up for review is not available: a second run would duplicate it, and
 * two PRs touching one issue is exactly the mess this avoids.
 */
function issuesWithOpenPrs() {
	const prs = ghJson(['pr', 'list', '--repo', REPO, '--state', 'open', '--limit', '100', '--json', 'number,body,title']);
	const mentioned = new Set();
	for (const pr of prs ?? []) {
		for (const match of `${pr.title} ${pr.body ?? ''}`.matchAll(/#(\d+)/g)) {
			mentioned.add(Number(match[1]));
		}
	}
	return mentioned;
}

/**
 * Whether this issue is currently claimed. Only the LATEST marker counts, so a
 * released issue becomes available again immediately rather than waiting out
 * the timeout.
 */
function claimState(issueNumber) {
	const comments = ghJson([
		'issue', 'view', String(issueNumber), '--repo', REPO, '--json', 'comments'
	])?.comments ?? [];

	let latest = null;
	for (const comment of comments) {
		const isClaim = comment.body?.includes(CLAIM_MARKER);
		const isRelease = comment.body?.includes(RELEASE_MARKER);
		if (!isClaim && !isRelease) continue;
		latest = { kind: isRelease ? 'release' : 'claim', at: new Date(comment.createdAt) };
	}

	if (!latest || latest.kind === 'release') return { claimed: false };
	const ageHours = (Date.now() - latest.at.getTime()) / 3_600_000;
	return ageHours < CLAIM_HOURS
		? { claimed: true, ageHours }
		: { claimed: false, staleClaimAgeHours: ageHours };
}

function candidates() {
	// `auto-ok` is applied only by a human (see the criteria in CLAUDE.md);
	// `blocked` means a previous run stopped and needs one.
	const issues = ghJson([
		'issue', 'list', '--repo', REPO, '--state', 'open',
		'--label', 'auto-ok', '--limit', '100',
		'--json', 'number,title,labels,createdAt'
	]) ?? [];

	const withPrs = issuesWithOpenPrs();

	return issues
		.filter((issue) => !issue.labels.some((label) => label.name === 'blocked'))
		.filter((issue) => !withPrs.has(issue.number))
		.map((issue) => ({ ...issue, claim: claimState(issue.number) }))
		.filter((issue) => !issue.claim.claimed)
		// Oldest first: the backlog drains in the order it accumulated rather
		// than by whatever happens to sort first.
		.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

const argv = process.argv.slice(2);

if (argv[0] === '--release') {
	const number = argv[1];
	if (!number) {
		console.error('Usage: --release <issue-number>');
		process.exit(1);
	}
	gh([
		'issue', 'comment', number, '--repo', REPO, '--body',
		`"${RELEASE_MARKER}\nReleased by an on-demand backlog run without completing it. Available again."`
	]);
	console.log(`released #${number}`);
	process.exit(0);
}

const available = candidates();

if (available.length === 0) {
	console.log('No available auto-ok issues.');
	console.log('(An issue is unavailable if it is blocked, already has an open PR, or is claimed.)');
	process.exit(0);
}

if (!argv.includes('--claim')) {
	console.log(`${available.length} available auto-ok issue(s), oldest first:\n`);
	for (const issue of available) {
		const stale = issue.claim.staleClaimAgeHours
			? ` (stale claim ${issue.claim.staleClaimAgeHours.toFixed(1)}h old, reclaimable)`
			: '';
		console.log(`  #${issue.number}  ${issue.title}${stale}`);
	}
	console.log('\nRe-run with --claim to take the first one.');
	process.exit(0);
}

const picked = available[0];
gh([
	'issue', 'comment', String(picked.number), '--repo', REPO, '--body',
	`"${CLAIM_MARKER}\nPicked up by an on-demand backlog run. Claim expires in ${CLAIM_HOURS}h if the run does not finish.\n\nPer the conventions in \\\`mychess/CLAUDE.md\\\`: this run will open a PR and will not merge it, and will stop and apply the \\\`blocked\\\` label rather than guess if it hits a decision it should not make."`
]);

console.log(`CLAIMED #${picked.number}: ${picked.title}`);
