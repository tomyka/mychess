import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

/*
 * findBy* and waitFor give up after 1 s by default. The full gate runs every
 * suite at once on one machine, and transitions then settle later than that,
 * so tests that wait correctly still timed out. 3 s stays under vitest's 5 s
 * test timeout.
 */
configure({ asyncUtilTimeout: 3000 });

afterEach(cleanup);
