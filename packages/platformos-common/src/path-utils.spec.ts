import { describe, it, expect } from 'vitest';
import {
  APP_SOURCE_SUBTREES,
  ASSET_FILE_OPERATION_GLOB,
  FILE_TYPE_DIRS,
  FILE_TYPE_FILES,
  MODULE_ROOTS,
  PlatformOSFileType,
  getFileType,
  getAppPaths,
  getAppPathsAcrossRoots,
  getModulePaths,
  getReferenceExtensions,
  formatRank,
  getTranslationBase,
  isParsedFileType,
  isSupportedSourceFile,
  isPartial,
  isPage,
  nameToCreationPath,
  nameToPaths,
  parseAppPath,
  pathToName,
  uriToName,
} from './path-utils';

// Helper: build a realistic absolute URI under a project root
const ROOT = 'file:///project';
const uri = (path: string) => `${ROOT}/${path}`;

// ─── getFileType ──────────────────────────────────────────────────────────────

describe('getFileType', () => {
  describe('app/ root — Liquid types', () => {
    it('identifies pages (views/pages and pages aliases)', () => {
      expect(getFileType(uri('app/views/pages/home.liquid'), ROOT)).toBe(PlatformOSFileType.Page);
      expect(getFileType(uri('app/views/pages/nested/item.liquid'), ROOT)).toBe(
        PlatformOSFileType.Page,
      );
      expect(getFileType(uri('app/pages/home.liquid'), ROOT)).toBe(PlatformOSFileType.Page);
    });

    it('identifies layouts', () => {
      expect(getFileType(uri('app/views/layouts/default.liquid'), ROOT)).toBe(
        PlatformOSFileType.Layout,
      );
    });

    it('identifies partials (views/partials and lib)', () => {
      expect(getFileType(uri('app/views/partials/header.liquid'), ROOT)).toBe(
        PlatformOSFileType.Partial,
      );
      expect(getFileType(uri('app/lib/helpers/format.liquid'), ROOT)).toBe(
        PlatformOSFileType.Partial,
      );
      expect(getFileType(uri('app/lib/utils.liquid'), ROOT)).toBe(PlatformOSFileType.Partial);
    });

    it('identifies authorization_policies', () => {
      expect(getFileType(uri('app/authorization_policies/can_edit.liquid'), ROOT)).toBe(
        PlatformOSFileType.Authorization,
      );
    });

    it('identifies emails (emails and notifications/email_notifications aliases)', () => {
      expect(getFileType(uri('app/emails/welcome.liquid'), ROOT)).toBe(PlatformOSFileType.Email);
      expect(getFileType(uri('app/notifications/email_notifications/welcome.liquid'), ROOT)).toBe(
        PlatformOSFileType.Email,
      );
    });

    it('identifies api_calls (api_calls and notifications/api_call_notifications aliases)', () => {
      expect(getFileType(uri('app/api_calls/create_user.liquid'), ROOT)).toBe(
        PlatformOSFileType.ApiCall,
      );
      expect(
        getFileType(uri('app/notifications/api_call_notifications/create_user.liquid'), ROOT),
      ).toBe(PlatformOSFileType.ApiCall);
    });

    it('identifies smses (smses and notifications/sms_notifications aliases)', () => {
      expect(getFileType(uri('app/smses/notification.liquid'), ROOT)).toBe(PlatformOSFileType.Sms);
      expect(
        getFileType(uri('app/notifications/sms_notifications/notification.liquid'), ROOT),
      ).toBe(PlatformOSFileType.Sms);
    });

    it('identifies migrations', () => {
      expect(getFileType(uri('app/migrations/20230101_add_users.liquid'), ROOT)).toBe(
        PlatformOSFileType.Migration,
      );
    });

    it('identifies form_configurations (form_configurations and forms aliases)', () => {
      expect(getFileType(uri('app/form_configurations/create_user.liquid'), ROOT)).toBe(
        PlatformOSFileType.FormConfiguration,
      );
      expect(getFileType(uri('app/forms/create_user.liquid'), ROOT)).toBe(
        PlatformOSFileType.FormConfiguration,
      );
    });
  });

  describe('app/ root — YAML types', () => {
    it('identifies custom_model_types (custom_model_types, model_schemas, schema aliases)', () => {
      expect(getFileType(uri('app/custom_model_types/property.yml'), ROOT)).toBe(
        PlatformOSFileType.Table,
      );
      expect(getFileType(uri('app/model_schemas/property.yml'), ROOT)).toBe(
        PlatformOSFileType.Table,
      );
      expect(getFileType(uri('app/schema/property.yml'), ROOT)).toBe(PlatformOSFileType.Table);
    });

    it('identifies instance_profile_types (instance_profile_types, user_profile_types, user_profile_schemas aliases)', () => {
      expect(getFileType(uri('app/instance_profile_types/default.yml'), ROOT)).toBe(
        PlatformOSFileType.UserProfileType,
      );
      expect(getFileType(uri('app/user_profile_types/default.yml'), ROOT)).toBe(
        PlatformOSFileType.UserProfileType,
      );
      expect(getFileType(uri('app/user_profile_schemas/default.yml'), ROOT)).toBe(
        PlatformOSFileType.UserProfileType,
      );
    });

    it('identifies transactable_types', () => {
      expect(getFileType(uri('app/transactable_types/listing.yml'), ROOT)).toBe(
        PlatformOSFileType.TransactableType,
      );
    });

    it('identifies translations', () => {
      expect(getFileType(uri('app/translations/en.yml'), ROOT)).toBe(
        PlatformOSFileType.Translation,
      );
    });
  });

  describe('app/ root — GraphQL and Asset', () => {
    it('identifies graphql (graphql and graph_queries aliases)', () => {
      expect(getFileType(uri('app/graphql/users.graphql'), ROOT)).toBe(PlatformOSFileType.GraphQL);
      expect(getFileType(uri('app/graph_queries/users.graphql'), ROOT)).toBe(
        PlatformOSFileType.GraphQL,
      );
    });

    it('identifies assets', () => {
      expect(getFileType(uri('app/assets/app.js'), ROOT)).toBe(PlatformOSFileType.Asset);
      expect(getFileType(uri('app/assets/styles.css'), ROOT)).toBe(PlatformOSFileType.Asset);
    });
  });

  describe('marketplace_builder/ legacy root', () => {
    it('identifies pages under marketplace_builder', () => {
      expect(getFileType(uri('marketplace_builder/views/pages/home.liquid'), ROOT)).toBe(
        PlatformOSFileType.Page,
      );
      expect(getFileType(uri('marketplace_builder/pages/home.liquid'), ROOT)).toBe(
        PlatformOSFileType.Page,
      );
    });

    it('identifies layouts under marketplace_builder', () => {
      expect(getFileType(uri('marketplace_builder/views/layouts/default.liquid'), ROOT)).toBe(
        PlatformOSFileType.Layout,
      );
    });

    it('identifies partials under marketplace_builder', () => {
      expect(getFileType(uri('marketplace_builder/views/partials/header.liquid'), ROOT)).toBe(
        PlatformOSFileType.Partial,
      );
      expect(getFileType(uri('marketplace_builder/lib/utils.liquid'), ROOT)).toBe(
        PlatformOSFileType.Partial,
      );
    });

    it('identifies graphql under marketplace_builder', () => {
      expect(getFileType(uri('marketplace_builder/graphql/query.graphql'), ROOT)).toBe(
        PlatformOSFileType.GraphQL,
      );
    });

    it('identifies form_configurations under marketplace_builder', () => {
      expect(getFileType(uri('marketplace_builder/form_configurations/create.liquid'), ROOT)).toBe(
        PlatformOSFileType.FormConfiguration,
      );
    });
  });

  describe('module paths (modules/{name}/public|private/...)', () => {
    it('identifies module pages', () => {
      expect(getFileType(uri('modules/core/public/views/pages/home.liquid'), ROOT)).toBe(
        PlatformOSFileType.Page,
      );
      expect(getFileType(uri('modules/core/private/views/pages/admin.liquid'), ROOT)).toBe(
        PlatformOSFileType.Page,
      );
      expect(getFileType(uri('modules/core/public/pages/home.liquid'), ROOT)).toBe(
        PlatformOSFileType.Page,
      );
    });

    it('identifies module layouts', () => {
      expect(getFileType(uri('modules/core/public/views/layouts/default.liquid'), ROOT)).toBe(
        PlatformOSFileType.Layout,
      );
    });

    it('identifies module partials (views/partials and lib)', () => {
      expect(getFileType(uri('modules/core/public/views/partials/card.liquid'), ROOT)).toBe(
        PlatformOSFileType.Partial,
      );
      expect(getFileType(uri('modules/core/public/lib/utils.liquid'), ROOT)).toBe(
        PlatformOSFileType.Partial,
      );
      expect(getFileType(uri('modules/core/private/lib/internal.liquid'), ROOT)).toBe(
        PlatformOSFileType.Partial,
      );
    });

    it('identifies module emails', () => {
      expect(getFileType(uri('modules/core/public/emails/welcome.liquid'), ROOT)).toBe(
        PlatformOSFileType.Email,
      );
      expect(
        getFileType(
          uri('modules/core/public/notifications/email_notifications/welcome.liquid'),
          ROOT,
        ),
      ).toBe(PlatformOSFileType.Email);
    });

    it('identifies module smses', () => {
      expect(getFileType(uri('modules/core/public/smses/alert.liquid'), ROOT)).toBe(
        PlatformOSFileType.Sms,
      );
      expect(
        getFileType(uri('modules/core/public/notifications/sms_notifications/alert.liquid'), ROOT),
      ).toBe(PlatformOSFileType.Sms);
    });

    it('identifies module api_calls', () => {
      expect(getFileType(uri('modules/core/public/api_calls/fetch.liquid'), ROOT)).toBe(
        PlatformOSFileType.ApiCall,
      );
    });

    it('identifies module form_configurations', () => {
      expect(getFileType(uri('modules/core/public/form_configurations/create.liquid'), ROOT)).toBe(
        PlatformOSFileType.FormConfiguration,
      );
      expect(getFileType(uri('modules/core/public/forms/create.liquid'), ROOT)).toBe(
        PlatformOSFileType.FormConfiguration,
      );
    });

    it('identifies module graphql', () => {
      expect(getFileType(uri('modules/core/public/graphql/query.graphql'), ROOT)).toBe(
        PlatformOSFileType.GraphQL,
      );
      expect(getFileType(uri('modules/core/public/graph_queries/query.graphql'), ROOT)).toBe(
        PlatformOSFileType.GraphQL,
      );
    });

    it('identifies module translations', () => {
      expect(getFileType(uri('modules/core/public/translations/en.yml'), ROOT)).toBe(
        PlatformOSFileType.Translation,
      );
    });
  });

  describe('app/modules nested paths', () => {
    it('identifies nested module partials in lib', () => {
      expect(getFileType(uri('app/modules/core/public/lib/format.liquid'), ROOT)).toBe(
        PlatformOSFileType.Partial,
      );
    });

    it('identifies nested module layouts', () => {
      expect(getFileType(uri('app/modules/core/public/views/layouts/default.liquid'), ROOT)).toBe(
        PlatformOSFileType.Layout,
      );
    });

    it('identifies nested module pages', () => {
      expect(getFileType(uri('app/modules/core/public/views/pages/home.liquid'), ROOT)).toBe(
        PlatformOSFileType.Page,
      );
    });
  });

  describe('false positive prevention — nested paths must not bleed into wrong type', () => {
    it('app/lib/smses/file.liquid is Partial, not Sms', () => {
      expect(getFileType(uri('app/lib/smses/file.liquid'), ROOT)).toBe(PlatformOSFileType.Partial);
    });

    it('app/lib/emails/file.liquid is Partial, not Email', () => {
      expect(getFileType(uri('app/lib/emails/file.liquid'), ROOT)).toBe(PlatformOSFileType.Partial);
    });

    it('app/lib/api_calls/file.liquid is Partial, not ApiCall', () => {
      expect(getFileType(uri('app/lib/api_calls/file.liquid'), ROOT)).toBe(
        PlatformOSFileType.Partial,
      );
    });

    it('modules/core/public/lib/smses/file.liquid is Partial, not Sms', () => {
      expect(getFileType(uri('modules/core/public/lib/smses/file.liquid'), ROOT)).toBe(
        PlatformOSFileType.Partial,
      );
    });

    it('modules/core/public/lib/emails/file.liquid is Partial, not Email', () => {
      expect(getFileType(uri('modules/core/public/lib/emails/file.liquid'), ROOT)).toBe(
        PlatformOSFileType.Partial,
      );
    });
  });

  describe('unknown paths return undefined', () => {
    it('returns undefined for a generator template with /lib/ in path', () => {
      expect(
        getFileType(
          uri('modules/core/generators/command/templates/lib/commands/create.liquid'),
          ROOT,
        ),
      ).toBeUndefined();
    });

    it('returns undefined for a graphql generator template', () => {
      expect(
        getFileType(uri('modules/core/generators/crud/templates/graphql/create.graphql'), ROOT),
      ).toBeUndefined();
    });

    it('returns undefined for app/stupid/file.liquid', () => {
      expect(getFileType(uri('app/stupid/file.liquid'), ROOT)).toBeUndefined();
    });

    it('returns undefined for a file at project root', () => {
      expect(getFileType(uri('file.liquid'), ROOT)).toBeUndefined();
    });

    it('returns undefined for a path that only partially matches', () => {
      expect(getFileType(uri('app/views/file.liquid'), ROOT)).toBeUndefined();
    });
  });

  /**
   * A known directory is not enough. Every backend model but Page, InstanceView and
   * Asset anchors its extension in `PHYSICAL_PATH`, so a file in the right directory
   * with the wrong extension is not deployed and must not be classified.
   *
   * Asserted through BOTH classifiers: `getFileType` matches a directory anywhere in a
   * URI while `parseAppPath` anchors at the project root, and the two deriving their
   * extension rule from one table is the only reason they cannot drift.
   */
  describe('the extension is part of the type, where the backend says so', () => {
    const rejected = [
      // translation.rb:7 — `translations/(.+)\.yml\z`
      'app/translations/en.json',
      'app/translations/en.yaml',
      // graph_query.rb:7 — `(graph_queries|graphql)s?/(.+)\.graphql\z`
      'app/graphql/x.yml',
      'app/graphql/x.txt',
      // transactable_type.rb:7, custom_model_type.rb:12, instance_profile_type.rb:7
      'app/transactable_types/x.yml.bak',
      'app/schema/car.yaml',
      'app/user_profile_types/default.json',
      // authorization_policy.rb:7 and the other five Liquid models
      'app/authorization_policies/x.txt',
      'app/emails/welcome.html',
      'app/migrations/001_init.sql',
      // the module forms of the same
      'modules/core/public/translations/en.yaml',
      'modules/core/private/graphql/q.liquid',
    ];

    it.each(rejected)('%s is not classified by either classifier', (path) => {
      expect(getFileType(uri(path), ROOT)).toBeUndefined();
      expect(parseAppPath(path)).toBeUndefined();
    });

    it('still classifies the same paths with their real extension', () => {
      expect([
        getFileType(uri('app/translations/en.yml'), ROOT),
        getFileType(uri('app/graphql/x.graphql'), ROOT),
        getFileType(uri('app/transactable_types/x.yml'), ROOT),
        getFileType(uri('app/authorization_policies/x.liquid'), ROOT),
        getFileType(uri('modules/core/public/translations/en.yml'), ROOT),
      ]).toEqual([
        PlatformOSFileType.Translation,
        PlatformOSFileType.GraphQL,
        PlatformOSFileType.TransactableType,
        PlatformOSFileType.Authorization,
        PlatformOSFileType.Translation,
      ]);
    });
  });

  /**
   * The four types whose backend `PHYSICAL_PATH` ends in `(.+)` with no extension
   * anchor: `page.rb:7`, `instance_view.rb:9`, `asset.rb:8`. The platform deploys these
   * under any extension, so classification must accept them — whether the LINTER can
   * read one is `isSupportedSourceFile`'s question, asserted separately below.
   */
  describe('Page, Layout, Partial and Asset deploy under any extension', () => {
    it.each([
      ['app/views/pages/home.html', PlatformOSFileType.Page],
      ['app/views/pages/api/users.json.liquid', PlatformOSFileType.Page],
      ['app/views/layouts/1col.html.liquid', PlatformOSFileType.Layout],
      ['app/views/partials/foo.css.liquid', PlatformOSFileType.Partial],
      ['app/lib/helpers.rb', PlatformOSFileType.Partial],
      ['app/assets/app.js', PlatformOSFileType.Asset],
      ['app/assets/images/logo.svg', PlatformOSFileType.Asset],
    ])('%s → %s', (path, expected) => {
      expect(getFileType(uri(path), ROOT)).toBe(expected);
      expect(parseAppPath(path)?.fileType).toBe(expected);
    });
  });

  describe('ActivityStreams handlers', () => {
    it.each([
      ['app/activity_streams/handlers/x.yml', PlatformOSFileType.ActivityStreamsHandler],
      [
        'app/activity_streams/grouping_handlers/x.yml',
        PlatformOSFileType.ActivityStreamsGroupingHandler,
      ],
      [
        'marketplace_builder/activity_streams/handlers/x.yml',
        PlatformOSFileType.ActivityStreamsHandler,
      ],
      [
        'modules/core/public/activity_streams/handlers/x.yml',
        PlatformOSFileType.ActivityStreamsHandler,
      ],
      [
        'modules/core/private/activity_streams/grouping_handlers/nested/x.yml',
        PlatformOSFileType.ActivityStreamsGroupingHandler,
      ],
      [
        'app/modules/core/public/activity_streams/handlers/x.yml',
        PlatformOSFileType.ActivityStreamsHandler,
      ],
    ])('%s → %s', (path, expected) => {
      expect(getFileType(uri(path), ROOT)).toBe(expected);
      expect(parseAppPath(path)?.fileType).toBe(expected);
    });

    it('enforces .yml, like every other YAML type', () => {
      expect(getFileType(uri('app/activity_streams/handlers/x.json'), ROOT)).toBeUndefined();
      expect(getFileType(uri('app/activity_streams/handlers/x.yaml'), ROOT)).toBeUndefined();
    });
  });
});

// ─── isSupportedSourceFile ────────────────────────────────────────────────────

/**
 * "Can the toolchain read this", which is not "does the platform deploy this". The two
 * questions only differ for the extension-agnostic types and for assets, and those
 * differences are the whole content of this describe.
 */
describe('isSupportedSourceFile', () => {
  it.each([
    'app/views/pages/home.liquid',
    'app/views/layouts/1col.html.liquid',
    'app/lib/commands/create.liquid',
    'app/graphql/user/find.graphql',
    'app/translations/en.yml',
    'app/translations/pt-BR/validation.yml',
    'app/schema/car.yml',
    'app/activity_streams/handlers/x.yml',
    'app/config.yml',
    'app/user.yml',
    'marketplace_builder/views/pages/home.liquid',
    'modules/core/public/lib/x.liquid',
  ])('reads %s', (path) => {
    expect(isSupportedSourceFile(uri(path), ROOT)).toBe(true);
  });

  it.each([
    // Deployed, classified, and not something a Liquid check can parse.
    'app/views/pages/home.html',
    'app/views/partials/foo.css.liquid',
    'app/views/partials/foo.js.liquid',
    // EVERY asset spelling, including the ones a parser would otherwise accept. An
    // asset is served verbatim, so its contents are never read whatever they look like
    // — see `isParsedFileType`, and the dedicated describe below for why the bare
    // `.liquid` case is the one that matters.
    'app/assets/theme.css.liquid',
    'app/assets/app.js',
    'app/assets/theme.css',
    'app/assets/x.liquid',
    'app/assets/nested/deep/w.liquid',
    'app/assets/page.html.liquid',
    'marketplace_builder/assets/x.liquid',
    'modules/core/public/assets/x.liquid',
    // Not classified at all.
    'app/translations/en.yaml',
    'app/graphql/x.yml',
    'app/stupid/file.liquid',
    'package.json',
    '.github/workflows/ci.yml',
    'seed/post_import/data.yml',
  ])('does not read %s', (path) => {
    expect(isSupportedSourceFile(uri(path), ROOT)).toBe(false);
  });

  /**
   * The response format decides the body language, and the platform's FORMAT_ENUM
   * (`custom_view.rb:9`) decides what is a format. So `css` and `js` bodies are not
   * read, while a segment the enum does not list is part of the file's NAME.
   *
   * `.scss.liquid` is the interesting case: `scss` is not a platform format, so the
   * platform reads that file as a partial called `foo.scss` rendered as html. Keeping it
   * out would mean naming it in an ignore list — the thing the whitelist exists to avoid
   * — so it is read. No file like it exists across the four real projects measured;
   * `frame` is the only non-format segment they actually use.
   */
  it.each([
    ['app/views/partials/foo.scss.liquid', true],
    ['app/views/partials/modal.frame.liquid', true],
    ['app/views/partials/user.avatar.liquid', true],
    ['app/views/pages/api/users.json.liquid', true],
    ['app/views/pages/report.csv.liquid', true],
    ['app/views/pages/feed.xml.liquid', true],
    ['app/views/partials/theme.css.liquid', false],
    ['app/views/pages/run.js.liquid', false],
  ])('%s → %s, decided by the response format', (path, expected) => {
    expect(isSupportedSourceFile(uri(path), ROOT)).toBe(expected);
  });

  /**
   * THE ASSET RULE, and the regression it closes.
   *
   * A bare `.liquid` has no response format, so `sourceCodeTypeOf` falls back to
   * `html.liquid` — a key that HAS a row — and `app/assets/x.liquid` was read as
   * Liquid+HTML and linted like a page. Measured before the fix: a broken one produced
   * `LiquidHTMLSyntaxError`, and through the MCP supervisor a `must_fix_before_write:
   * true` — a false block on a file the platform serves verbatim.
   *
   * Asserted as the CONJUNCTION rather than as one `false`, because the two halves are
   * what make it a type rule and not an extension rule: the file IS deployed, and a
   * parser for its spelling DOES exist. Only the type says no. A future change that
   * dropped assets from classification entirely would satisfy a bare `toBe(false)` while
   * breaking asset resolution everywhere.
   */
  it('does not read an asset whose extension a parser would otherwise accept', () => {
    const asset = uri('app/assets/x.liquid');

    expect({
      deployed: getFileType(asset, ROOT),
      parsedType: isParsedFileType(PlatformOSFileType.Asset),
      read: isSupportedSourceFile(asset, ROOT),
    }).toEqual({
      deployed: PlatformOSFileType.Asset,
      parsedType: false,
      read: false,
    });
  });

  /**
   * The CONTROL for the rule above. `isParsedFileType` excludes exactly one type, and
   * excluding a second would silently stop linting a whole family — so the set is pinned
   * by enumeration rather than by spot checks.
   *
   * Deliberately derived from the enum, so a NEW `PlatformOSFileType` shows up here
   * automatically and defaults to "read", which is the safe direction: a new type with no
   * check fails the supervisor's file-type-coverage group loudly, whereas a new type
   * silently not read is the regression nothing catches.
   */
  it('reads every file type except Asset', () => {
    const notParsed = Object.values(PlatformOSFileType).filter((type) => !isParsedFileType(type));

    expect(notParsed).toEqual([PlatformOSFileType.Asset]);
  });

  it('keeps classification and readability separate for a non-Liquid page', () => {
    // The page IS deployed — dropping it from the type would be wrong. It is only the
    // linter that cannot open it.
    expect(getFileType(uri('app/views/pages/home.html'), ROOT)).toBe(PlatformOSFileType.Page);
    expect(isSupportedSourceFile(uri('app/views/pages/home.html'), ROOT)).toBe(false);
  });
});

// ─── getAppPaths ──────────────────────────────────────────────────────────────

describe('getAppPaths', () => {
  it('Page (views/pages + pages)', () => {
    expect(getAppPaths(PlatformOSFileType.Page)).toEqual(['app/views/pages', 'app/pages']);
  });

  it('Layout', () => {
    expect(getAppPaths(PlatformOSFileType.Layout)).toEqual(['app/views/layouts']);
  });

  it('Partial (views/partials + lib)', () => {
    expect(getAppPaths(PlatformOSFileType.Partial)).toEqual(['app/views/partials', 'app/lib']);
  });

  it('Email (emails + notifications/email_notifications)', () => {
    expect(getAppPaths(PlatformOSFileType.Email)).toEqual([
      'app/emails',
      'app/notifications/email_notifications',
    ]);
  });

  it('ApiCall (api_calls + notifications/api_call_notifications)', () => {
    expect(getAppPaths(PlatformOSFileType.ApiCall)).toEqual([
      'app/api_calls',
      'app/notifications/api_call_notifications',
    ]);
  });

  it('Sms (smses + notifications/sms_notifications)', () => {
    expect(getAppPaths(PlatformOSFileType.Sms)).toEqual([
      'app/smses',
      'app/notifications/sms_notifications',
    ]);
  });

  it('FormConfiguration (form_configurations + forms)', () => {
    expect(getAppPaths(PlatformOSFileType.FormConfiguration)).toEqual([
      'app/form_configurations',
      'app/forms',
    ]);
  });

  it('Table (3 aliases, current directory first)', () => {
    // Tables live in `schema/`; the other two are legacy spellings. Order matters —
    // the first entry is what `nameToPaths` resolves to first and what
    // `nameToCreationPath` offers as the place to create a new Table.
    expect(getAppPaths(PlatformOSFileType.Table)).toEqual([
      'app/schema',
      'app/custom_model_types',
      'app/model_schemas',
    ]);
  });

  it('UserProfileType (3 aliases, current directory first)', () => {
    expect(getAppPaths(PlatformOSFileType.UserProfileType)).toEqual([
      'app/user_profile_types',
      'app/instance_profile_types',
      'app/user_profile_schemas',
    ]);
  });

  it('TransactableType', () => {
    expect(getAppPaths(PlatformOSFileType.TransactableType)).toEqual(['app/transactable_types']);
  });

  it('Translation', () => {
    expect(getAppPaths(PlatformOSFileType.Translation)).toEqual(['app/translations']);
  });

  it('GraphQL (graphql + graph_queries)', () => {
    expect(getAppPaths(PlatformOSFileType.GraphQL)).toEqual(['app/graphql', 'app/graph_queries']);
  });

  it('Asset', () => {
    expect(getAppPaths(PlatformOSFileType.Asset)).toEqual(['app/assets']);
  });
});

// ─── getAppPathsAcrossRoots ───────────────────────────────────────────────────

describe('getAppPathsAcrossRoots', () => {
  it('covers the legacy marketplace_builder root, canonical root wholly first', () => {
    expect(getAppPathsAcrossRoots(PlatformOSFileType.Translation)).toEqual([
      'app/translations',
      'marketplace_builder/translations',
    ]);
  });

  it('keeps directory-alias order within each root', () => {
    expect(getAppPathsAcrossRoots(PlatformOSFileType.Partial)).toEqual([
      'app/views/partials',
      'app/lib',
      'marketplace_builder/views/partials',
      'marketplace_builder/lib',
    ]);
  });
});

// ─── ASSET_FILE_OPERATION_GLOB ────────────────────────────────────────────────

describe('ASSET_FILE_OPERATION_GLOB', () => {
  it('crosses segments on the file side — a single * silently dropped every nested asset rename', () => {
    expect(ASSET_FILE_OPERATION_GLOB).toBe('**/assets/**');
  });
});

// ─── getModulePaths ───────────────────────────────────────────────────────────

describe('getModulePaths', () => {
  it('returns all 8 module paths for Partial (2 dirs × 4 roots)', () => {
    expect(getModulePaths(PlatformOSFileType.Partial, 'mymodule')).toEqual([
      'app/modules/mymodule/public/views/partials',
      'app/modules/mymodule/private/views/partials',
      'modules/mymodule/public/views/partials',
      'modules/mymodule/private/views/partials',
      'app/modules/mymodule/public/lib',
      'app/modules/mymodule/private/lib',
      'modules/mymodule/public/lib',
      'modules/mymodule/private/lib',
    ]);
  });

  it('returns all 8 module paths for GraphQL (graphql + graph_queries)', () => {
    expect(getModulePaths(PlatformOSFileType.GraphQL, 'mymodule')).toEqual([
      'app/modules/mymodule/public/graphql',
      'app/modules/mymodule/private/graphql',
      'modules/mymodule/public/graphql',
      'modules/mymodule/private/graphql',
      'app/modules/mymodule/public/graph_queries',
      'app/modules/mymodule/private/graph_queries',
      'modules/mymodule/public/graph_queries',
      'modules/mymodule/private/graph_queries',
    ]);
  });

  it('returns all 4 module paths for Page', () => {
    expect(getModulePaths(PlatformOSFileType.Page, 'core')).toEqual([
      'app/modules/core/public/views/pages',
      'app/modules/core/private/views/pages',
      'modules/core/public/views/pages',
      'modules/core/private/views/pages',
      'app/modules/core/public/pages',
      'app/modules/core/private/pages',
      'modules/core/public/pages',
      'modules/core/private/pages',
    ]);
  });
});

// ─── convenience predicates ───────────────────────────────────────────────────

describe('type predicate convenience functions', () => {
  describe('isPartial', () => {
    it('returns true for views/partials', () => {
      expect(isPartial(uri('app/views/partials/header.liquid'), ROOT)).toBe(true);
    });

    it('returns true for app/lib', () => {
      expect(isPartial(uri('app/lib/utils.liquid'), ROOT)).toBe(true);
    });

    it('returns true for module lib', () => {
      expect(isPartial(uri('modules/core/public/lib/utils.liquid'), ROOT)).toBe(true);
    });

    it('returns false for pages', () => {
      expect(isPartial(uri('app/views/pages/home.liquid'), ROOT)).toBe(false);
    });

    it('returns false for generator template with /lib/ in path', () => {
      expect(
        isPartial(uri('modules/core/generators/command/templates/lib/create.liquid'), ROOT),
      ).toBe(false);
    });
  });

  describe('isPage', () => {
    it('returns true for app/views/pages', () => {
      expect(isPage(uri('app/views/pages/home.liquid'), ROOT)).toBe(true);
    });

    it('returns true for app/pages (legacy alias)', () => {
      expect(isPage(uri('app/pages/home.liquid'), ROOT)).toBe(true);
    });

    it('returns true for marketplace_builder/views/pages', () => {
      expect(isPage(uri('marketplace_builder/views/pages/home.liquid'), ROOT)).toBe(true);
    });

    it('returns false for layouts', () => {
      expect(isPage(uri('app/views/layouts/default.liquid'), ROOT)).toBe(false);
    });
  });
});

// ─── parseAppPath ─────────────────────────────────────────────────────────────

describe('parseAppPath', () => {
  it('reports the matched directory, root and remainder for app-level files', () => {
    expect(parseAppPath('app/views/partials/ui/card.liquid')).toEqual({
      fileType: PlatformOSFileType.Partial,
      dir: 'views/partials',
      root: 'app',
      isModuleOverwrite: false,
      rest: 'ui/card.liquid',
      searchPathIndex: 0,
    });
  });

  it('reports the module, its access level and whether it is an app-level overwrite', () => {
    expect(parseAppPath('modules/core/public/lib/commands/create.liquid')).toEqual({
      fileType: PlatformOSFileType.Partial,
      dir: 'lib',
      moduleName: 'core',
      access: 'public',
      isModuleOverwrite: false,
      rest: 'commands/create.liquid',
      searchPathIndex: 6,
    });

    expect(parseAppPath('app/modules/core/private/views/partials/card.liquid')).toEqual({
      fileType: PlatformOSFileType.Partial,
      dir: 'views/partials',
      moduleName: 'core',
      access: 'private',
      isModuleOverwrite: true,
      rest: 'card.liquid',
      searchPathIndex: 1,
    });
  });

  it('gives a marketplace_builder file no search-path position, because nothing searches there', () => {
    expect(parseAppPath('marketplace_builder/views/partials/card.liquid')).toEqual({
      fileType: PlatformOSFileType.Partial,
      dir: 'views/partials',
      root: 'marketplace_builder',
      isModuleOverwrite: false,
      rest: 'card.liquid',
      searchPathIndex: undefined,
    });
  });

  it('anchors the type directory, so app/lib/smses is a Partial and app/smses is an Sms', () => {
    expect(parseAppPath('app/lib/smses/notify.liquid')!.fileType).toBe(PlatformOSFileType.Partial);
    expect(parseAppPath('app/smses/notify.liquid')!.fileType).toBe(PlatformOSFileType.Sms);
  });

  it('returns undefined for paths outside a recognized directory', () => {
    expect(parseAppPath('scripts/helper.liquid')).toBe(undefined);
    expect(parseAppPath('modules/core/generators/templates/lib/create.liquid')).toBe(undefined);
  });

  it('places every file at the index its own candidate search path sits at', () => {
    // This is the whole basis for resolving a name by index instead of by walking
    // candidate directories and stat-ing each one: if these two ever disagree, the
    // index answers a different file than the walk would have.
    const cases: [string, PlatformOSFileType, string | undefined][] = [
      ['app/views/partials/card.liquid', PlatformOSFileType.Partial, undefined],
      ['app/lib/card.liquid', PlatformOSFileType.Partial, undefined],
      ['app/graphql/find.graphql', PlatformOSFileType.GraphQL, undefined],
      ['app/graph_queries/find.graphql', PlatformOSFileType.GraphQL, undefined],
      ['app/modules/core/public/views/partials/card.liquid', PlatformOSFileType.Partial, 'core'],
      ['app/modules/core/private/views/partials/card.liquid', PlatformOSFileType.Partial, 'core'],
      ['modules/core/public/views/partials/card.liquid', PlatformOSFileType.Partial, 'core'],
      ['modules/core/private/views/partials/card.liquid', PlatformOSFileType.Partial, 'core'],
      ['modules/core/private/lib/card.liquid', PlatformOSFileType.Partial, 'core'],
    ];

    for (const [relativePath, fileType, moduleName] of cases) {
      const candidates = moduleName ? getModulePaths(fileType, moduleName) : getAppPaths(fileType);
      const walkIndex = candidates.findIndex((candidate) =>
        relativePath.startsWith(`${candidate}/`),
      );

      expect([relativePath, parseAppPath(relativePath)!.searchPathIndex]).toEqual([
        relativePath,
        walkIndex,
      ]);
    }
  });
});

// ─── getTranslationBase ───────────────────────────────────────────────────────

/**
 * The base is `parseAppPath`'s classification with the part below the type
 * directory cut off — ANCHORED, so a path merely containing `/translations/`
 * gets nothing. The unanchored version handed `seed/post_import/app/translations/`
 * a base of its own, which is the same class of bug `getFileType`'s required
 * `rootUri` exists to prevent.
 */
describe('getTranslationBase', () => {
  it('resolves the app base, single-file and split-file layouts alike', () => {
    expect(getTranslationBase('app/translations/en.yml')).toEqual('app/translations');
    expect(getTranslationBase('app/translations/pt-BR.yml')).toEqual('app/translations');
    expect(getTranslationBase('app/translations/pt-BR/validation.yml')).toEqual('app/translations');
  });

  it('resolves the legacy marketplace_builder base', () => {
    expect(getTranslationBase('marketplace_builder/translations/en.yml')).toEqual(
      'marketplace_builder/translations',
    );
  });

  it('resolves each module spelling to its own base', () => {
    expect(getTranslationBase('modules/community/public/translations/en.yml')).toEqual(
      'modules/community/public/translations',
    );
    expect(getTranslationBase('modules/community/private/translations/en.yml')).toEqual(
      'modules/community/private/translations',
    );
    expect(getTranslationBase('app/modules/community/public/translations/en.yml')).toEqual(
      'app/modules/community/public/translations',
    );
    expect(getTranslationBase('app/modules/community/private/translations/en.yml')).toEqual(
      'app/modules/community/private/translations',
    );
  });

  it('gives a path outside the app no base, wherever /translations/ appears in it', () => {
    expect(getTranslationBase('seed/post_import/app/translations/en.yml')).toEqual(undefined);
    expect(getTranslationBase('tmp/app/translations/en.yml')).toEqual(undefined);
    expect(getTranslationBase('vendor/translations/en.yml')).toEqual(undefined);
  });

  it('gives a non-Translation app file no base, because it does not classify as one', () => {
    expect(getTranslationBase('app/views/partials/translations/card.liquid')).toEqual(undefined);
    expect(getTranslationBase('app/graphql/users/find.graphql')).toEqual(undefined);
    // `.yaml` is not a platformOS extension: every YAML model anchors `\.yml\z`.
    expect(getTranslationBase('app/translations/en.yaml')).toEqual(undefined);
  });
});

// ─── formatRank ───────────────────────────────────────────────────────────────

/**
 * The index's tiebreak between same-name files in one directory must reproduce
 * `nameToPaths`' candidate order: plain spelling first (rank 0), then the format
 * suffixes. The plain-spelling rule holds even when the basename IS a format word
 * — `json.liquid` is a partial named `json`, not a `.json`-format file.
 */
describe('formatRank', () => {
  it('ranks the plain spelling 0, format suffixes by candidate position', () => {
    expect(formatRank(PlatformOSFileType.Partial, 'card.liquid')).toEqual(0);
    expect(formatRank(PlatformOSFileType.Partial, 'card.html.liquid')).toEqual(1);
    expect(formatRank(PlatformOSFileType.Partial, 'card.json.liquid')).toEqual(2);
    expect(formatRank(PlatformOSFileType.Layout, '1col.csv.liquid')).toEqual(5);
  });

  it('ranks a basename that is itself a format word as the plain spelling', () => {
    expect(formatRank(PlatformOSFileType.Partial, 'json.liquid')).toEqual(0);
    expect(formatRank(PlatformOSFileType.Partial, 'css.liquid')).toEqual(0);
    expect(formatRank(PlatformOSFileType.Partial, 'html.liquid')).toEqual(0);
    expect(formatRank(PlatformOSFileType.Partial, 'sub/json.liquid')).toEqual(0);
    expect(formatRank(PlatformOSFileType.Partial, 'json.html.liquid')).toEqual(1);
  });

  it('gives a non-format dot no rank, and non-format-bearing types none at all', () => {
    expect(formatRank(PlatformOSFileType.Partial, 'user.avatar.liquid')).toEqual(0);
    expect(formatRank(PlatformOSFileType.Page, 'api/users.json.liquid')).toEqual(0);
  });
});

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
      const leaves = [`thing${leafExtension(fileType)}`];

      // A response format is not part of a layout's or partial's name, so the
      // format-suffixed spelling must lead back to itself through the SAME name.
      // `csv` rather than `html` on purpose: `html` was always enumerated, and the
      // bug this pins was every OTHER format — `index.csv.liquid` had a name the
      // candidate list could not resolve.
      if (fileType === PlatformOSFileType.Layout || fileType === PlatformOSFileType.Partial) {
        leaves.push(`thing.csv${leafExtension(fileType)}`);
      }

      for (const dir of dirs) {
        for (const leaf of leaves) {
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

  /**
   * The format spellings a layout or partial name enumerates, in resolution
   * order: plain first, then every entry of the platform's FORMAT_ENUM, `html`
   * leading. Spelled out here so the pins below assert nameToPaths' ENTIRE
   * answer rather than sampling it.
   */
  const FORMAT_SPELLINGS = [
    '',
    '.html',
    '.json',
    '.xml',
    '.rss',
    '.csv',
    '.pdf',
    '.css',
    '.text',
    '.js',
    '.txt',
    '.svg',
    '.ics',
  ];

  it('orders module candidates app-overwrite first, public before private', () => {
    // Each search path contributes every format spelling, plain first, because a
    // layout is referenced as `application` whatever format its file carries.
    expect(nameToPaths(PlatformOSFileType.Layout, 'modules/core/application')).toEqual(
      [
        'app/modules/core/public/views/layouts',
        'app/modules/core/private/views/layouts',
        'modules/core/public/views/layouts',
        'modules/core/private/views/layouts',
      ].flatMap((dir) => FORMAT_SPELLINGS.map((format) => `${dir}/application${format}.liquid`)),
    );
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
    expect(nameToPaths(PlatformOSFileType.Partial, 'card')).toEqual(
      ['app/views/partials', 'app/lib'].flatMap((dir) =>
        FORMAT_SPELLINGS.map((format) => `${dir}/card${format}.liquid`),
      ),
    );
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

describe('uriToName', () => {
  it('resolves a nested partial to its full logical name', () => {
    expect(
      uriToName('file:///project/app/views/partials/ui/card.liquid', 'file:///project'),
    ).toEqual({
      fileType: PlatformOSFileType.Partial,
      name: 'ui/card',
      moduleName: undefined,
    });
  });

  it('resolves a module file to its module-prefixed name', () => {
    expect(
      uriToName('file:///project/modules/core/public/lib/create.liquid', 'file:///project'),
    ).toEqual({
      fileType: PlatformOSFileType.Partial,
      name: 'modules/core/create',
      moduleName: 'core',
    });
  });

  it('keeps an asset extension, nested directories included', () => {
    expect(uriToName('file:///project/app/assets/js/app.js', 'file:///project')).toEqual({
      fileType: PlatformOSFileType.Asset,
      name: 'js/app.js',
      moduleName: undefined,
    });
  });

  it('answers undefined for a file outside every platformOS directory', () => {
    expect(uriToName('file:///project/scripts/build.liquid', 'file:///project')).toBe(undefined);
  });

  it('does not care how the root is spelled — trailing slash included', () => {
    expect(uriToName('file:///project/app/views/partials/card.liquid', 'file:///project/')).toEqual(
      {
        fileType: PlatformOSFileType.Partial,
        name: 'card',
        moduleName: undefined,
      },
    );
  });
});

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
    // The corpus that motivated this: `app/views/pages/vendor/**` is a live site
    // section on one real project, `app/lib/commands/.../build/*.liquid` are
    // commands on another.
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
