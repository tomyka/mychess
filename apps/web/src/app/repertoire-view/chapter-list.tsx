'use client';

import type { Chapter, Standing } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type JSX } from 'react';
import {
  chapterLabel,
  plainChapterLabel,
  type ChapterNames,
} from '../../lib/chapter-label';
import { SECONDARY_BUTTON } from '../buttons';
import { ChapterRow, type ChapterBuilder } from './chapter-row';

export type { ChapterBuilder } from './chapter-row';

export interface ChapterListProps {
  readonly chapters: readonly Chapter[];
  readonly chapterId: string | null;
  /** What titles the chapters (decision 17, R-158). */
  readonly names: ChapterNames;
  readonly onSelect: (chapterId: string) => void;
  /** Builder mode: add, rename and delete chapters. */
  readonly builder?: ChapterBuilder | undefined;
  /** Each chapter's standing by id, for a player who trains it (R-225). */
  readonly standings?: Readonly<Record<string, Standing>> | undefined;
}

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

/** Closed by default at every width; closing returns focus to the trigger. */
function useDisclosure() {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return { open, setOpen, trigger, close };
}

/** Every chapter as a row, the chosen one current; builder mode adds Add chapter. */
function ChapterRows({
  id,
  chapters,
  chapterId,
  title,
  name,
  onChoose,
  builder,
  standings,
  onAdd,
}: {
  readonly id: string;
  readonly chapters: readonly Chapter[];
  readonly chapterId: string | null;
  readonly title: (chapter: Chapter) => string;
  /** A chapter's own name, which renaming starts from. */
  readonly name: (chapter: Chapter) => string;
  readonly onChoose: (chapterId: string) => void;
  readonly builder?: ChapterBuilder | undefined;
  readonly standings?: Readonly<Record<string, Standing>> | undefined;
  readonly onAdd: () => void;
}): JSX.Element {
  const t = useTranslations('repertoires.chapters');
  return (
    <div id={id} className="flex flex-col gap-2">
      {/* No scroller of its own: the open list pushes the panel down and
          the panel scrolls (spec, Chapter line). */}
      <ul className="flex flex-col">
        {chapters.map((c) => (
          <li key={c.id}>
            <ChapterRow
              chapter={c}
              current={c.id === chapterId}
              title={title(c)}
              name={name(c)}
              onChoose={onChoose}
              builder={builder}
              standing={standings?.[c.id]}
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
 * The chapter line (spec, Chapter line): "Ch 2/6 · <label>" on one line,
 * closed at every width; open, every chapter inline, pushing the panel
 * down. Choosing one selects it, closes the list and returns focus here.
 * In builder mode the current chapter can be renamed and deleted and a
 * chapter added.
 */
export function ChapterList(props: ChapterListProps): JSX.Element | null {
  const { chapters, chapterId, names, onSelect, builder } = props;
  const t = useTranslations();
  const listId = useId();
  const { open, setOpen, trigger, close } = useDisclosure();
  const index = chapters.findIndex((c) => c.id === chapterId);
  const chapter = chapters[index];
  if (chapter === undefined) return null;
  const title = chapterLabel(t, names, chapters);
  const name = plainChapterLabel(t, names);
  const line = t('repertoires.chapters.line', {
    index: index + 1,
    count: chapters.length,
    title: title(chapter),
  });
  return (
    <div className="flex flex-col gap-1">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        title={line}
        onClick={() => {
          setOpen(!open);
        }}
        className="flex min-h-touch w-full items-center justify-between gap-3 rounded-control text-left font-semibold"
      >
        <span className="min-w-0 truncate">{line}</span>
        <Chevron open={open} />
      </button>
      {open ? (
        <ChapterRows
          {...props}
          id={listId}
          title={title}
          name={name}
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
