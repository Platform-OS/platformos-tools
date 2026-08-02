import { describe, expect, it } from 'vitest';
import {
  APP_SOURCE_SUBTREES,
  FILE_TYPE_DIRS,
  FILE_TYPE_FILES,
  getReferenceExtensions,
  MODULE_ROOTS,
  parseAppPath,
  PlatformOSFileType,
} from './path-utils';

/**
 * `APP_SOURCE_SUBTREES` is what lets a project walk skip most of a repository, so
 * the property that matters is total coverage in BOTH directions:
 *
 * - nothing `parseAppPath` accepts may fall outside the subtrees, or the walk would
 *   silently lose app files (the failure mode a directory-name blacklist has:
 *   `app/views/pages/vendor/**` is real, and every `vendor` blacklist drops it);
 * - nothing outside them may be accepted, or the subtrees would be a lie and a
 *   consumer that trusted them would disagree with one that did not.
 *
 * Derived from the same constants `parseAppPath` derives its patterns from, so a new
 * root or access level cannot reach one and not the other.
 */
describe('APP_SOURCE_SUBTREES covers exactly what parseAppPath accepts', () => {
  const asRegExp = (subtree: string) => new RegExp(`^${subtree.split('*').join('[^/]+')}/`);

  const covered = (path: string) =>
    APP_SOURCE_SUBTREES.some((subtree) => asRegExp(subtree).test(path));

  /** Every path shape the directory structure allows, one per (type, dir, root). */
  function everyAppPath(): string[] {
    const paths: string[] = [];

    for (const [fileType, dirs] of Object.entries(FILE_TYPE_DIRS) as [
      PlatformOSFileType,
      readonly string[],
    ][]) {
      // Classification anchors the extension for every type but Page/Layout/Partial/
      // Asset, so a hardcoded `thing.liquid` would generate paths this test then
      // reports as uncovered — a broken generator, not a coverage gap.
      const [extension = '.css'] = getReferenceExtensions(fileType);

      for (const dir of dirs) {
        paths.push(`app/${dir}/thing${extension}`);
        paths.push(`marketplace_builder/${dir}/thing${extension}`);
        for (const root of MODULE_ROOTS) {
          for (const access of ['public', 'private']) {
            paths.push(`${root}/mymod/${access}/${dir}/thing${extension}`);
          }
        }
      }
    }

    for (const fileName of Object.values(FILE_TYPE_FILES)) {
      paths.push(`app/${fileName}`);
      paths.push(`marketplace_builder/${fileName}`);
    }

    return paths;
  }

  it('is the grammar, stated as a prefix', () => {
    expect([...APP_SOURCE_SUBTREES]).toEqual([
      'app',
      'marketplace_builder',
      'modules/*/public',
      'modules/*/private',
    ]);
  });

  it('contains every path parseAppPath accepts', () => {
    const accepted = everyAppPath().filter((path) => parseAppPath(path) !== undefined);
    const missed = accepted.filter((path) => !covered(path));

    // Sanity: the generator produces real paths, so an empty `missed` means coverage
    // rather than an empty input.
    expect(accepted.length).toBe(everyAppPath().length);
    expect(missed).toEqual([]);
  });

  it('rejects the same paths parseAppPath does, wherever the app directories appear', () => {
    // Each of these spells a real app directory, and each is outside every subtree.
    // `tmp/app/views/partials/x.liquid` is not a partial: from the ROOT it is under
    // `tmp`. That is the whole rule, and it needs no list of bad directory names.
    const outside = [
      'tmp/app/views/partials/partial.liquid',
      'node_modules/some-package/app/views/partials/header.liquid',
      'vendor/marketplace_builder/views/pages/index.liquid',
      'dist/modules/core/public/views/layouts/application.liquid',
      'modules/core/react-app/node_modules/pkg/app/graphql/query.graphql',
      'modules/core/views/partials/no-access-level.liquid',
    ];

    expect(outside.filter(covered)).toEqual([]);
    expect(outside.filter((path) => parseAppPath(path) !== undefined)).toEqual([]);
  });

  it('accepts a page whose own directory is named like build output', () => {
    // The corpus that motivated this: `htevent/app/views/pages/vendor/**` is a live
    // site section, `Accala-MP/app/lib/commands/.../build/*.liquid` are commands.
    const real = [
      'app/views/pages/vendor/dashboard.liquid',
      'app/lib/commands/v2/projects/update/build/1.liquid',
      'modules/user/public/graphql/tmp/draft.graphql',
    ];

    expect(real.filter((path) => !covered(path))).toEqual([]);
    expect(real.map((path) => parseAppPath(path)?.fileType)).toEqual([
      PlatformOSFileType.Page,
      PlatformOSFileType.Partial,
      PlatformOSFileType.GraphQL,
    ]);
  });
});
