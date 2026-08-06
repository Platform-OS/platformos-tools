import { describe, expect, it } from 'vitest';
import { getFileType, PlatformOSFileType } from '@platformos/platformos-common';
import { allChecks } from './checks';
import { SourceCodeType } from './types';
import { check } from './test';

/**
 * `app/config.yml` and `app/user.yml` are classified now, which means the linter
 * VISITS them for the first time — they are `isKnownYAMLFile`, so check-node's glob
 * collects them and `check()` runs every YAML check against them.
 *
 * That is a live seam: a YAML check written for translations will happily walk a
 * config file unless it says otherwise. Both current YAML checks guard on the file's
 * TYPE rather than on a `/translations/` substring, so they skip these two — and this
 * test is what keeps that true when the next YAML check is added.
 */
describe('the fixed-path config files', () => {
  const app = {
    'app/config.yml': ['theme_search_paths:', '  - theme/dress', 'foo: <b>bar</b>', ''].join('\n'),
    'app/user.yml': ['properties:', '  - name: first_name', '    type: string', ''].join('\n'),
    'app/translations/en.yml': `en:
  hello: Hello
`,
  };

  it('are classified, and are YAML sources the linter loads', () => {
    expect(getFileType('file:///project/app/config.yml', 'file:///project')).toBe(
      PlatformOSFileType.InstanceConfig,
    );
    expect(getFileType('file:///project/app/user.yml', 'file:///project')).toBe(
      PlatformOSFileType.UserSchema,
    );
  });

  it('attract no offenses from any check', async () => {
    // The URIs as `check()` actually reports them. Spelled `file:/app/...` this filter
    // matched NOTHING, so the assertion below passed without looking at anything — the
    // test that follows is what exposed it.
    const configUris = ['file:///app/config.yml', 'file:///app/user.yml'];

    const offenses = await check(app, allChecks);

    expect(
      offenses
        .filter((offense) => configUris.includes(offense.uri))
        .map((offense) => `${offense.check} on ${offense.uri}: ${offense.message}`),
    ).toEqual([]);
  });

  it('has every YAML check guarding on the file type, not on a path substring', () => {
    // A `/translations/` substring test would also have skipped these two by luck.
    // Guarding on the type is what makes it deliberate — and what makes it survive a
    // translations directory alias being added to FILE_TYPE_DIRS.
    //
    // TWO checks are deliberate exceptions, and for the same reason: they ask nothing
    // about the file's type, so there is nothing to guard. `YAMLSyntaxError` reports what
    // the parser could not read; `DuplicateYAMLKey` reports a value the platform
    // discarded. A duplicated key in `app/config.yml` is the same bug it is in a
    // translation file — that claim is measured below rather than asserted here — and the
    // test above pins that a config file YAML reads cleanly still draws nothing.
    const yamlChecks = allChecks.filter((def) => def.meta.type === SourceCodeType.YAML);

    expect(yamlChecks.map((def) => def.meta.code).sort()).toEqual([
      'DuplicateYAMLKey',
      'MatchingTranslations',
      'ValidHTMLTranslation',
      'YAMLSyntaxError',
    ]);
  });

  /**
   * The exception, measured. The enumeration above only records the INTENT that these two
   * checks are type-agnostic; this proves it for the one whose finding is easy to author,
   * on the file type that was classified last and is least likely to have been considered.
   *
   * Also the control for `attract no offenses from any check`: that test's fixtures are
   * clean, so on its own it cannot distinguish "the checks correctly skip a config file"
   * from "nothing looks at config files at all".
   */
  it('reports a duplicated key in a config file, not only in a translation file', async () => {
    const offenses = await check(
      {
        'app/config.yml': `theme_search_paths:
  - theme/dress
foo: one
foo: two
`,
      },
      allChecks,
    );

    expect(offenses.map((offense) => ({ check: offense.check, uri: offense.uri }))).toEqual([
      { check: 'DuplicateYAMLKey', uri: 'file:///app/config.yml' },
    ]);
  });
});
