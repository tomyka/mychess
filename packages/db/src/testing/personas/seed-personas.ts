// The seed:personas script (packages/db/package.json), bundled by build.mjs
// into local/dist: apart from dist/, so the app image never carries it.
import { runSeedPersonas } from './command';

await runSeedPersonas();
