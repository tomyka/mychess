import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  chapters: [{ kind: 'text', text: 'Taimanov' }],
  skipped: [],
  target: null,
  refusal: null,
};

const MERGED: ImportPreview = {
  ...PREVIEW,
  summary: { ...PREVIEW.summary, chapters: 3 },
  target: {
    id: 'r-black',
    name: 'Taimanovas',
    version: 4,
    added: { chapters: 2, moves: 41 },
  },
};

function renderFlow(preselected: string | null = null): void {
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <ImportFlow options={OPTIONS} preselected={preselected} />
    </NextIntlClientProvider>,
  );
}

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
  server.preview.mockReset().mockImplementation((input) =>
    Promise.resolve({
      ok: true,
      preview: intoOf(input) === undefined ? PREVIEW : MERGED,
    }),
  );
  server.confirm
    .mockReset()
    .mockResolvedValue({ ok: false, refusal: 'repertoire.stale' });
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
      refusal: 'pgn.tooManyGames',
      limit: 200,
    });
    renderFlow();
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: i.preview }));
    expect(
      await screen.findByText('Faile daugiau nei 200 partijų.'),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: i.preview })).toBeDefined();
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
      refusal: 'repertoire.nameBlank',
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
          added: { chapters: 0, moves: 0 },
        },
        refusal: 'pgn.nothingToAdd',
      },
    });
    fireEvent.click(screen.getByRole('radio', { name: i.targetExisting }));
    const said = await screen.findByText(MESSAGES.lt.pgn.nothingToAdd);
    expect(said.getAttribute('role')).toBe('status');
    expect(confirm.hasAttribute('disabled')).toBe(true);
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

  it('resets the target when the repertoire is gone', async () => {
    renderFlow();
    await previewAsBlack();
    server.preview.mockResolvedValue({
      ok: false,
      refusal: 'repertoire.notFound',
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
