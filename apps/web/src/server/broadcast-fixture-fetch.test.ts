import {
  BROADCAST_LIST_URL,
  broadcastDumpUrl,
  type Fetch,
} from '@mychess/integrations';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { broadcastFetch } from './broadcast-fixture-fetch';

let dir = '';
const LIST = `${broadcastDumpUrl('2026-10')}\n`;
const DUMP = new Uint8Array([40, 181, 47, 253, 1, 2, 3]);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fide-fixtures-'));
  writeFileSync(join(dir, 'list.txt'), LIST);
  writeFileSync(join(dir, 'lichess_db_broadcast_2026-10.pgn.zst'), DUMP);
  writeFileSync(join(dir, 'secret.txt'), 'not served');
  for (const [name, body] of Object.entries(API_FILES)) {
    writeFileSync(join(dir, name), body);
  }
});

const API = 'https://lichess.org/api/broadcast';

/** The broadcast API's fixture files (#349), each body naming its file. */
const API_FILES: Readonly<Record<string, string>> = {
  'by-paulauskas-2.json': '{"by":"paulauskas"}',
  'round-SynRnd01.json': '{"round":"SynRnd01"}',
  'tour-SynTour1.json': '{"tour":"SynTour1"}',
  'tour-SynTour1.pgn': '[Event "SynTour1"]',
};

const BEARER: RequestInit = {
  headers: { Authorization: 'Bearer lip_SyntheticToken123' },
};

const network: Fetch = vi.fn<Fetch>(() =>
  Promise.reject(new Error('the network is not used in this test')),
);

const env = (over: Partial<Parameters<typeof broadcastFetch>[0]> = {}) => ({
  MYCHESS_ENV: 'local',
  MYCHESS_TEST_SIGNIN: true,
  FIDE_DUMP_FIXTURE_DIR: dir,
  ...over,
});

const INIT: RequestInit = {};

describe('the broadcast fetch', () => {
  it('is the network in production, whatever is set', () => {
    expect(broadcastFetch(env({ MYCHESS_ENV: 'production' }), network)).toBe(
      network,
    );
  });

  it('is the network without the test sign-in switched on', () => {
    expect(broadcastFetch(env({ MYCHESS_TEST_SIGNIN: false }), network)).toBe(
      network,
    );
  });

  it('is the network without a fixture directory', () => {
    expect(
      broadcastFetch(env({ FIDE_DUMP_FIXTURE_DIR: undefined }), network),
    ).toBe(network);
  });

  describe('locally, with the test sign-in on and a fixture directory', () => {
    const fixture = () => broadcastFetch(env(), network);

    it('serves list.txt and a month’s dump from the directory', async () => {
      const list = await fixture()(BROADCAST_LIST_URL, INIT);
      expect(await list.text()).toBe(LIST);
      const dump = await fixture()(broadcastDumpUrl('2026-10'), INIT);
      expect(new Uint8Array(await dump.arrayBuffer())).toEqual(DUMP);
      expect(network).not.toHaveBeenCalled();
    });

    it.each([
      [`${API}/by/paulauskas?page=2`, 'by-paulauskas-2.json'],
      [`${API}/-/-/SynRnd01`, 'round-SynRnd01.json'],
      [`${API}/SynTour1`, 'tour-SynTour1.json'],
      [`${API}/SynTour1.pgn?clocks=false&comments=false`, 'tour-SynTour1.pgn'],
    ])('serves the broadcast API’s %s from %s', async (url, file) => {
      const answer = await fixture()(url, BEARER);
      expect(answer.status).toBe(200);
      expect(await answer.text()).toBe(API_FILES[file]);
      expect(network).not.toHaveBeenCalled();
    });

    it('answers a broadcast API request without a bearer token with 401', async () => {
      for (const init of [INIT, { headers: { Authorization: 'lip_x' } }]) {
        const answer = await fixture()(`${API}/SynTour1`, init);
        expect(answer.status).toBe(401);
      }
    });

    it.each([
      `${API}/by/paulauskas?page=1`,
      `${API}/SynTour2`,
      `${API}/by/paulauskas?page=0`,
      `${API}/by/paulauskas?page=2&x=1`,
      `${API}/by/p?page=2`,
      `${API}/by/../secret.txt?page=2`,
      `${API}/SynTour1.pgn`,
      `${API}/SynTour1.pgn?clocks=true&comments=false`,
      `${API}/SynTour1/`,
      `${API}/SynTour12`,
      `${API}/x/y/SynRnd01`,
      'http://lichess.org/api/broadcast/SynTour1',
      'https://evil.example/api/broadcast/SynTour1',
    ])('maps no other broadcast API URL to a file: %s', async (url) => {
      expect((await fixture()(url, BEARER)).status).toBe(404);
      expect(network).not.toHaveBeenCalled();
    });

    it('answers 404 for a month it has no file for', async () => {
      const dump = await fixture()(broadcastDumpUrl('2026-09'), INIT);
      expect(dump.status).toBe(404);
    });

    it.each([
      'https://lichess.org/api/fide/player/90000001',
      'https://database.lichess.org/broadcast/secret.txt',
      'https://database.lichess.org/broadcast/../secret.txt',
      'https://database.lichess.org/broadcast/lichess_db_broadcast_2026-10.pgn.zst?x=1',
      'http://database.lichess.org/broadcast/list.txt',
      'https://evil.example/broadcast/list.txt',
    ])('maps no other URL to a file: %s', async (url) => {
      expect((await fixture()(url, INIT)).status).toBe(404);
      expect(network).not.toHaveBeenCalled();
    });
  });
});
