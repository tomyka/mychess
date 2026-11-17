# CI's E2E parts

CI's `e2e` job runs the suite as parallel jobs, one per part (#366), each
against its own stack made from the same image. `part-<n>.txt` is a
Playwright test list (`--test-list`): one `[project] > file` per line, paths
relative to `apps/web/e2e`. The last job, `rest`, runs every test that no
part lists (`--test-list-invert` over all of them), so a new or renamed spec
always runs; a stale line here only unbalances the parts.

The parts are balanced by run time, not test count (Playwright's `--shard`
splits by count, and the training specs hold few but slow tests). Measured
in CI (run 44120059975), seconds per project:

| part | lists | seconds |
| --- | --- | --- |
| 1 | desktop-chromium: training-learn | 185 |
| 2 | pixel-7: training-learn | 185 |
| 3 | desktop-chromium: training-review, training-arrows, repertoires | 154 |
| 4 | pixel-7: training-review, training-arrows, repertoires | 153 |
| rest | everything else, both projects | 156 |

When one job grows well past the others (its "Playwright" step time in the
run), move a file between parts.
