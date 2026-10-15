import { runFideImport } from '../src/lib/fide/import-job';

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

runFideImport(url, key)
  .then((r) => {
    console.log('FIDE import complete:', JSON.stringify(r, null, 2));
    process.exit(r.errors.length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error('FIDE import failed:', e);
    process.exit(1);
  });
