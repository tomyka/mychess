'use client';

import type { Chapter } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type JSX } from 'react';
import { chapterLabel } from '../../../lib/chapter-label';
import { SECONDARY_BUTTON } from '../../buttons';
import { ChapterRow, type ChapterBuilder } from './chapter-row';

export type { ChapterBuilder } from './chapter-row';

export interface ChapterListProps {
  readonly chapters: readonly Chapter[];
  readonly chapterId: string | null;
  /** The opening names the chapters are named after (decision 17). */
  readonly ecoNames: Readonly<Record<string, string>>;
  readonly onSelect: (chapterId: string) => void;
  /** Builder mode: add, rename and delete chapters. */
  readonly builder?: ChapterBuilder | undefined;
}

/** Desktop opens the list by default; jsdom and phones keep it closed. */
const isWide = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(min-width: 1024px)').matches;

function Chevron({ open }: { readonly open: boolean }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`size-5 shrink-0 ${open ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** Open on a desktop, closed on a phone; closing returns focus to the trigger. */
function useDisclosure() {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (isWide()) setOpen(true);
  }, []);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return { open, setOpen, trigger, close };
}

/** "Chapter n of m" over the chosen chapter's title. */
function DisclosureText({
  position,
  title,
}: {
  readonly position: string;
  readonly title: string;
}): JSX.Element {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-sm text-fg-muted">{position}</span>
      <span className="line-clamp-2 font-semibold" title={title}>
        {title}
      </span>
    </span>
  );
}

/** Every chapter as a row, the chosen one current; builder mode adds Add chapter. */
function ChapterRows({
  id,
  chapters,
  chapterId,
  title,
  onChoose,
  builder,
  onAdd,
}: {
  readonly id: string;
  readonly chapters: readonly Chapter[];
  readonly chapterId: string | null;
  readonly title: (chapter: Chapter) => string;
  readonly onChoose: (chapterId: string) => void;
  readonly builder: ChapterBuilder | undefined;
  readonly onAdd: () => void;
}): JSX.Element {
  const t = useTranslations('repertoires.chapters');
  return (
    <div id={id} className="flex flex-col gap-2">
      <ul className="flex max-h-60 flex-col overflow-y-auto">
        {chapters.map((c) => (
          <li key={c.id}>
            <ChapterRow
              chapter={c}
              current={c.id === chapterId}
              title={title(c)}
              onChoose={onChoose}
              builder={builder}
            />
          </li>
        ))}
      </ul>
      {builder === undefined ? null : (
        <button
          type="button"
          disabled={builder.disabled}
          onClick={onAdd}
          className={`${SECONDARY_BUTTON} self-start`}
        >
          {t('add')}
        </button>
      )}
    </div>
  );
}

/**
 * The chapter disclosure (docs/design/repertoire-screen.md): "Chapter n of
 * m" and the title; open, every chapter inline, pushing the panel down.
 * Choosing one selects it, closes the list and returns focus here. In
 * builder mode the rows can be renamed and deleted and a chapter added.
 */
export function ChapterList({
  chapters,
  chapterId,
  ecoNames,
  onSelect,
  builder,
}: ChapterListProps): JSX.Element | null {
  const t = useTranslations();
  const listId = useId();
  const { open, setOpen, trigger, close } = useDisclosure();
  const index = chapters.findIndex((c) => c.id === chapterId);
  const chapter = chapters[index];
  if (chapter === undefined) return null;
  const title = chapterLabel(t, ecoNames);
  return (
    <div className="flex flex-col gap-1">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen(!open);
        }}
        className="flex min-h-touch w-full items-center justify-between gap-3 rounded-control text-left"
      >
        <DisclosureText
          position={t('repertoires.chapters.position', {
            index: index + 1,
            count: chapters.length,
          })}
          title={title(chapter)}
        />
        <Chevron open={open} />
      </button>
      {open ? (
        <ChapterRows
          id={listId}
          chapters={chapters}
          chapterId={chapterId}
          title={title}
          builder={builder}
          onChoose={(id) => {
            onSelect(id);
            close();
          }}
          onAdd={() => {
            builder?.onAdd();
            close();
          }}
        />
      ) : null}
    </div>
  );
}
