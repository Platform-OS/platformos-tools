import { describe, it, expect } from 'vitest';
import {
  PlatformOSFileType,
  getFileType,
  getAppPaths,
  getModulePaths,
  isKnownLiquidFile,
  isKnownGraphQLFile,
  isSupportedSourceFile,
  isPartial,
  isPage,
  isLayout,
  isAuthorization,
  isEmail,
  isApiCall,
  isSms,
  isMigration,
  isFormConfiguration,
  parseAppPath,
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
    'app/assets/theme.css.liquid',
    'app/assets/app.js',
    'app/assets/theme.css',
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
   * `.scss.liquid` is the interesting case and it CHANGED: it used to be excluded by
   * a `/\.(s?css|js)\.liquid$/` test, and `scss` is not a platform format, so the
   * platform reads that file as a partial called `foo.scss` rendered as html. Keeping
   * it out would have meant naming it in an ignore list — the thing the whitelist
   * exists to avoid — so it is read now. No file like it exists across the four real
   * projects; `frame` is the only non-format segment they actually use.
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

  it('keeps classification and readability separate for a non-Liquid page', () => {
    // The page IS deployed — dropping it from the type would be wrong. It is only the
    // linter that cannot open it.
    expect(getFileType(uri('app/views/pages/home.html'), ROOT)).toBe(PlatformOSFileType.Page);
    expect(isSupportedSourceFile(uri('app/views/pages/home.html'), ROOT)).toBe(false);
  });
});

// ─── isKnownLiquidFile ────────────────────────────────────────────────────────

describe('isKnownLiquidFile', () => {
  it('returns true for all Liquid file types', () => {
    expect(isKnownLiquidFile(uri('app/views/pages/home.liquid'), ROOT)).toBe(true);
    expect(isKnownLiquidFile(uri('app/views/layouts/default.liquid'), ROOT)).toBe(true);
    expect(isKnownLiquidFile(uri('app/views/partials/header.liquid'), ROOT)).toBe(true);
    expect(isKnownLiquidFile(uri('app/lib/utils.liquid'), ROOT)).toBe(true);
    expect(isKnownLiquidFile(uri('app/authorization_policies/can_edit.liquid'), ROOT)).toBe(true);
    expect(isKnownLiquidFile(uri('app/emails/welcome.liquid'), ROOT)).toBe(true);
    expect(isKnownLiquidFile(uri('app/api_calls/create.liquid'), ROOT)).toBe(true);
    expect(isKnownLiquidFile(uri('app/smses/notify.liquid'), ROOT)).toBe(true);
    expect(isKnownLiquidFile(uri('app/migrations/001_init.liquid'), ROOT)).toBe(true);
    expect(isKnownLiquidFile(uri('app/form_configurations/create.liquid'), ROOT)).toBe(true);
    expect(isKnownLiquidFile(uri('app/forms/create.liquid'), ROOT)).toBe(true);
  });

  it('returns true for marketplace_builder Liquid files', () => {
    expect(isKnownLiquidFile(uri('marketplace_builder/views/pages/home.liquid'), ROOT)).toBe(true);
    expect(isKnownLiquidFile(uri('marketplace_builder/views/partials/header.liquid'), ROOT)).toBe(
      true,
    );
  });

  it('returns true for module Liquid files', () => {
    expect(isKnownLiquidFile(uri('modules/core/public/views/pages/home.liquid'), ROOT)).toBe(true);
    expect(isKnownLiquidFile(uri('modules/core/public/lib/utils.liquid'), ROOT)).toBe(true);
    expect(
      isKnownLiquidFile(uri('modules/core/public/form_configurations/create.liquid'), ROOT),
    ).toBe(true);
  });

  it('returns false for GraphQL files', () => {
    expect(isKnownLiquidFile(uri('app/graphql/query.graphql'), ROOT)).toBe(false);
  });

  it('returns false for YAML files', () => {
    expect(isKnownLiquidFile(uri('app/custom_model_types/property.yml'), ROOT)).toBe(false);
    expect(isKnownLiquidFile(uri('app/translations/en.yml'), ROOT)).toBe(false);
  });

  it('returns false for asset files', () => {
    expect(isKnownLiquidFile(uri('app/assets/app.js'), ROOT)).toBe(false);
  });

  it('returns false for generator templates', () => {
    expect(
      isKnownLiquidFile(
        uri('modules/core/generators/command/templates/lib/commands/create.liquid'),
        ROOT,
      ),
    ).toBe(false);
  });

  it('returns false for unrecognized paths', () => {
    expect(isKnownLiquidFile(uri('app/stupid/file.liquid'), ROOT)).toBe(false);
  });
});

// ─── isKnownGraphQLFile ───────────────────────────────────────────────────────

describe('isKnownGraphQLFile', () => {
  it('returns true for app/graphql and app/graph_queries files', () => {
    expect(isKnownGraphQLFile(uri('app/graphql/users.graphql'), ROOT)).toBe(true);
    expect(isKnownGraphQLFile(uri('app/graph_queries/users.graphql'), ROOT)).toBe(true);
    expect(isKnownGraphQLFile(uri('app/graphql/nested/create_user.graphql'), ROOT)).toBe(true);
  });

  it('returns true for marketplace_builder graphql files', () => {
    expect(isKnownGraphQLFile(uri('marketplace_builder/graphql/query.graphql'), ROOT)).toBe(true);
  });

  it('returns true for module graphql files', () => {
    expect(isKnownGraphQLFile(uri('modules/core/public/graphql/query.graphql'), ROOT)).toBe(true);
    expect(isKnownGraphQLFile(uri('modules/core/private/graphql/mutation.graphql'), ROOT)).toBe(
      true,
    );
    expect(isKnownGraphQLFile(uri('modules/core/public/graph_queries/query.graphql'), ROOT)).toBe(
      true,
    );
  });

  it('returns false for generator templates', () => {
    expect(
      isKnownGraphQLFile(
        uri('modules/core/generators/crud/templates/graphql/create.graphql'),
        ROOT,
      ),
    ).toBe(false);
  });

  it('returns false for schema files at the project root', () => {
    expect(isKnownGraphQLFile(uri('schema.graphql'), ROOT)).toBe(false);
    expect(isKnownGraphQLFile(uri('app/schema.graphql'), ROOT)).toBe(false);
  });

  it('returns false for liquid files', () => {
    expect(isKnownGraphQLFile(uri('app/views/pages/home.liquid'), ROOT)).toBe(false);
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

  describe('isLayout', () => {
    it('returns true for app/views/layouts', () => {
      expect(isLayout(uri('app/views/layouts/default.liquid'), ROOT)).toBe(true);
    });

    it('returns true for marketplace_builder/views/layouts', () => {
      expect(isLayout(uri('marketplace_builder/views/layouts/default.liquid'), ROOT)).toBe(true);
    });

    it('returns true for module layouts', () => {
      expect(isLayout(uri('modules/core/public/views/layouts/default.liquid'), ROOT)).toBe(true);
    });

    it('returns false for pages', () => {
      expect(isLayout(uri('app/views/pages/home.liquid'), ROOT)).toBe(false);
    });
  });

  it('isAuthorization', () => {
    expect(isAuthorization(uri('app/authorization_policies/can_edit.liquid'), ROOT)).toBe(true);
    expect(isAuthorization(uri('app/lib/can_edit.liquid'), ROOT)).toBe(false);
  });

  it('isEmail', () => {
    expect(isEmail(uri('app/emails/welcome.liquid'), ROOT)).toBe(true);
    expect(isEmail(uri('app/notifications/email_notifications/welcome.liquid'), ROOT)).toBe(true);
    expect(isEmail(uri('app/lib/emails/welcome.liquid'), ROOT)).toBe(false);
  });

  it('isApiCall', () => {
    expect(isApiCall(uri('app/api_calls/create.liquid'), ROOT)).toBe(true);
    expect(isApiCall(uri('app/notifications/api_call_notifications/create.liquid'), ROOT)).toBe(
      true,
    );
    expect(isApiCall(uri('app/lib/api_calls/create.liquid'), ROOT)).toBe(false);
  });

  it('isSms', () => {
    expect(isSms(uri('app/smses/notify.liquid'), ROOT)).toBe(true);
    expect(isSms(uri('app/notifications/sms_notifications/notify.liquid'), ROOT)).toBe(true);
    expect(isSms(uri('app/lib/smses/notify.liquid'), ROOT)).toBe(false);
    expect(isSms(uri('modules/core/public/smses/notify.liquid'), ROOT)).toBe(true);
    expect(isSms(uri('modules/core/public/lib/smses/notify.liquid'), ROOT)).toBe(false);
  });

  it('isMigration', () => {
    expect(isMigration(uri('app/migrations/001_init.liquid'), ROOT)).toBe(true);
    expect(isMigration(uri('app/lib/migrations/001_init.liquid'), ROOT)).toBe(false);
  });

  it('isFormConfiguration', () => {
    expect(isFormConfiguration(uri('app/form_configurations/create_user.liquid'), ROOT)).toBe(true);
    expect(isFormConfiguration(uri('app/forms/create_user.liquid'), ROOT)).toBe(true);
    expect(
      isFormConfiguration(uri('modules/core/public/form_configurations/create.liquid'), ROOT),
    ).toBe(true);
    expect(
      isFormConfiguration(uri('marketplace_builder/form_configurations/create.liquid'), ROOT),
    ).toBe(true);
    expect(isFormConfiguration(uri('app/lib/create_user.liquid'), ROOT)).toBe(false);
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
