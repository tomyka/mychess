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

async function main() {
	const engine = new StockfishProcess();
	await engine.start();
	console.log(`engine ready — evaluating with ${ENGINE_ID}`);

	let evaluated = 0;
	let unscored = 0;
	try {
		while (evaluated < limit) {
			const { data: pending, error } = await supabase
				.from('positions')
				.select('id, fen')
				.or(`eval_engine.is.null,eval_engine.neq.${ENGINE_ID}`)
				.limit(Math.min(BATCH, limit - evaluated));
			if (error) throw error;
			if (!pending || pending.length === 0) break;

			for (const row of pending) {
				const score = await engine.evaluate(row.fen);
				// A position with no legal moves has no score, and must still be
				// stamped — otherwise the next run picks it up again forever.
				if (!score) unscored++;
				const { error: writeError } = await supabase
					.from('positions')
					.update({
						eval_cp: score?.cp ?? null,
						eval_mate: score?.mate ?? null,
						eval_engine: ENGINE_ID,
						eval_at: new Date().toISOString()
					})
					.eq('id', row.id);
				if (writeError) throw writeError;
				evaluated++;
			}
			console.log(`evaluated ${evaluated} (${unscored} with no legal moves)`);
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
