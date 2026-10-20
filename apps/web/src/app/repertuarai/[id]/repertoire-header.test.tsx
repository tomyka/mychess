import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../i18n/locales';
import type { DeleteState, RenameState } from './actions';
import { RepertoireActions, RepertoireHeader } from './repertoire-header';

const server = vi.hoisted(() => ({
  rename:
    vi.fn<(previous: RenameState, form: FormData) => Promise<RenameState>>(),
  remove:
    vi.fn<(previous: DeleteState, form: FormData) => Promise<DeleteState>>(),
}));

vi.mock('./actions', () => ({
  renameRepertoireAction: server.rename,
  deleteRepertoireAction: server.remove,
}));

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const h = MESSAGES.lt.repertoires.header;

function renderWith(element: React.ReactNode): void {
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      {element}
    </NextIntlClientProvider>,
  );
}

const renderActions = () => {
  renderWith(<RepertoireActions id={ID} name="Londono sistema" />);
};

const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  server.rename.mockReset().mockResolvedValue({ saved: true });
  server.remove.mockReset().mockResolvedValue({});
});

describe('RepertoireHeader', () => {
  it('names the repertoire and links back to the list', () => {
    renderWith(
      <RepertoireHeader id={ID} name="Londono sistema">
        <span />
      </RepertoireHeader>,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Londono sistema' }),
    ).toBeDefined();
    expect(
      screen.getByRole('link', { name: h.back }).getAttribute('href'),
    ).toBe('/repertuarai');
  });

  it('renames in place of the name and says it was saved', async () => {
    renderWith(<RepertoireHeader id={ID} name="Londono sistema" />);
    fireEvent.click(button(h.rename));
    const field = screen.getByLabelText<HTMLInputElement>(h.renameLabel);
    expect(field.value).toBe('Londono sistema');
    expect(document.activeElement).toBe(field);
    expect(field.closest('header')?.firstElementChild?.nextElementSibling).toBe(
      field.closest('form')?.parentElement,
    );
    fireEvent.change(field, { target: { value: 'Londonas' } });
    fireEvent.click(button(h.renameSubmit));
    expect(await screen.findByText(h.renamed)).toBeDefined();
    expect(screen.queryByLabelText(h.renameLabel)).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(button(h.rename));
    });
  });

  it('cancels the header rename and returns focus to Rename', () => {
    renderWith(<RepertoireHeader id={ID} name="Londono sistema" />);
    fireEvent.click(button(h.rename));
    fireEvent.click(button(h.renameCancel));
    expect(screen.queryByLabelText(h.renameLabel)).toBeNull();
    expect(document.activeElement).toBe(button(h.rename));
  });
});

describe('RepertoireActions', () => {
  it('downloads the PGN and adds games from PGN to this repertoire', () => {
    renderActions();
    const download = screen.getByRole('link', { name: h.download });
    expect(download.getAttribute('href')).toBe(`/api/repertoires/${ID}/export`);
    expect(download.hasAttribute('download')).toBe(true);
    expect(
      screen.getByRole('link', { name: h.importInto }).getAttribute('href'),
    ).toBe(`/repertuarai/importuoti?i=${ID}`);
  });

  it('renames in place and says it was saved', async () => {
    renderActions();
    fireEvent.click(button(h.rename));
    const field = screen.getByLabelText<HTMLInputElement>(h.renameLabel);
    expect(field.value).toBe('Londono sistema');
    fireEvent.change(field, { target: { value: 'Londonas' } });
    fireEvent.click(button(h.renameSubmit));
    await waitFor(() => {
      expect(server.rename).toHaveBeenCalledTimes(1);
    });
    expect(
      Object.fromEntries(server.rename.mock.lastCall?.[1].entries() ?? []),
    ).toEqual({ repertoireId: ID, name: 'Londonas' });
    expect(await screen.findByText(h.renamed)).toBeDefined();
    expect(screen.queryByLabelText(h.renameLabel)).toBeNull();
  });

  it('keeps the field and shows a refusal', async () => {
    server.rename.mockResolvedValue({ refusal: 'repertoire.nameBlank' });
    renderActions();
    fireEvent.click(button(h.rename));
    fireEvent.change(screen.getByLabelText(h.renameLabel), {
      target: { value: ' ' },
    });
    fireEvent.click(button(h.renameSubmit));
    expect(
      await screen.findByText(MESSAGES.lt.repertoire.nameBlank),
    ).toBeDefined();
    expect(
      screen.getByLabelText(h.renameLabel).getAttribute('aria-invalid'),
    ).toBe('true');
  });

  it('cancels a rename with Escape and returns focus to Rename', () => {
    renderActions();
    fireEvent.click(button(h.rename));
    fireEvent.keyDown(screen.getByLabelText(h.renameLabel), { key: 'Escape' });
    expect(screen.queryByLabelText(h.renameLabel)).toBeNull();
    expect(document.activeElement).toBe(button(h.rename));
  });

  it('asks before deleting, with focus on Cancel', () => {
    renderActions();
    fireEvent.click(button(h.delete));
    expect(
      screen.getByText(h.deleteQuestion.replace('{name}', 'Londono sistema')),
    ).toBeDefined();
    expect(document.activeElement).toBe(button(h.deleteCancel));
    fireEvent.click(button(h.deleteCancel));
    expect(screen.queryByRole('button', { name: h.deleteConfirm })).toBeNull();
    expect(document.activeElement).toBe(button(h.delete));
    expect(server.remove).not.toHaveBeenCalled();
    // Nobody has it by assignment: nothing is said about copies.
    expect(screen.queryByText(/30 dien/u)).toBeNull();
  });

  it('says how many players have it and that they can keep a copy (R-131)', () => {
    renderWith(
      <RepertoireActions id={ID} name="Londono sistema" assignedPlayers={3} />,
    );
    fireEvent.click(button(h.delete));
    expect(
      screen.getByText(
        'Šį repertuarą turi 3 žaidėjai. Per 30 dienų jie galės pasilikti asmeninę kopiją.',
      ),
    ).toBeDefined();
  });

  it('says it in the header’s delete too', () => {
    renderWith(
      <RepertoireHeader id={ID} name="Londono sistema" assignedPlayers={1} />,
    );
    fireEvent.click(button(h.delete));
    expect(
      screen.getByText(
        'Šį repertuarą turi 1 žaidėjas. Per 30 dienų jis galės pasilikti asmeninę kopiją.',
      ),
    ).toBeDefined();
  });

  it('deletes for good on the second step', async () => {
    renderActions();
    fireEvent.click(button(h.delete));
    fireEvent.click(button(h.deleteConfirm));
    await waitFor(() => {
      expect(server.remove).toHaveBeenCalledTimes(1);
    });
    expect(
      Object.fromEntries(server.remove.mock.lastCall?.[1].entries() ?? []),
    ).toEqual({ repertoireId: ID });
  });

  it('shows a delete refusal', async () => {
    server.remove.mockResolvedValue({ refusal: 'repertoire.notFound' });
    renderActions();
    fireEvent.click(button(h.delete));
    fireEvent.click(button(h.deleteConfirm));
    expect(
      await screen.findByText(MESSAGES.lt.repertoire.notFound),
    ).toBeDefined();
  });
});
