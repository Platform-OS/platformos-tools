import { describe, expect, it } from 'vitest';

import { Offense } from './types';
import * as path from './path';
import { check } from './test';
import { MockApp } from './test/MockApp';

const rootUri = path.normalize('file:/');
const uri = (relativePath: string) => path.join(rootUri, relativePath);

const PAGE = 'app/views/pages/index.liquid';
const OTHER_PAGE = 'app/views/pages/other.liquid';

/**
 * An app where offenses exist in MORE THAN ONE file, and where the file under
 * test depends on the rest of the project: neither the missing partial nor the
 * missing translation key can be detected from the visited file alone.
 */
const APP: MockApp = {
  [PAGE]: [
    `{% render 'does/not/exist' %}`,
    `{{ 'missing.translation.key' | t }}`,
    `<img src="/a.png">`,
  ].join('\n'),
  [OTHER_PAGE]: `<img src="/b.png">`,
  'app/views/partials/present.liquid': `{{ 'present.key' | t }}`,
  'app/translations/en.yml': `en:\n  present:\n    key: "Present"\n`,
};

/**
 * Offense ORDER is not part of `check()`'s contract — pipelines resolve
 * concurrently — so comparisons here are order-insensitive by construction.
 */
const sorted = (offenses: Offense[]) =>
  [...offenses].sort((a, b) =>
    `${a.uri} ${a.check} ${a.start.index}`.localeCompare(`${b.uri} ${b.check} ${b.start.index}`),
  );

const forFile = (offenses: Offense[], relativePath: string) =>
  offenses.filter((offense) => offense.uri === uri(relativePath));

const checksIn = (offenses: Offense[]) => offenses.map((offense) => offense.check).sort();

const checkOnly = (only: string[]) => check(APP, undefined, {}, {}, { only });

describe('Unit: check() with the `only` option', () => {
  it('returns exactly what the unrestricted run reports for that file, field for field', async () => {
    const everything = await check(APP);

    expect(sorted(await checkOnly([uri(PAGE)]))).toEqual(sorted(forFile(everything, PAGE)));
  });

  it('still detects cross-file problems in the visited file', async () => {
    expect(checksIn(await checkOnly([uri(PAGE)]))).toEqual([
      'ImgWidthAndHeight',
      'MissingPartial',
      'TranslationKeyExists',
      'UnknownFilter',
    ]);
  });

  it('reports nothing for a file it was told not to visit, even though that file does offend', async () => {
    const everything = await check(APP);
    const onlyThePage = await checkOnly([uri(PAGE)]);

    // Guard: the fixture only proves something if the skipped file really offends.
    expect(checksIn(forFile(everything, OTHER_PAGE))).toEqual(['ImgWidthAndHeight']);
    expect(forFile(onlyThePage, OTHER_PAGE)).toEqual([]);
  });

  it('can visit several named files at once', async () => {
    const everything = await check(APP);
    const twoFiles = await checkOnly([uri(PAGE), uri(OTHER_PAGE)]);

    expect(sorted(twoFiles)).toEqual(
      sorted([...forFile(everything, PAGE), ...forFile(everything, OTHER_PAGE)]),
    );
  });

  it('visits nothing when told to visit an empty list of files', async () => {
    // `[]` is taken literally rather than meaning "everything" — a caller that
    // computes the list must decide for itself what an empty result means.
    expect(await checkOnly([])).toEqual([]);
  });

  it('returns no offenses when told to visit a file that is not part of the app', async () => {
    expect(await checkOnly([uri('app/views/pages/ghost.liquid')])).toEqual([]);
  });

  it('attributes every offense to the file it was found in — the invariant `only` relies on', async () => {
    const everything = await check(APP);
    const knownUris = Object.keys(APP).map(uri);

    // No offense may carry a uri outside the app. That every offense belongs to the
    // file that produced it is covered by the per-file equality tests above.
    expect(everything.filter((offense) => !knownUris.includes(offense.uri))).toEqual([]);
  });
});
