import type { LoadedRepertoire } from '@mychess/db';
import { describe, expect, it } from 'vitest';
import { graphOf, LONDON } from '../../test/fixtures/repertoires';
import { chapterNamesOf } from './chapter-names';
import {
  repertoireForViewer,
  versionedRepertoireForViewer,
} from './repertoire-for-viewer';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const NOW = new Date('2026-11-26T08:00:00Z');
const GRAPH = graphOf(LONDON);

/** Jonas's London as a read gives it, with the facts no page shows. */
const LOADED: LoadedRepertoire = {
  repertoire: {
    id: ID,
    ownerId: 'jonas',
    side: 'white',
    name: 'Londono sistema',
    version: 4,
    createdAt: NOW,
    updatedAt: NOW,
  },
  graph: GRAPH,
};

describe('repertoireForViewer', () => {
  it('keeps the repertoire’s id, name and side, its graph, its chapter names and the viewer’s notes', () => {
    expect(repertoireForViewer(LOADED, { 'k|d4': 'Mano planas' })).toEqual({
      repertoire: { id: ID, name: 'Londono sistema', side: 'white' },
      graph: GRAPH,
      names: chapterNamesOf(GRAPH),
      notes: { 'k|d4': 'Mano planas' },
    });
  });

  it('gives no owner, no version and no timestamps to the page', () => {
    const view = repertoireForViewer(LOADED, {});
    expect(Object.keys(view.repertoire).sort()).toEqual(['id', 'name', 'side']);
    expect(view.notes).toEqual({});
  });
});

describe('versionedRepertoireForViewer', () => {
  it('is the same view with the version shown', () => {
    expect(versionedRepertoireForViewer(LOADED, {})).toEqual({
      ...repertoireForViewer(LOADED, {}),
      repertoire: {
        id: ID,
        name: 'Londono sistema',
        side: 'white',
        version: 4,
      },
    });
  });
});
