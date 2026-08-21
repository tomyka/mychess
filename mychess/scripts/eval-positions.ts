// mychess/scripts/eval-positions.ts
//
// Precomputes engine evaluations for `positions` rows that don't have a current
// one (issue #126). Run it after importing a repertoire:
//
//   npm run positions:eval           # evaluate everything pending
//   npm run positions:eval -- 200    # cap this run at 200 positions
//
// Idempotent and resumable: it only ever picks up rows whose `eval_engine` isn't
// the current ENGINE_ID, so re-running it costs one query and stops.
import { createClient } from '@supabase/supabase-js';
import { StockfishProcess } from '../src/lib/engine/stockfishProcess';
import { ENGINE_ID } from '../src/lib/engine/version';

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
	console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
	process.exit(1);
}

const limit = Number(process.argv[2] ?? '0') || Infinity;
// Small enough that a crashed run loses almost nothing, big enough that the
// round trips don't dominate a 400ms-per-position job.
const BATCH = 50;

const supabase = createClient(url, key, { auth: { persistSession: false } });


/**
 * Retries a Supabase call through transient network failures. A run long enough
 * to matter WILL hit one — the first full run died on
 * `TypeError: fetch failed / EADDRNOTAVAIL` (local port exhaustion) after ~1350
 * positions, and losing that much engine time to one dropped socket is not
 * acceptable for a job meant to be run once and forgotten.
 *
 * Note the shape: supabase-js does NOT throw a transport failure, it hands it
 * back in `{ error }` (that EADDRNOTAVAIL arrived as an error object, not an
 * exception), so both paths have to be checked. A real Postgres error — a
 * missing column, a constraint violation — is returned to the caller untouched
 * on the first attempt rather than retried four more times.
 */
const TRANSIENT = /fetch failed|EADDRNOTAVAIL|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network|timeout/i;
const MAX_ATTEMPTS = 5;

type PgResult<T> = { data: T; error: { message?: string; details?: string } | null };

async function withRetry<T>(what: string, call: () => PromiseLike<PgResult<T>>): Promise<PgResult<T>> {
	for (let attempt = 1; ; attempt++) {
		const backoffMs = 500 * 2 ** (attempt - 1);
		const wait = () => new Promise((resolve) => setTimeout(resolve, backoffMs));
		try {
			const result = await call();
			const text = `${result.error?.message ?? ''} ${result.error?.details ?? ''}`;
			if (result.error && TRANSIENT.test(text) && attempt < MAX_ATTEMPTS) {
				console.warn(`${what}: transient failure (${attempt}/${MAX_ATTEMPTS}), retrying in ${backoffMs}ms: ${text.trim()}`);
				await wait();
				continue;
			}
			return result;
		} catch (err) {
			if (attempt >= MAX_ATTEMPTS) throw err;
			console.warn(`${what}: threw (${attempt}/${MAX_ATTEMPTS}), retrying in ${backoffMs}ms: ${String(err)}`);
			await wait();
		}
	}
}

async function main() {
	const engine = new StockfishProcess();
	await engine.start();
	console.log(`engine ready — evaluating with ${ENGINE_ID}`);

	let evaluated = 0;
	let unscored = 0;
	try {
		while (evaluated < limit) {
			const { data: pending, error } = await withRetry('fetch pending', () =>
				supabase
					.from('positions')
					.select('id, fen')
					.or(`eval_engine.is.null,eval_engine.neq.${ENGINE_ID}`)
					.limit(Math.min(BATCH, limit - evaluated))
			);
			if (error) throw error;
			if (!pending || pending.length === 0) break;
			const before = evaluated;
			const results: Record<string, unknown>[] = [];

			for (const row of pending) {
				const score = await engine.evaluate(row.fen);
				// A position with no legal moves has no score, and must still be
				// stamped — otherwise the next run picks it up again forever.
				if (!score) unscored++;
				results.push({
					id: row.id,
					fen: row.fen,
					eval_cp: score?.cp ?? null,
					eval_mate: score?.mate ?? null,
					eval_engine: ENGINE_ID,
					eval_at: new Date().toISOString()
				});
				evaluated++;
			}

			// ONE write per batch, not one per position. Per-row updates meant ~2
			// HTTP requests per position, and a long run exhausted local ports:
			// `TypeError: fetch failed / EADDRNOTAVAIL` after ~1350 positions,
			// observed. `id` is the primary key, but onConflict is passed
			// explicitly per the repo's own convention.
			const { error: writeError } = await withRetry('write batch', () =>
				supabase.from('positions').upsert(results, { onConflict: 'id' })
			);
			if (writeError) throw writeError;
			console.log(`evaluated ${evaluated} (${unscored} with no legal moves)`);
			// A batch where nothing at all moved means the remaining rows are being
			// handled by another run; stop rather than spinning on the same page.
			if (evaluated === before) break;
		}
	} finally {
		engine.stop();
	}

	console.log(`done: ${evaluated} positions evaluated, ${unscored} had no legal move`);
}

main().catch((err) => {
	console.error('position eval failed:', err);
	process.exit(1);
});
