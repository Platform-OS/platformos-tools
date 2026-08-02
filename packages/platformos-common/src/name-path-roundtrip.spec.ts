import { describe, expect, it } from 'vitest';
import {
  FILE_TYPE_DIRS,
  getAppPaths,
  getFileType,
  getModulePaths,
  getReferenceExtensions,
  MODULE_ROOTS,
  nameToCreationPath,
  nameToPaths,
  pathToName,
  PlatformOSFileType,
} from './path-utils';

/**
 * `pathToName` and `nameToPaths` are inverses, and this is the test that says so.
 *
 * It is the guarantee the toolchain was missing. `platformos-graph` resolved
 * `{{ 'app.js' | asset_url }}` to a root-level `assets/app.js` while
 * `DocumentsLocator` resolved the same reference to `app/assets/app.js`, and nothing
 * failed — because each had its own copy of the rule and neither was checked against
 * the other direction. With one definition and this property, that bug cannot recur:
 * a name derived from a path must lead back to that path.
 */
describe('pathToName ⇄ nameToPaths round trip', () => {
  /** Every (type, dir, root) combination the directory structure allows. */
  function everyLayout(): { fileType: PlatformOSFileType; path: string }[] {
    const cases: { fileType: PlatformOSFileType; path: string }[] = [];

    // Fixed-path types are absent from FILE_TYPE_DIRS by construction and covered
    // separately below.
    for (const [fileType, dirs] of Object.entries(FILE_TYPE_DIRS) as [
      PlatformOSFileType,
      readonly string[],
    ][]) {
      const leaf = `thing${leafExtension(fileType)}`;

      for (const dir of dirs) {
        cases.push({ fileType, path: `app/${dir}/${leaf}` });
        cases.push({ fileType, path: `app/${dir}/nested/deeply/${leaf}` });

        for (const root of MODULE_ROOTS) {
          for (const access of ['public', 'private'] as const) {
            cases.push({ fileType, path: `${root}/mymod/${access}/${dir}/${leaf}` });
            cases.push({ fileType, path: `${root}/mymod/${access}/${dir}/nested/${leaf}` });
          }
        }
      }
    }

    return cases;
  }

  /**
   * Derived, never switched on: classification anchors the extension for every type
   * but the four in `EXTENSION_AGNOSTIC_TYPES`, so a hand-written switch here would
   * generate unclassifiable paths the moment a type was added — which is exactly what
   * it did for the two ActivityStreams types.
   *
   * `Asset` has no reference extension because an asset reference carries its own;
   * `.css` stands in for one.
   */
  function leafExtension(fileType: PlatformOSFileType): string {
    const [extension = '.css'] = getReferenceExtensions(fileType);
    return extension;
  }

  it('leads every path back to itself through its own name', () => {
    const broken: string[] = [];

    for (const { fileType, path } of everyLayout()) {
      const resolved = pathToName(path);
      if (!resolved) {
        broken.push(`${path}: pathToName returned undefined`);
        continue;
      }
      if (resolved.fileType !== fileType) {
        broken.push(`${path}: classified as ${resolved.fileType}, expected ${fileType}`);
        continue;
      }

      const candidates = nameToPaths(resolved.fileType, resolved.name);
      if (!candidates.includes(path)) {
        broken.push(`${path}: name '${resolved.name}' resolves to ${candidates.join(', ')}`);
      }
    }

    expect(broken).toEqual([]);
  });

  it('puts the canonical location first, so a not-yet-existing file has one answer', () => {
    expect(nameToPaths(PlatformOSFileType.Partial, 'ui/card')[0]).toBe(
      'app/views/partials/ui/card.liquid',
    );
    expect(nameToPaths(PlatformOSFileType.Layout, 'application')[0]).toBe(
      'app/views/layouts/application.liquid',
    );
    expect(nameToPaths(PlatformOSFileType.GraphQL, 'user/find')[0]).toBe(
      'app/graphql/user/find.graphql',
    );
    expect(nameToPaths(PlatformOSFileType.Asset, 'styles/theme.css')[0]).toBe(
      'app/assets/styles/theme.css',
    );
  });

  it('orders module candidates app-overwrite first, public before private', () => {
    // Each search path contributes the plain spelling then the `.html` one, because a
    // layout is referenced as `application` whether the file carries a format or not.
    expect(nameToPaths(PlatformOSFileType.Layout, 'modules/core/application')).toEqual([
      'app/modules/core/public/views/layouts/application.liquid',
      'app/modules/core/public/views/layouts/application.html.liquid',
      'app/modules/core/private/views/layouts/application.liquid',
      'app/modules/core/private/views/layouts/application.html.liquid',
      'modules/core/public/views/layouts/application.liquid',
      'modules/core/public/views/layouts/application.html.liquid',
      'modules/core/private/views/layouts/application.liquid',
      'modules/core/private/views/layouts/application.html.liquid',
    ]);
  });

  it('finds a format-carrying layout or partial under its format-less name', () => {
    // The documented example layout is `views/layouts/1col.html.liquid`, referenced as
    // `1col` — the format is not part of the name.
    expect(pathToName('app/views/layouts/1col.html.liquid')!.name).toBe('1col');
    expect(pathToName('app/views/partials/card.html.liquid')!.name).toBe('card');
    expect(nameToPaths(PlatformOSFileType.Layout, '1col')).toContain(
      'app/views/layouts/1col.html.liquid',
    );

    // Only a KNOWN format is stripped, so a dot that is part of the name survives.
    expect(pathToName('app/views/partials/user.avatar.liquid')!.name).toBe('user.avatar');
  });

  it('offers every directory alias a type has, in FILE_TYPE_DIRS order', () => {
    expect(nameToPaths(PlatformOSFileType.Partial, 'card')).toEqual([
      'app/views/partials/card.liquid',
      'app/views/partials/card.html.liquid',
      'app/lib/card.liquid',
      'app/lib/card.html.liquid',
    ]);
    expect(nameToPaths(PlatformOSFileType.GraphQL, 'find')).toEqual([
      'app/graphql/find.graphql',
      'app/graph_queries/find.graphql',
    ]);
  });

  it('appends nothing to an asset name, which carries its own extension', () => {
    expect(nameToPaths(PlatformOSFileType.Asset, 'theme.css')).toEqual(['app/assets/theme.css']);
    expect(pathToName('app/assets/theme.css')!.name).toBe('theme.css');
  });

  it('keeps a format suffix in the name, since it selects a different file', () => {
    // `api/users.json.liquid` and `api/users.liquid` are different files serving
    // different formats, so the name has to distinguish them.
    expect(pathToName('app/views/pages/api/users.json.liquid')!.name).toBe('api/users.json');
    expect(nameToPaths(PlatformOSFileType.Page, 'api/users.json')).toEqual([
      'app/views/pages/api/users.json.liquid',
      'app/pages/api/users.json.liquid',
    ]);
  });

  it('returns undefined for a path outside every recognized directory', () => {
    expect(pathToName('scripts/helper.liquid')).toBe(undefined);
    expect(pathToName('assets/app.js')).toBe(undefined);
  });

  describe('the two fixed-path files', () => {
    // `config.yml` and `user.yml` are one file per app with no directory segment, and
    // — uniquely — no module form: the server matches them with
    // DIR_PREFIX_WITHOUT_MODULES.
    it('classifies them under either app root, naming them without the extension', () => {
      expect(pathToName('app/config.yml')).toEqual({
        fileType: PlatformOSFileType.InstanceConfig,
        name: 'config',
        moduleName: undefined,
      });
      expect(pathToName('marketplace_builder/user.yml')!.fileType).toBe(
        PlatformOSFileType.UserSchema,
      );
    });

    it('round-trips, like every other type', () => {
      expect(nameToPaths(PlatformOSFileType.InstanceConfig, 'config')).toEqual(['app/config.yml']);
      expect(nameToPaths(PlatformOSFileType.UserSchema, 'user')).toEqual(['app/user.yml']);
    });

    it('answers to its one filename and nothing else', () => {
      // There is exactly one config file per app: no `app/settings.yml`, and no
      // `.yaml` spelling — `app/config.yaml` is an unclassified YAML file.
      expect(nameToPaths(PlatformOSFileType.InstanceConfig, 'settings')).toEqual([]);
      expect(getFileType('file:///project/app/config.yaml', 'file:///project')).toBe(undefined);
    });

    it('has no module form, so a modules/ copy is not one of them', () => {
      expect(pathToName('modules/core/public/config.yml')).toBe(undefined);
      expect(getModulePaths(PlatformOSFileType.InstanceConfig, 'core')).toEqual([]);
      expect(nameToPaths(PlatformOSFileType.InstanceConfig, 'modules/core/config')).toEqual([]);
    });

    it('generates no directory search paths, since there is no directory', () => {
      expect(getAppPaths(PlatformOSFileType.InstanceConfig)).toEqual([]);
      expect(getModulePaths(PlatformOSFileType.InstanceConfig, 'core')).toEqual([]);
    });

    it('still has one place it would be created, since its location is fixed', () => {
      expect(nameToCreationPath(PlatformOSFileType.InstanceConfig, 'config')).toBe(
        'app/config.yml',
      );
      expect(nameToCreationPath(PlatformOSFileType.UserSchema, 'user')).toBe('app/user.yml');
    });

    it('does not claim every file in the project', () => {
      // A type with no directories would compile to the empty pattern, and
      // `new RegExp('')` matches everything.
      expect(getFileType('file:///project/app/views/partials/card.liquid', 'file:///project')).toBe(
        PlatformOSFileType.Partial,
      );
      expect(getFileType('file:///project/app/config.yml', 'file:///project')).toBe(
        PlatformOSFileType.InstanceConfig,
      );
      expect(getFileType('file:///project/README.md', 'file:///project')).toBe(undefined);
    });

    it('keeps a directory type for a config.yml that lives inside a known directory', () => {
      expect(getFileType('file:///project/app/translations/config.yml', 'file:///project')).toBe(
        PlatformOSFileType.Translation,
      );
    });
  });
});
