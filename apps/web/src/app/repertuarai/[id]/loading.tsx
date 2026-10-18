import type { JSX } from 'react';

const LINE = 'h-5 rounded-control bg-sunken';

/** The board's squares from the board tokens, a8 light: no pieces, not focusable. */
const BOARD_FRAME = {
  backgroundImage:
    'repeating-conic-gradient(var(--color-board-dark) 0 25%, var(--color-board-light) 0 50%)',
  backgroundSize: '25% 25%',
};

// The repertoire page while it loads (docs/design/repertoire-screen.md,
// States): the real board frame without pieces and skeleton lines for the
// top bar, the chapter row, the comment and the move list.
export default function RepertoireLoading(): JSX.Element {
  return (
    <main
      aria-busy="true"
      className="flex h-dvh flex-col lg:mx-auto lg:h-auto lg:max-w-6xl lg:gap-6 lg:px-gutter-wide lg:py-8"
    >
      <div className="flex min-h-14 items-center px-gutter lg:px-0">
        <div className={`${LINE} w-48`} />
      </div>
      <div className="flex flex-col lg:flex-row lg:justify-center lg:gap-8">
        <div
          aria-hidden="true"
          style={BOARD_FRAME}
          className="aspect-square w-full lg:w-[min(calc(100dvh-12rem),42rem)] lg:rounded-board"
        />
        <div className="flex flex-col gap-3 px-gutter py-3 lg:w-panel lg:px-0">
          <div className={`${LINE} w-40`} />
          <div className={`${LINE} w-full`} />
          <div className={`${LINE} w-3/4`} />
          <div className={`${LINE} w-full`} />
        </div>
      </div>
    </main>
  );
}
