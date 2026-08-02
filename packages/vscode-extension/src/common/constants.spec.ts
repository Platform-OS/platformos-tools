import { describe, expect, it, vi } from 'vitest';
import { Minimatch } from 'minimatch';

vi.mock('vscode', () => ({}));

import { documentSelectors } from './constants';

/**
 * These selectors decide which buffers ever reach the language server, so a missing
 * entry is invisible: the feature simply does not happen. There was no `yaml` entry at
 * all until TASK-12.28, which is why no translation file got diagnostics.
 */
describe('documentSelectors', () => {
  it('selects every platformOS source extension, with yaml anchored to the app subtrees', () => {
    expect(documentSelectors).toEqual([
      { language: 'liquid', pattern: '**/*.liquid' },
      {
        language: 'yaml',
        pattern: '**/{app,marketplace_builder,modules}/**/*.yml',
      },
      { language: 'graphql', pattern: '**/*.graphql' },
      { language: 'css', pattern: '**/assets/**/*.css' },
    ]);
  });

  const selects = (path: string) =>
    (documentSelectors as { pattern: string }[]).some((selector) =>
      new Minimatch(selector.pattern).match(path),
    );

  it('selects platformOS yaml sources', () => {
    expect([
      selects('/home/me/site/app/translations/en.yml'),
      selects('/home/me/site/app/translations/en/admin.yml'),
      selects('/home/me/site/modules/core/public/translations/en.yml'),
      selects('/home/me/site/marketplace_builder/user_profile_types/default.yml'),
    ]).toEqual([true, true, true, true]);
  });

  it('does not select .yaml, which the platform does not deploy', () => {
    // Every YAML model in the backend anchors `\.yml\z` (translation.rb:7 and friends),
    // so `en.yaml` is not a translation and handing it to the language server would
    // offer completions and diagnostics for a file that never ships.
    expect([
      selects('/home/me/site/app/translations/en.yaml'),
      selects('/home/me/site/app/schema/car.yaml'),
    ]).toEqual([false, false]);
  });

  it('does not select yaml that has nothing to do with platformOS', () => {
    expect([
      selects('/home/me/site/.github/workflows/ci.yml'),
      selects('/home/me/site/docker-compose.yml'),
      selects('/home/me/site/config/database.yml'),
    ]).toEqual([false, false, false]);
  });

  it('selects liquid and graphql wherever they are', () => {
    expect([
      selects('/home/me/site/app/views/pages/index.liquid'),
      selects('/home/me/site/scratch/draft.liquid'),
      selects('/home/me/site/app/graphql/users/search.graphql'),
    ]).toEqual([true, true, true]);
  });
});
