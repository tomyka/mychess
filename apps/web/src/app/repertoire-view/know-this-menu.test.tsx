import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import type { KnowCounts, KnowOutcome } from '../repertuarai/know-actions';
import { KnowThisMenu, type KnowFields } from './know-this-menu';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const lt = MESSAGES.lt.training.know;

const server = vi.hoisted(() => ({
  count: vi.fn<(form: FormData) => Promise<KnowCounts>>(),
  mark: vi.fn<(form: FormData) => Promise<KnowOutcome>>(),
  again: vi.fn<(form: FormData) => Promise<KnowOutcome>>(),
}));

vi.mock('../repertuarai/know-actions', () => ({
  knowCountAction: server.count,
  markKnownAction: server.mark,
  learnAgainAction: server.again,
}));

const MOVE: KnowFields = { kind: 'move', repertoireId: ID, moveKey: 'k|d4' };
const LINE: KnowFields = {
  kind: 'line',
  repertoireId: ID,
  chapterId: 'c1',
  lineIndex: '1',
};

function renderMenu(fields: KnowFields): void {
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <KnowThisMenu fields={fields} subject="1. d4">
        <span>1. d4</span>
      </KnowThisMenu>
    </NextIntlClientProvider>,
  );
}

const toggle = () =>
  screen.getByRole('button', {
    name: lt.toggle.replace('{subject}', '1. d4'),
  });

/** The fields a mocked action was last sent. */
function sent(action: typeof server.count | typeof server.mark) {
  const form = action.mock.lastCall?.[0];
  if (form === undefined) throw new Error('the action was not called');
  return Object.fromEntries(form.entries());
}

const counts = (know: number, again: number): KnowCounts => ({
  ok: true,
  know,
  again,
});

beforeEach(() => {
  server.count.mockReset().mockResolvedValue(counts(1, 0));
  server.mark.mockReset().mockResolvedValue({ ok: true, changed: 1 });
  server.again.mockReset().mockResolvedValue({ ok: true, changed: 2 });
});

describe('KnowThisMenu (R-58, R-147)', () => {
  it('is closed until opened, and counts only then', async () => {
    renderMenu(MOVE);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(server.count).not.toHaveBeenCalled();
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    await screen.findByRole('button', { name: lt.knowMove });
    expect(sent(server.count)).toEqual(MOVE);
  });

  it('marks a single move at once, with no confirm', async () => {
    renderMenu(MOVE);
    fireEvent.click(toggle());
    server.count.mockResolvedValue(counts(0, 0));
    fireEvent.click(await screen.findByRole('button', { name: lt.knowMove }));
    await screen.findByText('1 ėjimas pažymėtas kaip žinomas.');
    expect(sent(server.mark)).toEqual(MOVE);
    // Counted again: nothing left to mark.
    await screen.findByText(lt.nothing);
    expect(screen.queryByRole('button', { name: lt.knowMove })).toBeNull();
  });

  it('asks before marking a line, with the count', async () => {
    server.count.mockResolvedValue(counts(5, 0));
    renderMenu(LINE);
    fireEvent.click(toggle());
    fireEvent.click(await screen.findByRole('button', { name: lt.knowLine }));
    expect(
      screen.getByText(
        'Pažymėti 5 ėjimus kaip žinomus? Mokytis jų nereikės, pirmasis kartojimas bus rytoj.',
      ),
    ).toBeDefined();
    expect(server.mark).not.toHaveBeenCalled();
    server.mark.mockResolvedValue({ ok: true, changed: 5 });
    fireEvent.click(screen.getByRole('button', { name: lt.confirm }));
    await screen.findByText('5 ėjimai pažymėti kaip žinomi.');
    expect(sent(server.mark)).toEqual(LINE);
  });

  it('offers Learn again only when there are skipped moves', async () => {
    renderMenu(LINE);
    fireEvent.click(toggle());
    await screen.findByRole('button', { name: lt.knowLine });
    expect(
      screen.queryByRole('button', { name: /Mokytis iš naujo/ }),
    ).toBeNull();
  });

  it('returns the skipped moves to learn', async () => {
    server.count.mockResolvedValue(counts(0, 2));
    renderMenu(LINE);
    fireEvent.click(toggle());
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Mokytis iš naujo (2 ėjimai)',
      }),
    );
    await screen.findByText('2 ėjimai grąžinti mokytis.');
    expect(sent(server.again)).toEqual(LINE);
    expect(server.mark).not.toHaveBeenCalled();
  });

  it('says so when every move is already in review', async () => {
    server.count.mockResolvedValue(counts(0, 0));
    renderMenu(LINE);
    fireEvent.click(toggle());
    expect(await screen.findByText(lt.nothing)).toBeDefined();
  });

  it('shows a refusal in words', async () => {
    server.count.mockResolvedValue({
      ok: false,
      refusal: 'training.notTrained',
    });
    renderMenu(MOVE);
    fireEvent.click(toggle());
    expect(
      await screen.findByText(MESSAGES.lt.training.notTrained),
    ).toBeDefined();
  });

  it('shows a refused action as an error', async () => {
    renderMenu(MOVE);
    fireEvent.click(toggle());
    server.mark.mockResolvedValue({
      ok: false,
      refusal: 'training.notTrained',
    });
    fireEvent.click(await screen.findByRole('button', { name: lt.knowMove }));
    const status = await screen.findByText(MESSAGES.lt.training.notTrained);
    expect(status.getAttribute('role')).toBe('status');
    expect(status.className).toContain('text-error');
  });

  it('says a failed request failed', async () => {
    server.count.mockRejectedValue(new Error('offline'));
    renderMenu(MOVE);
    fireEvent.click(toggle());
    expect(await screen.findByText(lt.failed)).toBeDefined();
  });

  it('closes again', async () => {
    renderMenu(MOVE);
    fireEvent.click(toggle());
    await screen.findByRole('button', { name: lt.knowMove });
    fireEvent.click(toggle());
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: lt.knowMove })).toBeNull();
    });
  });
});
