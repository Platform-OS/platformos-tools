import { describe, expect, it } from 'vitest';
import { Severity } from '../types';
import { UnknownFrontmatterField } from '../checks/unknown-frontmatter-field';
import { InvalidFrontmatterValue } from '../checks/invalid-frontmatter-value';
import { MissingLayout } from '../checks/missing-layout';
import { MissingFrontmatterAssociation } from '../checks/missing-frontmatter-association';
import { DeprecatedFrontmatterField } from '../checks/deprecated-frontmatter-field';
import { check } from '../test';

/**
 * WHICH CODE, AT WHICH SEVERITY — the half of the split the inherited family suite cannot
 * prove.
 *
 * `frontmatter-checks.spec.ts` runs all five together and asserts the MESSAGES, so it would
 * pass unchanged if every finding were emitted by the wrong check or at the wrong severity.
 * Those two facts are the whole point of the split: the supervisor's gate reads
 * `severity === 'error' && BLOCKING_CHECKS.has(check)`, so a shape landing under the wrong
 * code silently stops blocking, or starts blocking when it must not.
 *
 * Severity here is calibrated to MEASURED converter behaviour, not to how bad a finding
 * reads: `error` means `pos-cli deploy --dry-run` rejects the file, which fails the whole
 * changeset; `warning` means the file deploys and renders.
 */

const PAGE = 'app/views/pages/test.html.liquid';
const HOME = 'app/views/pages/home.html.liquid';
const LAYOUT = 'app/views/layouts/application.liquid';

const FRONTMATTER_CHECKS = [
  UnknownFrontmatterField,
  InvalidFrontmatterValue,
  MissingLayout,
  MissingFrontmatterAssociation,
  DeprecatedFrontmatterField,
];

/** Every finding as `code @ severity`, which is exactly what the write gate reads. */
const codesOf = async (files: Record<string, string>) =>
  (await check(files, FRONTMATTER_CHECKS)).map(
    (offense) => `${offense.check} @ ${Severity[offense.severity]}`,
  );

describe('each frontmatter shape reports under its own code, at a severity the converter justifies', () => {
  describe('deploy-fatal — reported as errors so the write gate can block', () => {
    it('an unknown key is UnknownFrontmatterField', async () => {
      // Converter: `Unknown properties: bogus_key. Available properties are: …`
      expect(await codesOf({ [PAGE]: '---\nbogus_key: true\n---\n' })).toEqual([
        'UnknownFrontmatterField @ ERROR',
      ]);
    });

    it('a value outside the accepted set is InvalidFrontmatterValue', async () => {
      // Converter: `Request method 'not_a_method' is not allowed. Valid methods: …`
      expect(await codesOf({ [PAGE]: '---\nmethod: not_a_method\n---\n' })).toEqual([
        'InvalidFrontmatterValue @ ERROR',
      ]);
    });

    it('a valid method in the wrong CASE is InvalidFrontmatterValue', async () => {
      // `method: POST` deploys no better than `method: teleport` — measured — but used to
      // reach the write gate as `status: ok`.
      expect(await codesOf({ [PAGE]: '---\nmethod: POST\n---\n' })).toEqual([
        'InvalidFrontmatterValue @ ERROR',
      ]);
    });

    it('`layout: false` is InvalidFrontmatterValue, not a layout lookup', async () => {
      // Converter: `undefined method 'sub' for false`. It is the VALUE that is wrong —
      // no layout named `false` is ever looked up — so MissingLayout must stay quiet.
      expect(await codesOf({ [PAGE]: '---\nlayout: false\n---\n' })).toEqual([
        'InvalidFrontmatterValue @ ERROR',
      ]);
    });

    it('a layout that does not exist is MissingLayout', async () => {
      // Converter: `Layout Could not find Layout with layout: no_such_layout`
      expect(await codesOf({ [PAGE]: '---\nlayout: no_such_layout\n---\n' })).toEqual([
        'MissingLayout @ ERROR',
      ]);
    });
  });

  describe('deploys cleanly — reported as warnings so the write gate lets it through', () => {
    it('a deprecated key is DeprecatedFrontmatterField', async () => {
      // Measured: `layout_name` naming a layout that EXISTS is ACCEPTED by the converter.
      // The layout is supplied so this is the deprecation alone, with no missing-layout
      // finding riding along.
      expect(
        await codesOf({
          [LAYOUT]: '{{ content_for_layout }}',
          [PAGE]: '---\nlayout_name: application\n---\n',
        }),
      ).toEqual(['DeprecatedFrontmatterField @ WARNING']);
    });

    it('the deprecated home filename is DeprecatedFrontmatterField', async () => {
      // Measured: a `home.liquid` page is ACCEPTED. Reported on the FILENAME, so it fires
      // on a file whose frontmatter is otherwise perfectly ordinary.
      expect(await codesOf({ [HOME]: '---\nslug: home\n---\n' })).toEqual([
        'DeprecatedFrontmatterField @ WARNING',
      ]);
    });
  });

  /**
   * Only a REAL deploy reveals this one: `--dry-run` accepts the same file, because it
   * returns before the association write. It was first classified WARNING on that silence.
   */
  it('an association that does not exist is MissingFrontmatterAssociation, at ERROR', async () => {
    expect(
      await codesOf({ [PAGE]: '---\nauthorization_policies:\n  - no_such_policy\n---\n' }),
    ).toEqual(['MissingFrontmatterAssociation @ ERROR']);
  });

  /**
   * The control for the whole file. Splitting one code into five is only safe if the five
   * stay silent together on a file the platform accepts — a split that made every page
   * report something would pass every assertion above.
   */
  it('CONTROL: a well-formed page produces no finding from any of the five', async () => {
    expect(
      await codesOf({
        [LAYOUT]: '{{ content_for_layout }}',
        [PAGE]: '---\nslug: /test\nlayout: application\nmethod: get\n---\n{{ content }}',
      }),
    ).toEqual([]);
  });

  it('reports each shape once when several are wrong in one file', async () => {
    // Two distinct rules on one buffer must produce two distinct codes rather than one
    // code twice — the failure mode the single `ValidFrontmatter` code had by design.
    expect(
      await codesOf({ [PAGE]: '---\nbogus_key: true\nlayout: no_such_layout\n---\n' }),
    ).toEqual(['UnknownFrontmatterField @ ERROR', 'MissingLayout @ ERROR']);
  });
});
