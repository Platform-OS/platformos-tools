import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AugmentedPlatformOSDocset } from '../AugmentedPlatformOSDocset';
import {
  FilterEntry,
  LiquidDocVocabulary,
  ObjectEntry,
  PlatformOSDocset,
  TagEntry,
} from '../types';

/**
 * The shipped `data/*.json` — the documentation a user's editor answers from.
 *
 * Tests read these rather than a hand-written docset, so a spec fails when this repository and the
 * published documentation stop fitting together. Derive expectations from the files; never restate them.
 *
 * Read at runtime rather than imported: other packages consume `dist/test`, so this module is compiled,
 * and a JSON import would pull a dependent package's files into this project's build. `src/test` and
 * `dist/test` are the same depth below the package root, so one path serves both.
 */
const dataDir = join(__dirname, '..', '..', '..', 'platformos-check-docs-updater', 'data');

function publishedDocument<T>(name: string): T {
  const path = join(dataDir, name);
  const document = JSON.parse(readFileSync(path, 'utf8'));

  // An empty document would make every test that reads it pass while asserting nothing.
  if (Array.isArray(document) ? document.length === 0 : Object.keys(document).length === 0) {
    throw new Error(`${path} is empty — the shipped docset cannot drive a test`);
  }

  return document as T;
}

const published = {
  async filters(): Promise<FilterEntry[]> {
    return publishedDocument<FilterEntry[]>('filters.json');
  },
  async objects(): Promise<ObjectEntry[]> {
    return publishedDocument<ObjectEntry[]>('objects.json');
  },
  async liquidDrops(): Promise<ObjectEntry[]> {
    return publishedDocument<ObjectEntry[]>('objects.json');
  },
  async tags(): Promise<TagEntry[]> {
    return publishedDocument<TagEntry[]>('tags.json');
  },
  async liquidDoc(): Promise<LiquidDocVocabulary> {
    return publishedDocument<LiquidDocVocabulary>('liquid_doc.json');
  },
  /**
   * No schema, deliberately. `filters.json` / `objects.json` / `tags.json` / `liquid_doc.json` describe
   * the PLATFORM and are the same for everyone; a GraphQL schema describes ONE instance's tables, and the
   * copy in `data/` is whichever instance last published. A spec that needs a schema declares the minimal
   * one whose shape it exercises (`RECORDS_SDL`) — that is a shape, not a claim about anyone's data model.
   */
  async graphQL(): Promise<string | null> {
    return null;
  },
};

/** The shipped docset, augmented as a run augments it: aliases expanded, globals filtered out. */
export const publishedDocset: PlatformOSDocset = new AugmentedPlatformOSDocset(published);

/** The published `{% doc %}` vocabulary, for a test that derives an expectation from it. */
export const publishedLiquidDoc = publishedDocument<LiquidDocVocabulary>('liquid_doc.json');

/**
 * The shipped documents with the `{% doc %}` vocabulary absent — the docset every machine has until the
 * documentation site serves it. The features that read it go quiet rather than invent a list.
 */
export const docsetWithoutLiquidDoc: PlatformOSDocset = new AugmentedPlatformOSDocset({
  ...published,
  async liquidDoc(): Promise<LiquidDocVocabulary> {
    return { annotations: [], param_types: [] };
  },
});
