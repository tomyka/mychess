// A server component may render a 'use client' module's components, and pass
// its values on as props, but it cannot call anything that module exports:
// on the server the import is a client reference, and calling it throws at
// render ("Attempted to call useX() from the server"), so the page shows
// Next's error page. jsdom ignores the directive, so a component test never
// sees it; this walks the imports from every page and layout instead (#381:
// the coach progress page called useOwnCopyTitle from a 'use client' module).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = import.meta.dirname;
const ENTRY = /^(page|layout)\.tsx$/;
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
const IMPORT = /import\s+(?!type\s)([^;]*?)\s+from\s+'(\.[^']+)'/g;

/** Every page and layout under src/app: where server rendering starts. */
function entries(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entries(path);
    return ENTRY.test(entry.name) ? [path] : [];
  });
}

const isClient = (source: string): boolean =>
  /^['"]use client['"]/.test(source.trimStart());

/** The value names an import clause binds, type-only ones left out. */
function boundNames(clause: string): string[] {
  const braces = /\{([^}]*)\}/.exec(clause);
  const named = (braces?.[1] ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '' && !part.startsWith('type '))
    .map((part) => part.split(/\s+as\s+/).at(-1) ?? part);
  const defaultName = /^([A-Za-z_$][\w$]*)/.exec(clause)?.[1];
  return defaultName === undefined ? named : [defaultName, ...named];
}

function resolveImport(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier);
  return EXTENSIONS.map((ext) => base + ext).find(
    (path) => statSync(path, { throwIfNoEntry: false })?.isFile() === true,
  );
}

interface Import {
  readonly target: string;
  readonly names: readonly string[];
}

function importsOf(file: string, source: string): Import[] {
  return [...source.matchAll(IMPORT)].flatMap(([, clause = '', spec = '']) => {
    const target = resolveImport(file, spec);
    return target === undefined ? [] : [{ target, names: boundNames(clause) }];
  });
}

/** Whether the source calls the name (not a method or a longer name). */
function callsName(source: string, name: string): boolean {
  const escaped = name.replace(/\$/g, '\\$');
  return new RegExp(`(?<![\\w$.])${escaped}\\s*\\(`).test(source);
}

/** Each server module's call into a 'use client' module, as "file: name". */
function boundaryCalls(): string[] {
  const queue = entries(APP);
  const seen = new Set(queue);
  const found: string[] = [];
  for (const file of queue) {
    const source = readFileSync(file, 'utf8');
    for (const { target, names } of importsOf(file, source))
      if (isClient(readFileSync(target, 'utf8')))
        found.push(
          ...names
            .filter((name) => callsName(source, name))
            .map((name) => `${relative(APP, file)}: ${name}`),
        );
      else if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
  }
  return found;
}

describe('the server/client boundary', () => {
  it('no page, nor any module it renders on the server, calls a function from a client module', () => {
    expect(boundaryCalls()).toEqual([]);
  });

  it('walks from a page into the components it renders', () => {
    const progress = join(
      APP,
      'coach/players/[playerId]/progress/[repertoireId]/progress-view.tsx',
    );
    const page = join(dirname(progress), 'page.tsx');
    expect(importsOf(page, readFileSync(page, 'utf8'))).toContainEqual({
      target: progress,
      names: ['ProgressView'],
    });
  });

  it('tells a call from a mention', () => {
    expect(callsName('const t = useTitle({ a });', 'useTitle')).toBe(true);
    expect(callsName('<a href={EXPORT_PATH}>', 'EXPORT_PATH')).toBe(false);
    expect(callsName('x.useTitle(1); useTitleOf(2)', 'useTitle')).toBe(false);
  });
});
