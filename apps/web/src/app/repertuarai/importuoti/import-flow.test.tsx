import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../i18n/locales';
import type {
  ImportPreview,
  ImportRefused,
  PreviewOutcome,
} from '../../../server/import-preview';
import { ImportFlow, type ImportOption } from './import-flow';

const server = vi.hoisted(() => ({
  preview: vi.fn<(input: unknown) => Promise<PreviewOutcome>>(),
  confirm: vi.fn<(input: unknown) => Promise<ImportRefused>>(),
}));

// The chess rule itself, watched: how often the flow asks it (decision 8).
const chess = vi.hoisted(() => ({
  playerSide: vi.fn<(text: string, names: readonly string[]) => unknown>(),
}));

vi.mock('@mychess/chess', async (original) => {
  const real = await original<typeof import('@mychess/chess')>();
  chess.playerSide.mockImplementation(real.playerSide);
  return { ...real, playerSide: chess.playerSide };
});

vi.mock('./actions', () => ({
  previewImportAction: server.preview,
  confirmImportAction: server.confirm,
}));

const i = MESSAGES.lt.repertoires.import;
const c = MESSAGES.lt.repertoires.create;

const OPTIONS: readonly ImportOption[] = [
  { id: 'r-black', name: 'Taimanovas', side: 'black' },
  { id: 'r-white', name: 'Londonas', side: 'white' },
];

const PGN = '[Event "Taimanov"]\n\n1. e4 c5 *\n';

const PREVIEW: ImportPreview = {
  summary: { chapters: 1, lines: 1, positions: 3, transpositions: 0, moves: 2 },
  chapters: ['Taimanov'],
  renamed: [],
  skipped: [],
  annotations: [],
  target: null,
  refusal: null,
  suggestedSide: null,
};

const MERGED: ImportPreview = {
  ...PREVIEW,
  summary: { ...PREVIEW.summary, chapters: 3 },
  target: {
    id: 'r-black',
    name: 'Taimanovas',
    version: 4,
    added: { chapters: 2, moves: 41, annotated: 0 },
  },
};

function renderFlow(
  preselected: string | null = null,
  names: readonly string[] = [],
): void {
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <ImportFlow options={OPTIONS} preselected={preselected} names={names} />
    </NextIntlClientProvider>,
  );
}

const pasteField = () => screen.getByLabelText<HTMLTextAreaElement>(i.paste);

function paste(text: string): void {
  fireEvent.change(pasteField(), { target: { value: text } });
}

const sideRadio = (name: string) =>
  screen.getByRole<HTMLInputElement>('radio', { name });

function chooseFile(file = new File([PGN], 'taimanov.pgn')): void {
  fireEvent.change(screen.getByLabelText(i.file), {
    target: { files: [file] },
  });
}

async function previewAsBlack(): Promise<void> {
  chooseFile();
  fireEvent.click(screen.getByRole('radio', { name: c.black }));
  fireEvent.click(screen.getByRole('button', { name: i.preview }));
  await screen.findByRole('heading', { name: i.summaryTitle });
}

/**
 * The Import button once the preview's transition has settled: it is
 * disabled while a preview is pending, which can outlast the first render
 * of the summary when the machine is busy.
 */
async function enabledConfirm(): Promise<HTMLElement> {
  const button = screen.getByRole('button', { name: i.confirm });
  await waitFor(() => {
    expect(button.hasAttribute('disabled')).toBe(false);
  });
  return button;
}

/** The repertoire a preview request names in `into`, if any. */
const intoOf = (input: unknown): unknown =>
  typeof input === 'object' && input !== null && 'into' in input
    ? input.into
    : undefined;

beforeEach(() => {
  chess.playerSide.mockClear();
  server.preview.mockReset().mockImplementation((input) =>
    Promise.resolve({
      ok: true,
      preview: intoOf(input) === undefined ? PREVIEW : MERGED,
    }),
  );
  server.confirm
    .mockReset()
    .mockResolvedValue({ ok: false, refusal: { reason: 'repertoire.stale' } });
});

describe('ImportFlow', () => {
  it('reads the file and shows the summary from the preview', async () => {
    renderFlow();
    chooseFile();
    expect(screen.getByText('taimanov.pgn · 1 KB')).toBeDefined();
    fireEvent.click(screen.getByRole('radio', { name: c.black }));
    fireEvent.click(screen.getByRole('button', { name: i.preview }));
    const heading = await screen.findByRole('heading', {
      name: i.summaryTitle,
    });
    expect(server.preview).toHaveBeenCalledWith({
      text: PGN,
      side: 'black',
      into: undefined,
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(screen.getByText('1 skyrius')).toBeDefined();
    expect(screen.getByText('taimanov.pgn · Juodieji')).toBeDefined();
    expect(screen.queryByRole('button', { name: i.preview })).toBeNull();
  });

  it('refuses a file over 2 MB without uploading it', () => {
    renderFlow();
    const big = new File(['x'], 'big.pgn');
    Object.defineProperty(big, 'size', { value: 2 * 1024 * 1024 + 1 });
    chooseFile(big);
    fireEvent.click(screen.getByRole('button', { name: i.preview }));
    expect(
      screen.getByText('Failas didesnis nei 2 MB.').getAttribute('role'),
    ).toBe('status');
    expect(server.preview).not.toHaveBeenCalled();
  });

  it('says it is reading the file when the preview takes a while', async () => {
    // Settled at the end: React entangles pending async transitions, so one
    // left hanging would hold the next test's transitions pending too.
    let settle: (outcome: PreviewOutcome) => void = () => undefined;
    server.preview.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    renderFlow();
    chooseFile();
    const button = screen.getByRole('button', { name: i.preview });
    fireEvent.click(button);
    await waitFor(() => {
      expect(button.hasAttribute('disabled')).toBe(true);
    });
    expect(screen.queryByText(i.reading)).toBeNull();
    expect(
      await screen.findByText(i.reading, {}, { timeout: 2000 }),
    ).toBeDefined();
    settle({ ok: true, preview: PREVIEW });
    await screen.findByRole('heading', { name: i.summaryTitle });
    await waitFor(() => {
      expect(screen.queryByText(i.reading)).toBeNull();
    });
  });

  it('asks for a file before reading one', () => {
    renderFlow();
    fireEvent.click(screen.getByRole('button', { name: i.preview }));
    expect(screen.getByText(i.noFile)).toBeDefined();
    expect(server.preview).not.toHaveBeenCalled();
  });

  it('names the limit a refused file breaks and keeps step 1 open', async () => {
    server.preview.mockResolvedValue({
      ok: false,
      refusal: { reason: 'pgn.tooManyGames', limit: 200 },
    });
    renderFlow();
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: i.preview }));
    expect(
      await screen.findByText('Faile daugiau nei 200 partijų.'),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: i.preview })).toBeDefined();
  });

  it('says the repertoire limits with their numbers (R-162)', async () => {
    server.preview.mockResolvedValueOnce({
      ok: false,
      refusal: { reason: 'repertoire.tooManyMoves', limit: 5000 },
    });
    renderFlow();
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: i.preview }));
    expect(
      await screen.findByText(
        /^Repertuare gali būti ne daugiau kaip 5\s000 ėjimų\.$/,
      ),
    ).toBeDefined();
    server.preview.mockResolvedValueOnce({
      ok: false,
      refusal: { reason: 'repertoire.limit', limit: 50 },
    });
    const again = screen.getByRole('button', { name: i.preview });
    await waitFor(() => {
      expect(again.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(again);
    expect(
      await screen.findByText(
        'Galite turėti ne daugiau kaip 50 repertuarų. Ištrinkite kurį nors, kad pridėtumėte naują.',
      ),
    ).toBeDefined();
  });

  it('says a file of too many half-moves and too many previews a minute are refused (R-119, R-208)', async () => {
    server.preview.mockResolvedValueOnce({
      ok: false,
      refusal: { reason: 'pgn.tooManyMoves', limit: 50_000 },
    });
    renderFlow();
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: i.preview }));
    expect(
      await screen.findByText(/^Faile daugiau nei 50\s000 pusėjimių\.$/),
    ).toBeDefined();
    server.preview.mockResolvedValueOnce({
      ok: false,
      refusal: { reason: 'pgn.tooManyPreviews', limit: 30 },
    });
    // The first request's transition may still hold the button disabled.
    const again = screen.getByRole('button', { name: i.preview });
    await waitFor(() => {
      expect(again.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(again);
    expect(
      await screen.findByText(
        'Per daug peržiūrų: ne daugiau kaip 30 per minutę. Palaukite minutę ir bandykite dar kartą.',
      ),
    ).toBeDefined();
  });

  it('re-runs the preview against the chosen repertoire', async () => {
    renderFlow();
    await previewAsBlack();
    fireEvent.click(screen.getByRole('radio', { name: i.targetExisting }));
    await waitFor(() => {
      expect(server.preview).toHaveBeenLastCalledWith({
        text: PGN,
        side: 'black',
        into: 'r-black',
      });
    });
    expect(
      await screen.findByText(
        'Prideda 2 skyrius ir 41 ėjimą prie „Taimanovas“.',
      ),
    ).toBeDefined();
    const select = screen.getByLabelText<HTMLSelectElement>(i.existing);
    expect([...select.options].map((o) => o.text)).toEqual(['Taimanovas']);
  });

  it('Change reopens step 1 and focuses the file input', async () => {
    renderFlow();
    await previewAsBlack();
    fireEvent.click(screen.getByRole('button', { name: i.change }));
    expect(screen.queryByRole('heading', { name: i.summaryTitle })).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(i.file));
    });
    expect(screen.getByRole('button', { name: i.preview })).toBeDefined();
  });

  it('drops the chosen repertoire when the side changes', async () => {
    renderFlow();
    await previewAsBlack();
    fireEvent.click(screen.getByRole('radio', { name: i.targetExisting }));
    await screen.findByText(/Prideda 2 skyrius/);
    fireEvent.click(screen.getByRole('button', { name: i.change }));
    fireEvent.click(screen.getByRole('radio', { name: c.white }));
    fireEvent.click(screen.getByRole('button', { name: i.preview }));
    await screen.findByRole('heading', { name: i.summaryTitle });
    expect(server.preview).toHaveBeenLastCalledWith({
      text: PGN,
      side: 'white',
      into: undefined,
    });
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: i.targetNew })
        .checked,
    ).toBe(true);
  });

  it('confirms a new repertoire with its name', async () => {
    renderFlow();
    await previewAsBlack();
    fireEvent.change(screen.getByLabelText(i.name), {
      target: { value: 'Taimanovas' },
    });
    fireEvent.click(await enabledConfirm());
    await waitFor(() => {
      expect(server.confirm).toHaveBeenCalledWith({
        text: PGN,
        side: 'black',
        target: { kind: 'new', name: 'Taimanovas' },
      });
    });
  });

  it('marks the name when the server refuses it', async () => {
    server.confirm.mockResolvedValue({
      ok: false,
      refusal: { reason: 'repertoire.nameBlank' },
    });
    renderFlow();
    await previewAsBlack();
    fireEvent.click(await enabledConfirm());
    await screen.findByText(MESSAGES.lt.repertoire.nameBlank);
    expect(screen.getByLabelText(i.name).getAttribute('aria-invalid')).toBe(
      'true',
    );
  });

  it('offers to preview again when the repertoire changed', async () => {
    renderFlow();
    await previewAsBlack();
    fireEvent.click(screen.getByRole('radio', { name: i.targetExisting }));
    await screen.findByText(/Prideda 2 skyrius/);
    fireEvent.click(await enabledConfirm());
    await waitFor(() => {
      expect(server.confirm).toHaveBeenCalledWith({
        text: PGN,
        side: 'black',
        target: { kind: 'existing', id: 'r-black', version: 4 },
      });
    });
    const again = await screen.findByRole('button', { name: i.previewAgain });
    expect(screen.getByText(MESSAGES.lt.repertoire.stale)).toBeDefined();
    await waitFor(() => {
      expect(document.activeElement).toBe(again);
    });
    server.preview.mockClear();
    fireEvent.click(again);
    await waitFor(() => {
      expect(server.preview).toHaveBeenCalledWith({
        text: PGN,
        side: 'black',
        into: 'r-black',
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: i.previewAgain })).toBeNull();
    });
  });

  it('disables Import and says why when nothing can be added (R-115)', async () => {
    renderFlow();
    await previewAsBlack();
    const confirm = await enabledConfirm();
    server.preview.mockResolvedValue({
      ok: true,
      preview: {
        ...MERGED,
        chapters: [],
        target: {
          id: 'r-black',
          name: 'Taimanovas',
          version: 4,
          added: { chapters: 0, moves: 0, annotated: 0 },
        },
        refusal: 'pgn.nothingToAdd',
      },
    });
    fireEvent.click(screen.getByRole('radio', { name: i.targetExisting }));
    const said = await screen.findByText(MESSAGES.lt.pgn.nothingToAdd);
    expect(said.getAttribute('role')).toBe('status');
    expect(confirm.hasAttribute('disabled')).toBe(true);
    // The target card does not promise "adds 0 chapters and 0 moves".
    expect(screen.queryByText(/„Taimanovas“/)).toBeNull();
    fireEvent.click(confirm);
    expect(server.confirm).not.toHaveBeenCalled();
    // A new repertoire can still take the file.
    server.preview.mockResolvedValue({ ok: true, preview: PREVIEW });
    fireEvent.click(screen.getByRole('radio', { name: i.targetNew }));
    await waitFor(() => {
      expect(screen.queryByText(MESSAGES.lt.pgn.nothingToAdd)).toBeNull();
    });
    await enabledConfirm();
  });

  it('enables Import for a file that only adds comments and NAGs, and says so (R-176)', async () => {
    renderFlow();
    await previewAsBlack();
    server.preview.mockResolvedValue({
      ok: true,
      preview: {
        ...MERGED,
        chapters: [],
        annotations: [{ move: '5. Nc3', comment: 'Main line' }],
        target: {
          id: 'r-black',
          name: 'Taimanovas',
          version: 4,
          added: { chapters: 0, moves: 0, annotated: 1 },
        },
      },
    });
    fireEvent.click(screen.getByRole('radio', { name: i.targetExisting }));
    await screen.findByText('Prideda komentarų ar ženklų 1 jau esamam ėjimui.');
    expect(screen.getByText('5. Nc3: Main line')).toBeDefined();
    // No "adds 0 chapters and 0 moves" promise beside it.
    expect(screen.queryByText(/Prideda 0/)).toBeNull();
    fireEvent.click(await enabledConfirm());
    await waitFor(() => {
      expect(server.confirm).toHaveBeenCalledWith({
        text: PGN,
        side: 'black',
        target: { kind: 'existing', id: 'r-black', version: 4 },
      });
    });
  });

  it('says both what a merge adds in moves and in comments', async () => {
    server.preview.mockImplementation((input) =>
      Promise.resolve({
        ok: true,
        preview:
          intoOf(input) === undefined
            ? PREVIEW
            : {
                ...MERGED,
                target: {
                  id: 'r-black',
                  name: 'Taimanovas',
                  version: 4,
                  added: { chapters: 2, moves: 41, annotated: 3 },
                },
              },
      }),
    );
    renderFlow();
    await previewAsBlack();
    fireEvent.click(screen.getByRole('radio', { name: i.targetExisting }));
    await screen.findByText(/Prideda 2 skyrius/);
    expect(
      screen.getByText('Prideda komentarų ar ženklų 3 jau esamiems ėjimams.'),
    ).toBeDefined();
  });

  it('resets the target when the repertoire is gone', async () => {
    renderFlow();
    await previewAsBlack();
    server.preview.mockResolvedValue({
      ok: false,
      refusal: { reason: 'repertoire.notFound' },
    });
    fireEvent.click(screen.getByRole('radio', { name: i.targetExisting }));
    expect(
      await screen.findByText(MESSAGES.lt.repertoire.notFound),
    ).toBeDefined();
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: i.targetNew })
        .checked,
    ).toBe(true);
  });

  it('opened from a repertoire, fixes its side and adds to it', async () => {
    renderFlow('r-white');
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: c.white }).checked,
    ).toBe(true);
    expect(
      screen.getByRole('radio', { name: c.black }).hasAttribute('disabled'),
    ).toBe(true);
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: i.preview }));
    await screen.findByRole('heading', { name: i.summaryTitle });
    expect(server.preview).toHaveBeenCalledWith({
      text: PGN,
      side: 'white',
      into: 'r-white',
    });
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: i.targetExisting })
        .checked,
    ).toBe(true);
  });

  it('disables adding when the side has no repertoire', async () => {
    render(
      <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
        <ImportFlow
          options={OPTIONS.filter((o) => o.side === 'black')}
          preselected={null}
          names={[]}
        />
      </NextIntlClientProvider>,
    );
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: i.preview }));
    await screen.findByRole('heading', { name: i.summaryTitle });
    expect(
      screen
        .getByRole('radio', { name: i.targetExisting })
        .hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen.getByText(MESSAGES.lt.repertoires.list.emptyWhite),
    ).toBeDefined();
  });
});

describe('pasted PGN (R-209, #330 decision 10)', () => {
  it('previews pasted text as it previews a file, and names it pasted', async () => {
    renderFlow();
    paste(PGN);
    fireEvent.click(screen.getByRole('radio', { name: c.black }));
    fireEvent.click(screen.getByRole('button', { name: i.preview }));
    await screen.findByRole('heading', { name: i.summaryTitle });
    expect(server.preview).toHaveBeenCalledExactlyOnceWith({
      text: PGN,
      side: 'black',
      into: undefined,
    });
    expect(screen.getByText(`${i.pasted} · Juodieji`)).toBeDefined();
  });

  it('confirms the pasted text it previewed', async () => {
    renderFlow();
    paste(PGN);
    fireEvent.click(screen.getByRole('button', { name: i.preview }));
    await screen.findByRole('heading', { name: i.summaryTitle });
    fireEvent.change(screen.getByLabelText(i.name), {
      target: { value: 'Įklijuotas' },
    });
    fireEvent.click(await enabledConfirm());
    await waitFor(() => {
      expect(server.confirm).toHaveBeenCalledWith({
        text: PGN,
        side: 'white',
        target: { kind: 'new', name: 'Įklijuotas' },
      });
    });
  });

  it('sends one of the two: a file chosen clears the pasted text', async () => {
    renderFlow();
    paste('1. d4 *');
    chooseFile();
    expect(pasteField().value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: i.preview }));
    await screen.findByRole('heading', { name: i.summaryTitle });
    expect(server.preview).toHaveBeenCalledWith(
      expect.objectContaining({ text: PGN }),
    );
  });

  it('sends one of the two: pasting drops the chosen file', async () => {
    renderFlow();
    chooseFile(new File(['1. e4 *'], 'kitas.pgn'));
    paste(PGN);
    expect(screen.queryByText(/^kitas\.pgn/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: i.preview }));
    await screen.findByRole('heading', { name: i.summaryTitle });
    expect(server.preview).toHaveBeenCalledWith(
      expect.objectContaining({ text: PGN }),
    );
  });

  it('asks for a file or a paste when the pasted text is blank', () => {
    renderFlow();
    paste('  \n ');
    fireEvent.click(screen.getByRole('button', { name: i.preview }));
    expect(screen.getByText(i.noFile)).toBeDefined();
    expect(server.preview).not.toHaveBeenCalled();
  });

  it('refuses pasted text over 2 MB before sending it (R-66)', () => {
    renderFlow();
    paste('ą'.repeat(1024 * 1024 + 1));
    fireEvent.click(screen.getByRole('button', { name: i.preview }));
    expect(screen.getByText('Failas didesnis nei 2 MB.')).toBeDefined();
    expect(server.preview).not.toHaveBeenCalled();
  });
});

describe('the side the file’s players name (#330 decision 8)', () => {
  const NAMES = ['Dovydas Jankauskas', 'dovydasj'];
  const AS_BLACK = '[White "X"]\n[Black "DovydasJ"]\n\n1. e4 c5 *\n';

  /** Typing settles: the side is read 300 ms after the last change. */
  const typingPauses = (ms = 300): void => {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to Black when every pasted game names the account as Black, once typing pauses', () => {
    vi.useFakeTimers();
    renderFlow(null, NAMES);
    paste(AS_BLACK);
    typingPauses(299);
    expect(sideRadio(c.white).checked).toBe(true);
    typingPauses(1);
    expect(sideRadio(c.black).checked).toBe(true);
  });

  it('reads the players once per pause, not on every keystroke', () => {
    vi.useFakeTimers();
    renderFlow(null, NAMES);
    for (let n = 1; n <= AS_BLACK.length; n += 8) {
      paste(AS_BLACK.slice(0, n));
      typingPauses(100);
    }
    paste(AS_BLACK);
    expect(chess.playerSide).not.toHaveBeenCalled();
    typingPauses();
    expect(chess.playerSide).toHaveBeenCalledExactlyOnceWith(AS_BLACK, NAMES);
    expect(sideRadio(c.black).checked).toBe(true);
  });

  it('keeps a side chosen while typing', () => {
    vi.useFakeTimers();
    renderFlow(null, NAMES);
    paste(AS_BLACK);
    fireEvent.click(sideRadio(c.black));
    fireEvent.click(sideRadio(c.white));
    typingPauses();
    expect(sideRadio(c.white).checked).toBe(true);
  });

  it('lets a file chosen while typing decide, not the text it replaced', async () => {
    vi.useFakeTimers();
    renderFlow(null, NAMES);
    paste(AS_BLACK);
    chooseFile(new File(['[White "X"]\n[Black "Y"]\n\n1. e4 *\n'], 'k.pgn'));
    typingPauses();
    await act(async () => {
      await Promise.resolve();
    });
    expect(sideRadio(c.white).checked).toBe(true);
  });

  it('defaults to the side a chosen file names the account on', async () => {
    renderFlow(null, NAMES);
    chooseFile(new File([AS_BLACK], 'mano.pgn'));
    await waitFor(() => {
      expect(sideRadio(c.black).checked).toBe(true);
    });
  });

  it('goes back to White when the next file names no one (otherwise White)', async () => {
    renderFlow(null, NAMES);
    chooseFile(new File([AS_BLACK], 'mano.pgn'));
    await waitFor(() => {
      expect(sideRadio(c.black).checked).toBe(true);
    });
    chooseFile(new File(['[White "X"]\n[Black "Y"]\n\n1. e4 *\n'], 'k.pgn'));
    await waitFor(() => {
      expect(sideRadio(c.white).checked).toBe(true);
    });
  });

  it('goes back to White when text naming no one replaces a Black file', async () => {
    renderFlow(null, NAMES);
    chooseFile(new File([AS_BLACK], 'mano.pgn'));
    await waitFor(() => {
      expect(sideRadio(c.black).checked).toBe(true);
    });
    vi.useFakeTimers();
    paste('1. e4 c5 *\n');
    typingPauses();
    expect(sideRadio(c.white).checked).toBe(true);
  });

  it('goes back to White for a file too large to read', async () => {
    renderFlow(null, NAMES);
    chooseFile(new File([AS_BLACK], 'mano.pgn'));
    await waitFor(() => {
      expect(sideRadio(c.black).checked).toBe(true);
    });
    const big = new File(['x'], 'big.pgn');
    Object.defineProperty(big, 'size', { value: 2 * 1024 * 1024 + 1 });
    chooseFile(big);
    expect(sideRadio(c.white).checked).toBe(true);
  });

  it('keeps White when the games do not name the account', () => {
    vi.useFakeTimers();
    renderFlow(null, NAMES);
    paste('[White "X"]\n[Black "Y"]\n\n1. e4 c5 *\n');
    typingPauses();
    expect(sideRadio(c.white).checked).toBe(true);
  });

  it('keeps the side the player chose', async () => {
    renderFlow(null, ['Rokas']);
    fireEvent.click(sideRadio(c.black));
    paste('[White "Rokas"]\n[Black "X"]\n\n1. e4 *\n');
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(sideRadio(c.black).checked).toBe(true);
    chooseFile(new File(['[White "Rokas"]\n\n1. e4 *\n'], 'r.pgn'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sideRadio(c.black).checked).toBe(true);
  });

  it('keeps the side of the repertoire it was opened from', () => {
    vi.useFakeTimers();
    renderFlow('r-white', NAMES);
    paste(AS_BLACK);
    typingPauses();
    expect(sideRadio(c.white).checked).toBe(true);
  });
});

describe('ImportFlow side check (#364, R-214)', () => {
  /** The side a preview request names. */
  const sideOf = (input: unknown): unknown =>
    typeof input === 'object' && input !== null && 'side' in input
      ? input.side
      : undefined;

  /** The server suggests Black for a preview as White, nothing as Black. */
  beforeEach(() => {
    server.preview.mockImplementation((input) =>
      Promise.resolve({
        ok: true,
        preview: {
          ...(intoOf(input) === undefined ? PREVIEW : MERGED),
          suggestedSide: sideOf(input) === 'white' ? 'black' : null,
        },
      }),
    );
  });

  const SWITCH = 'Peržiūrėti juodaisiais';
  const warning = () =>
    screen.queryByText(
      'Daugumoje partijų ėjimai praleisti kaip antri atsakymai. Gal norėjote importuoti juodaisiais?',
    );

  async function previewAsWhite(preselected: string | null = null) {
    renderFlow(preselected);
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: i.preview }));
    await screen.findByRole('heading', { name: i.summaryTitle });
  }

  it('warns and previews the file again as the suggested side', async () => {
    await previewAsWhite();
    expect(warning()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: SWITCH }));
    await waitFor(() => {
      expect(warning()).toBeNull();
    });
    expect(server.preview).toHaveBeenLastCalledWith({
      text: PGN,
      side: 'black',
      into: undefined,
    });
    // The side is now Black: the chosen-file line says so.
    expect(screen.getByText(`taimanov.pgn · ${c.black}`)).toBeDefined();
  });

  it('keeps the side when the preview as the other side is refused', async () => {
    await previewAsWhite();
    server.preview.mockResolvedValueOnce({
      ok: false,
      refusal: { reason: 'repertoire.limit', limit: 3 },
    });
    fireEvent.click(screen.getByRole('button', { name: SWITCH }));
    await waitFor(() => {
      expect(server.preview).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: SWITCH })).toBeDefined();
    });
    expect(screen.getByText(`taimanov.pgn · ${c.white}`)).toBeDefined();
  });

  it('warns without a switch when the side is fixed by the repertoire', async () => {
    await previewAsWhite('r-white');
    expect(warning()).not.toBeNull();
    expect(screen.queryByRole('button', { name: SWITCH })).toBeNull();
  });
});
