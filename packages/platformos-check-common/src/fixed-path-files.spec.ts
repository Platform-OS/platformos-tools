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
    'app/translations/en.yml': 'en:\n  hello: Hello\n',
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
    const configUris = ['file:/app/config.yml', 'file:/app/user.yml'];

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
    const yamlChecks = allChecks.filter((def) => def.meta.type === SourceCodeType.YAML);

    expect(yamlChecks.map((def) => def.meta.code).sort()).toEqual([
      'MatchingTranslations',
      'ValidHTMLTranslation',
    ]);
  });
});
