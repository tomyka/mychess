'use client';

import type { Chapter } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type JSX } from 'react';
import { chapterLabel } from '../../../lib/chapter-label';

export interface ChapterListProps {
  readonly chapters: readonly Chapter[];
  readonly chapterId: string | null;
  /** The opening names the chapters are named after (decision 17). */
  readonly ecoNames: Readonly<Record<string, string>>;
  readonly onSelect: (chapterId: string) => void;
}

/** Desktop opens the list by default; jsdom and phones keep it closed. */
const isWide = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(min-width: 1024px)').matches;

const ROW =
  'flex min-h-touch w-full items-center rounded-control px-3 text-left aria-current:bg-sunken aria-current:font-semibold';

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

/** Every chapter as a row; the chosen one is marked current. */
function ChapterRows({
  id,
  chapters,
  chapterId,
  title,
  onChoose,
}: {
  readonly id: string;
  readonly chapters: readonly Chapter[];
  readonly chapterId: string | null;
  readonly title: (chapter: Chapter) => string;
  readonly onChoose: (chapterId: string) => void;
}): JSX.Element {
  return (
    <ul id={id} className="flex max-h-60 flex-col overflow-y-auto">
      {chapters.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            aria-current={c.id === chapterId ? 'true' : undefined}
            title={title(c)}
            onClick={() => {
              onChoose(c.id);
            }}
            className={ROW}
          >
            <span className="line-clamp-2">{title(c)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The chapter disclosure (docs/design/repertoire-screen.md): "Chapter n of
 * m" and the title; open, every chapter inline, pushing the panel down.
 * Choosing one selects it, closes the list and returns focus here.
 */
export function ChapterList({
  chapters,
  chapterId,
  ecoNames,
  onSelect,
}: ChapterListProps): JSX.Element | null {
  const t = useTranslations();
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (isWide()) setOpen(true);
  }, []);
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
        <span className="flex min-w-0 flex-col">
          <span className="text-sm text-fg-muted">
            {t('repertoires.chapters.position', {
              index: index + 1,
              count: chapters.length,
            })}
          </span>
          <span className="line-clamp-2 font-semibold" title={title(chapter)}>
            {title(chapter)}
          </span>
        </span>
        <Chevron open={open} />
      </button>
      {open ? (
        <ChapterRows
          id={listId}
          chapters={chapters}
          chapterId={chapterId}
          title={title}
          onChoose={(id) => {
            onSelect(id);
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
