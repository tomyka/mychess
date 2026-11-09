import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BROADCAST_GAME_LIMITS,
  broadcastGames,
  type BroadcastGameRecord,
} from './broadcast-games';
import { collectAll, textChunks } from './test-support';

const FIXTURE = readFileSync(
  new URL('fixtures/broadcast-month.pgn', import.meta.url),
  'utf8',
);

const URL_BASE = 'https://lichess.org/broadcast/synthetic-open-2026';

function games(text: string, chunkSize = 64): Promise<BroadcastGameRecord[]> {
  return collectAll(broadcastGames(textChunks(text, chunkSize)));
}

/** A one-game PGN with `headers` over a valid base game. */
function game(headers: Readonly<Record<string, string>>): string {
  const all: Record<string, string> = {
    White: 'Base, White',
    Black: 'Base, Black',
    Result: '1-0',
    WhiteFideId: '90000010',
    BroadcastName: 'Synthetic Cup',
    GameURL: `${URL_BASE}/r/x/base`,
    ...headers,
  };
  const tags = Object.entries(all).map(
    ([name, value]) => `[${name} "${value}"]`,
  );
  return `${tags.join('\n')}\n\n1. e4 1-0\n\n`;
}

async function onlyGame(
  headers: Readonly<Record<string, string>>,
): Promise<BroadcastGameRecord | undefined> {
  const found = await games(game(headers));
  expect(found.length).toBeLessThanOrEqual(1);
  return found[0];
}

describe('broadcastGames over the synthetic month', () => {
  it('yields one record per valid game with a FIDE ID, in file order', async () => {
    await expect(games(FIXTURE)).resolves.toEqual([
      {
        url: `${URL_BASE}/round-1/AAAAAAAA/gameAAA1`,
        white: 'Testas, Jonas',
        whiteFideId: 90000001,
        black: 'Pavyzdys, Rūta',
        blackFideId: 90000002,
        date: '2026-03-14',
        result: '1-0',
        eco: 'B12',
        opening: 'Caro-Kann Defense: Advance Variation',
        event: 'Synthetic Open 2026 | Main',
      },
      {
        url: `${URL_BASE}/round-2/BBBBBBBB/gameBBB1`,
        white: 'Fake, Player "Junior"',
        whiteFideId: null,
        black: 'Placeholder, Black',
        blackFideId: 90000003,
        date: null,
        result: '1/2-1/2',
        eco: null,
        opening: null,
        event: 'Synthetic Open 2026 | Main',
      },
      {
        url: `${URL_BASE}/round-2/BBBBBBBB/gameBBB2`,
        white: 'Imaginary, Ada',
        whiteFideId: 90000004,
        black: 'Made Up, Bob',
        blackFideId: null,
        date: null,
        result: '*',
        eco: null,
        opening: null,
        event: 'Synthetic Open 2026 | Main',
      },
      {
        url: `${URL_BASE}/round-3/CCCCCCCC/gameCCC2`,
        white: 'Last, Player',
        whiteFideId: 90000008,
        black: 'Final, Opponent',
        blackFideId: 90000009,
        date: '2026-03-20',
        result: '0-1',
        eco: 'A00',
        opening: null,
        event: 'Synthetic Open 2026 | Main',
      },
    ]);
  });

  it('reads the same games whatever the chunk size', async () => {
    const whole = await games(FIXTURE, FIXTURE.length);
    await expect(games(FIXTURE, 1)).resolves.toEqual(whole);
    await expect(games(FIXTURE.replaceAll('\n', '\r\n'), 7)).resolves.toEqual(
      whole,
    );
  });
});

describe('broadcastGames FIDE IDs', () => {
  it.each(['0', '0123', '1234567890', '12a', '-5', '', ' 1'])(
    'takes FIDE ID %j for none',
    async (raw) => {
      const record = await onlyGame({ BlackFideId: raw });
      expect(record?.blackFideId).toBeNull();
    },
  );

  it('keeps a nine-digit FIDE ID', async () => {
    const record = await onlyGame({ BlackFideId: '999999999' });
    expect(record?.blackFideId).toBe(999_999_999);
  });

  it('keeps a one-digit FIDE ID', async () => {
    const record = await onlyGame({ WhiteFideId: '1' });
    expect(record?.whiteFideId).toBe(1);
  });

  it('skips a game with the same FIDE ID on both sides', async () => {
    await expect(
      onlyGame({ WhiteFideId: '90000010', BlackFideId: '90000010' }),
    ).resolves.toBeUndefined();
  });

  it('skips a game with no valid FIDE ID on either side', async () => {
    await expect(
      onlyGame({ WhiteFideId: '0', BlackFideId: 'x' }),
    ).resolves.toBeUndefined();
  });
});

describe('broadcastGames dates', () => {
  it.each([
    ['2026.03.14', '2026-03-14'],
    ['2024.02.29', '2024-02-29'],
    ['2026.02.29', null],
    ['2026.13.01', null],
    ['2026.??.??', null],
    ['2026-03-14', null],
    ['', null],
  ])('reads Date %j as %j', async (raw, date) => {
    const record = await onlyGame({ Date: raw });
    expect(record?.date).toBe(date);
  });
});

describe('broadcastGames results and links', () => {
  it.each(['1-0', '0-1', '1/2-1/2', '*'])('keeps result %j', async (result) => {
    const record = await onlyGame({ Result: result });
    expect(record?.result).toBe(result);
  });

  it.each(['2-0', '½-½', '', '1-0 '])(
    'skips a game with result %j',
    async (result) => {
      await expect(onlyGame({ Result: result })).resolves.toBeUndefined();
    },
  );

  it.each([
    'javascript:alert(1)',
    'http://lichess.org/abc',
    'https://lichess.org.evil.example/abc',
    'https://lichess.org/abc?x=1',
    'https://lichess.org/',
    'https://lichess.org/a b',
    '',
  ])('skips a game with GameURL %j', async (url) => {
    await expect(onlyGame({ GameURL: url })).resolves.toBeUndefined();
  });

  it('skips a game without a GameURL or a Result', async () => {
    const withoutUrl = game({}).replace(/\[GameURL .*\n/, '');
    const withoutResult = game({}).replace(/\[Result .*\n/, '');
    await expect(games(withoutUrl + withoutResult)).resolves.toEqual([]);
  });
});

describe('broadcastGames texts', () => {
  it('strips control characters and trims names, event and opening', async () => {
    const record = await onlyGame({
      White: '  Tab\tbed\u0007 Name ',
      Black: '\u001b[31mRed\u0085',
      BroadcastName: ' Cup\u0000 ',
      Opening: '\u0001',
    });
    expect(record).toMatchObject({
      white: 'Tabbed Name',
      black: '[31mRed',
      event: 'Cup',
      opening: null,
    });
  });

  it('cuts names, event, ECO and opening to 200 characters', async () => {
    const long = 'ž'.repeat(250);
    const record = await onlyGame({
      White: long,
      ECO: long,
      Opening: long,
      BroadcastName: long,
    });
    const cut = 'ž'.repeat(BROADCAST_GAME_LIMITS.textChars);
    expect(record).toMatchObject({
      white: cut,
      eco: cut,
      opening: cut,
      event: cut,
    });
  });

  it('does not cut a character in half at the 200th place', async () => {
    const record = await onlyGame({ White: `${'a'.repeat(199)}😀b` });
    expect(record?.white).toBe('a'.repeat(199));
  });

  it('takes the Event for the event when there is no BroadcastName', async () => {
    const record = await onlyGame({ BroadcastName: '', Event: 'Plain Event' });
    expect(record?.event).toBe('Plain Event');
  });

  it.each(['White', 'Black'])(
    'skips a game whose %s is missing or blank',
    async (side) => {
      await expect(onlyGame({ [side]: ' \u0002 ' })).resolves.toBeUndefined();
    },
  );

  it('skips a game with neither a BroadcastName nor an Event', async () => {
    await expect(onlyGame({ BroadcastName: '' })).resolves.toBeUndefined();
  });
});

describe('broadcastGames header limits', () => {
  it('skips a game with a header line over 1 KB and reads the next one', async () => {
    const huge = game({
      White: 'x'.repeat(BROADCAST_GAME_LIMITS.headerLineChars),
    });
    const next = game({ GameURL: `${URL_BASE}/r/x/next` });
    const found = await games(huge + next);
    expect(found.map((record) => record.url)).toEqual([`${URL_BASE}/r/x/next`]);
  });

  it('keeps a header line of exactly 1 KB', async () => {
    const prefix = '[Site ""]'.length;
    const site = 'y'.repeat(BROADCAST_GAME_LIMITS.headerLineChars - prefix);
    await expect(onlyGame({ Site: site })).resolves.toBeDefined();
  });

  it('skips a game with more headers than the cap', async () => {
    const extra = Object.fromEntries(
      Array.from({ length: BROADCAST_GAME_LIMITS.headersPerGame }, (_, i) => [
        `Extra${String(i)}`,
        'v',
      ]),
    );
    await expect(onlyGame(extra)).resolves.toBeUndefined();
  });

  it('keeps a game with as many headers as the cap', async () => {
    // The base game has six headers.
    const extra = Object.fromEntries(
      Array.from(
        { length: BROADCAST_GAME_LIMITS.headersPerGame - 6 },
        (_, i) => [`Extra${String(i)}`, 'v'],
      ),
    );
    await expect(onlyGame(extra)).resolves.toBeDefined();
  });

  it('skips a game with a header line that is not a tag pair', async () => {
    const broken = game({}).replace('[Black "Base, Black"]', '[Black Base]');
    await expect(games(broken)).resolves.toEqual([]);
  });
});

describe('broadcastGames move text', () => {
  it('skips long move text without taking it for headers', async () => {
    const moves = `1. e4 { [%clk 1:00:00] } ${'e5 '.repeat(50_000)}1-0`;
    const text = game({}).replace('1. e4 1-0', moves);
    await expect(games(text)).resolves.toHaveLength(1);
  });

  it('takes a move-text line starting with a bracket for move text', async () => {
    const text = game({}).replace('1. e4 1-0', '1. e4 {\n[%clk 1:00:00] } 1-0');
    await expect(
      games(text + game({ GameURL: `${URL_BASE}/r/x/two` })),
    ).resolves.toHaveLength(2);
  });

  it('starts a new game at a tag pair right after move text', async () => {
    const first = game({}).trimEnd();
    const second = game({ GameURL: `${URL_BASE}/r/x/two` });
    const found = await games(`${first}\n${second}`);
    expect(found.map((record) => record.url)).toEqual([
      `${URL_BASE}/r/x/base`,
      `${URL_BASE}/r/x/two`,
    ]);
  });

  it('reads a game whose headers end the text', async () => {
    const headersOnly = game({}).replace('\n\n1. e4 1-0\n\n', '');
    await expect(games(headersOnly)).resolves.toHaveLength(1);
  });

  it('reads a game whose move text follows its headers without a blank line', async () => {
    const noBlank = game({}).replace('\n\n1. e4', '\n1. e4');
    await expect(games(noBlank)).resolves.toHaveLength(1);
  });
});

describe('broadcastGames game cap', () => {
  /** `count` games, a thousand per chunk, then `tail`. */
  async function* manyGames(
    count: number,
    tail: string,
  ): AsyncGenerator<string> {
    const block = '[White "a"]\n\n1. e4 *\n\n'.repeat(1000);
    for (let i = 0; i < count / 1000; i += 1) {
      await Promise.resolve();
      yield block;
    }
    yield tail;
  }

  it('reads a month of exactly 200,000 games', async () => {
    const max = BROADCAST_GAME_LIMITS.gamesPerMonth;
    expect(max).toBe(200_000);
    const last = game({}).replace('[White "Base, White"]\n', '');
    // The last game is the 200,000th: its first line opens it.
    const found = await collectAll(
      broadcastGames(
        manyGames(
          max - 1000,
          '[White "a"]\n\n'.repeat(999) + `[White "last"]\n${last}`,
        ),
      ),
    );
    expect(found.map((record) => record.white)).toEqual(['last']);
  });

  it('fails past 200,000 games in a month', async () => {
    const max = BROADCAST_GAME_LIMITS.gamesPerMonth;
    await expect(
      collectAll(broadcastGames(manyGames(max, '[White "one too many"]\n'))),
    ).rejects.toThrow('more than 200000 games');
  });

  it('reads on demand, one game at a time', async () => {
    let chunksRead = 0;
    async function* endless(): AsyncGenerator<string> {
      for (;;) {
        await Promise.resolve();
        chunksRead += 1;
        yield game({});
      }
    }
    const records = broadcastGames(endless());
    await records.next();
    await records.next();
    await records.return(undefined);
    expect(chunksRead).toBeLessThanOrEqual(3);
  });
});
