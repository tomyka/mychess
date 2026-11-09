import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from './manifest';

const read = (path: string): Buffer =>
  readFileSync(new URL(path, import.meta.url));

/** A token's light value in tokens.css (`--color-x: light-dark(#light, #dark)`). */
function lightToken(name: string): string {
  const css = read('./tokens.css').toString('utf8');
  const found = new RegExp(
    `--color-${name}: light-dark\\((#[0-9a-f]{6}),`,
    'u',
  ).exec(css);
  if (found?.[1] === undefined) throw new Error(`no token ${name}`);
  return found[1];
}

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(file: Buffer): readonly [number, number] {
  expect(file.subarray(1, 4).toString('ascii')).toBe('PNG');
  return [file.readUInt32BE(16), file.readUInt32BE(20)];
}

describe('the web app manifest (R-7, R-170)', () => {
  const m = manifest();

  it('installs as MyChess, standalone, opening at home', () => {
    expect(m.name).toBe('MyChess');
    expect(m.short_name).toBe('MyChess');
    expect(m.start_url).toBe('/');
    expect(m.scope).toBe('/');
    expect(m.display).toBe('standalone');
    expect(m.prefer_related_applications).not.toBe(true);
  });

  it('takes its colours from the design tokens', () => {
    expect(m.theme_color).toBe(lightToken('accent'));
    expect(m.background_color).toBe(lightToken('bg'));
  });

  it('lists a 192 and a 512 icon and a maskable 512, each a PNG of its size', () => {
    expect(
      m.icons?.map(({ src, sizes, type, purpose }) => ({
        src,
        sizes,
        type,
        purpose,
      })),
    ).toEqual([
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ]);
    for (const icon of m.icons ?? []) {
      const side = Number(icon.sizes?.split('x')[0]);
      expect(pngSize(read(`../../public${icon.src}`))).toEqual([side, side]);
    }
  });

  it('has the apple-touch icon and favicon the app folder serves', () => {
    expect(pngSize(read('./apple-icon.png'))).toEqual([180, 180]);
    expect(read('./icon.svg').toString('utf8')).toContain('<svg');
    // An ICO file starts with reserved 0, type 1 (icon).
    expect([...read('./favicon.ico').subarray(0, 4)]).toEqual([0, 0, 1, 0]);
  });
});
