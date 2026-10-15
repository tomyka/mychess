// mychess/scripts/setup-worktree.mjs
//
// Takes a brand-new worktree or checkout to a green test run in one command
// (GitHub issue #192):
//
//   npm run setup
//
// Two things on this project's dev machines make a bare `npm install`
// insufficient, and both fail in ways that look like a broken repository
// rather than a broken environment. That misdiagnosis is the whole reason this
// script exists — an unattended run (epic #188) hitting either one would
// reasonably conclude the code is at fault.
//
//   1. `.npmrc` sets `engine-strict=true`, and some devDependencies require a
//      Node newer than the machine's active one, so `npm install` dies with
//      EBADENGINE before installing anything.
//
//   2. npm's optional-dependency bug (npm/cli#4828) silently omits rolldown's
//      platform-specific native binding. vitest and vite then die at startup
//      with "Cannot find native binding" / "Cannot find module
//      '@rolldown/binding-wasm32-wasi'". Deleting node_modules and reinstalling
//      does NOT fix it — it recurs deterministically.
//
// Deliberately plain `.mjs` run by bare `node`, NOT a `.ts` run through `tsx`
// like every other script in this directory: `tsx` lives in node_modules, which
// is precisely what does not exist yet when this runs.
//
// Usage:
//   node scripts/setup-worktree.mjs            install, repair, verify, test
//   node scripts/setup-worktree.mjs --no-test  stop after verifying the binding

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const runTests = !process.argv.includes('--no-test');

/**
 * `shell` is opt-in per command, not a blanket default. npm is a shell script
 * on Windows and cannot be spawned without one — but routing `node -e '<code>'`
 * through a shell lets it mangle the source (cmd.exe eats `=>` and quotes),
 * which surfaces as a SyntaxError that reads exactly like a broken toolchain.
 * That cost a false "environment problem" verdict the first time this ran.
 */
function run(command, args, { shell = false } = {}) {
	return spawnSync(command, args, { cwd: appRoot, stdio: 'inherit', shell });
}

function runNpm(args) {
	return run('npm', args, { shell: true });
}

function step(message) {
	console.log(`\n→ ${message}`);
}

/**
 * Fails with the environment-versus-code distinction spelled out, because
 * getting that wrong is the failure this script exists to prevent: every
 * message below describes a machine that is not set up, NOT a repository that
 * is broken.
 */
function failEnvironment(what, remedy) {
	console.error(`\n✗ Setup failed: ${what}`);
	console.error('\n  This is an ENVIRONMENT problem, not a problem with the code.');
	console.error('  The repository is fine; this machine is not ready to build it.');
	if (remedy) console.error(`\n  ${remedy}`);
	process.exit(1);
}

/**
 * The rolldown native binding this platform needs, resolved from
 * `package-lock.json` rather than hardcoded — the lockfile records every
 * binding with its own `os`/`cpu` constraints, so the right one for the current
 * machine is a lookup, and its version can never drift out of step with the
 * lockfile the install just honoured.
 */
function resolvePlatformBinding() {
	const lockPath = join(appRoot, 'package-lock.json');
	if (!existsSync(lockPath)) {
		failEnvironment('package-lock.json is missing, so the rolldown binding version cannot be resolved.');
	}

	const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
	const candidates = Object.entries(lock.packages ?? {})
		.filter(([path]) => path.startsWith('node_modules/@rolldown/binding-'))
		.map(([path, meta]) => ({ name: path.replace('node_modules/', ''), meta }))
		.filter(
			({ meta }) =>
				(meta.os ?? []).includes(process.platform) && (meta.cpu ?? []).includes(process.arch)
		);

	if (candidates.length === 0) return null;

	// Several Linux builds can share one os/cpu pair (gnu vs musl). Prefer the
	// glibc build, which is what a normal distro wants; a musl host that picks
	// wrong still gets a clear binding error rather than a silent miss.
	const preferred = candidates.find(({ name }) => !name.includes('musl')) ?? candidates[0];
	return { name: preferred.name, version: preferred.meta.version };
}

// ─── 1. Install, overriding the engine-strict floor ──────────────────────────

step('Installing dependencies (engine-strict disabled for this install only)');
const install = runNpm(['install', '--engine-strict=false']);
if (install.status !== 0) {
	failEnvironment(
		'`npm install --engine-strict=false` did not complete.',
		'Check the npm output above. Note the override is scoped to this command and does not touch .npmrc or package-lock.json.'
	);
}

// ─── 2. Repair the rolldown binding npm may have dropped ─────────────────────

const binding = resolvePlatformBinding();
if (!binding) {
	console.log(
		`\n⚠ No rolldown binding is listed for ${process.platform}/${process.arch}; skipping the binding repair.`
	);
	// eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is built from a package-lock.json key matched against the fixed `@rolldown/binding-` prefix, i.e. committed repo content, never user or network input
} else if (existsSync(join(appRoot, 'node_modules', ...binding.name.split('/')))) {
	step(`${binding.name}@${binding.version} is already present — nothing to repair`);
} else {
	step(`Restoring ${binding.name}@${binding.version} (npm/cli#4828 dropped it)`);
	const repair = runNpm([
		'install',
		'--no-save',
		'--engine-strict=false',
		`${binding.name}@${binding.version}`
	]);
	if (repair.status !== 0) {
		failEnvironment(
			`could not install ${binding.name}@${binding.version}.`,
			'Without it, vitest and vite cannot start. Reinstalling node_modules will NOT fix this — the npm bug recurs deterministically.'
		);
	}
}

// ─── 3. Prove the toolchain actually loads ───────────────────────────────────

step('Verifying the build toolchain can load its native binding');
const bindingCheck = run('node', ['-e', "import('rolldown').then(() => {}, (e) => { console.error(String(e)); process.exit(1); })"]);
if (bindingCheck.status !== 0) {
	failEnvironment(
		'rolldown still cannot load its native binding.',
		'vitest and vite will not start. Re-run this script; if it persists, compare node_modules/@rolldown/ against a known-good checkout.'
	);
}

if (!runTests) {
	console.log('\n✓ Setup complete. Binding verified; tests skipped (--no-test).');
	process.exit(0);
}

// ─── 4. The real gate ────────────────────────────────────────────────────────

step('Running the test suite');
const tests = runNpm(['test']);
if (tests.status !== 0) {
	// Deliberately NOT the environment message. The binding loaded, so the
	// toolchain is working — failures past this point are the code's, and
	// saying otherwise would send someone hunting the wrong problem.
	console.error('\n✗ Setup succeeded, but the test suite failed.');
	console.error('\n  The environment is fine: dependencies installed and the native binding loaded.');
	console.error('  These are real test failures. Read them as such.');
	process.exit(1);
}

console.log('\n✓ Setup complete. Dependencies installed, binding verified, tests passing.');
