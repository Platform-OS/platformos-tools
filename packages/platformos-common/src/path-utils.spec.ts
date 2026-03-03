import { describe, it, expect } from 'vitest';
import {
  PlatformOSFileType,
  getFileType,
  getAppPaths,
  getModulePaths,
  isKnownLiquidFile,
  isKnownGraphQLFile,
  isPartial,
  isPage,
  isLayout,
  isAuthorization,
  isEmail,
  isApiCall,
  isSms,
  isMigration,
  isFormConfiguration,
} from './path-utils';

// Helper: build a realistic absolute URI under a project root
const uri = (path: string) => `file:///project/${path}`;

// ─── getFileType ──────────────────────────────────────────────────────────────

describe('getFileType', () => {
  describe('app/ root — Liquid types', () => {
    it('identifies pages (views/pages and pages aliases)', () => {
      expect(getFileType(uri('app/views/pages/home.liquid'))).toBe(PlatformOSFileType.Page);
      expect(getFileType(uri('app/views/pages/nested/item.liquid'))).toBe(PlatformOSFileType.Page);
      expect(getFileType(uri('app/pages/home.liquid'))).toBe(PlatformOSFileType.Page);
    });

    it('identifies layouts', () => {
      expect(getFileType(uri('app/views/layouts/default.liquid'))).toBe(PlatformOSFileType.Layout);
    });

    it('identifies partials (views/partials and lib)', () => {
      expect(getFileType(uri('app/views/partials/header.liquid'))).toBe(PlatformOSFileType.Partial);
      expect(getFileType(uri('app/lib/helpers/format.liquid'))).toBe(PlatformOSFileType.Partial);
      expect(getFileType(uri('app/lib/utils.liquid'))).toBe(PlatformOSFileType.Partial);
    });

    it('identifies authorization_policies', () => {
      expect(getFileType(uri('app/authorization_policies/can_edit.liquid'))).toBe(
        PlatformOSFileType.Authorization,
      );
    });

    it('identifies emails (emails and notifications/email_notifications aliases)', () => {
      expect(getFileType(uri('app/emails/welcome.liquid'))).toBe(PlatformOSFileType.Email);
      expect(getFileType(uri('app/notifications/email_notifications/welcome.liquid'))).toBe(
        PlatformOSFileType.Email,
      );
    });

    it('identifies api_calls (api_calls and notifications/api_call_notifications aliases)', () => {
      expect(getFileType(uri('app/api_calls/create_user.liquid'))).toBe(PlatformOSFileType.ApiCall);
      expect(getFileType(uri('app/notifications/api_call_notifications/create_user.liquid'))).toBe(
        PlatformOSFileType.ApiCall,
      );
    });

    it('identifies smses (smses and notifications/sms_notifications aliases)', () => {
      expect(getFileType(uri('app/smses/notification.liquid'))).toBe(PlatformOSFileType.Sms);
      expect(getFileType(uri('app/notifications/sms_notifications/notification.liquid'))).toBe(
        PlatformOSFileType.Sms,
      );
    });

    it('identifies migrations', () => {
      expect(getFileType(uri('app/migrations/20230101_add_users.liquid'))).toBe(
        PlatformOSFileType.Migration,
      );
    });

    it('identifies form_configurations (form_configurations and forms aliases)', () => {
      expect(getFileType(uri('app/form_configurations/create_user.liquid'))).toBe(
        PlatformOSFileType.FormConfiguration,
      );
      expect(getFileType(uri('app/forms/create_user.liquid'))).toBe(
        PlatformOSFileType.FormConfiguration,
      );
    });
  });

  describe('app/ root — YAML types', () => {
    it('identifies custom_model_types (custom_model_types, model_schemas, schema aliases)', () => {
      expect(getFileType(uri('app/custom_model_types/property.yml'))).toBe(
        PlatformOSFileType.CustomModelType,
      );
      expect(getFileType(uri('app/model_schemas/property.yml'))).toBe(
        PlatformOSFileType.CustomModelType,
      );
      expect(getFileType(uri('app/schema/property.yml'))).toBe(PlatformOSFileType.CustomModelType);
    });

    it('identifies instance_profile_types (instance_profile_types, user_profile_types, user_profile_schemas aliases)', () => {
      expect(getFileType(uri('app/instance_profile_types/default.yml'))).toBe(
        PlatformOSFileType.InstanceProfileType,
      );
      expect(getFileType(uri('app/user_profile_types/default.yml'))).toBe(
        PlatformOSFileType.InstanceProfileType,
      );
      expect(getFileType(uri('app/user_profile_schemas/default.yml'))).toBe(
        PlatformOSFileType.InstanceProfileType,
      );
    });

    it('identifies transactable_types', () => {
      expect(getFileType(uri('app/transactable_types/listing.yml'))).toBe(
        PlatformOSFileType.TransactableType,
      );
    });

    it('identifies translations', () => {
      expect(getFileType(uri('app/translations/en.yml'))).toBe(PlatformOSFileType.Translation);
    });
  });

  describe('app/ root — GraphQL and Asset', () => {
    it('identifies graphql (graphql and graph_queries aliases)', () => {
      expect(getFileType(uri('app/graphql/users.graphql'))).toBe(PlatformOSFileType.GraphQL);
      expect(getFileType(uri('app/graph_queries/users.graphql'))).toBe(PlatformOSFileType.GraphQL);
    });

    it('identifies assets', () => {
      expect(getFileType(uri('app/assets/app.js'))).toBe(PlatformOSFileType.Asset);
      expect(getFileType(uri('app/assets/styles.css'))).toBe(PlatformOSFileType.Asset);
    });
  });

  describe('marketplace_builder/ legacy root', () => {
    it('identifies pages under marketplace_builder', () => {
      expect(getFileType(uri('marketplace_builder/views/pages/home.liquid'))).toBe(
        PlatformOSFileType.Page,
      );
      expect(getFileType(uri('marketplace_builder/pages/home.liquid'))).toBe(
        PlatformOSFileType.Page,
      );
    });

    it('identifies layouts under marketplace_builder', () => {
      expect(getFileType(uri('marketplace_builder/views/layouts/default.liquid'))).toBe(
        PlatformOSFileType.Layout,
      );
    });

    it('identifies partials under marketplace_builder', () => {
      expect(getFileType(uri('marketplace_builder/views/partials/header.liquid'))).toBe(
        PlatformOSFileType.Partial,
      );
      expect(getFileType(uri('marketplace_builder/lib/utils.liquid'))).toBe(
        PlatformOSFileType.Partial,
      );
    });

    it('identifies graphql under marketplace_builder', () => {
      expect(getFileType(uri('marketplace_builder/graphql/query.graphql'))).toBe(
        PlatformOSFileType.GraphQL,
      );
    });

    it('identifies form_configurations under marketplace_builder', () => {
      expect(getFileType(uri('marketplace_builder/form_configurations/create.liquid'))).toBe(
        PlatformOSFileType.FormConfiguration,
      );
    });
  });

  describe('module paths (modules/{name}/public|private/...)', () => {
    it('identifies module pages', () => {
      expect(getFileType(uri('modules/core/public/views/pages/home.liquid'))).toBe(
        PlatformOSFileType.Page,
      );
      expect(getFileType(uri('modules/core/private/views/pages/admin.liquid'))).toBe(
        PlatformOSFileType.Page,
      );
      expect(getFileType(uri('modules/core/public/pages/home.liquid'))).toBe(
        PlatformOSFileType.Page,
      );
    });

    it('identifies module layouts', () => {
      expect(getFileType(uri('modules/core/public/views/layouts/default.liquid'))).toBe(
        PlatformOSFileType.Layout,
      );
    });

    it('identifies module partials (views/partials and lib)', () => {
      expect(getFileType(uri('modules/core/public/views/partials/card.liquid'))).toBe(
        PlatformOSFileType.Partial,
      );
      expect(getFileType(uri('modules/core/public/lib/utils.liquid'))).toBe(
        PlatformOSFileType.Partial,
      );
      expect(getFileType(uri('modules/core/private/lib/internal.liquid'))).toBe(
        PlatformOSFileType.Partial,
      );
    });

    it('identifies module emails', () => {
      expect(getFileType(uri('modules/core/public/emails/welcome.liquid'))).toBe(
        PlatformOSFileType.Email,
      );
      expect(
        getFileType(uri('modules/core/public/notifications/email_notifications/welcome.liquid')),
      ).toBe(PlatformOSFileType.Email);
    });

    it('identifies module smses', () => {
      expect(getFileType(uri('modules/core/public/smses/alert.liquid'))).toBe(
        PlatformOSFileType.Sms,
      );
      expect(
        getFileType(uri('modules/core/public/notifications/sms_notifications/alert.liquid')),
      ).toBe(PlatformOSFileType.Sms);
    });

    it('identifies module api_calls', () => {
      expect(getFileType(uri('modules/core/public/api_calls/fetch.liquid'))).toBe(
        PlatformOSFileType.ApiCall,
      );
    });

    it('identifies module form_configurations', () => {
      expect(getFileType(uri('modules/core/public/form_configurations/create.liquid'))).toBe(
        PlatformOSFileType.FormConfiguration,
      );
      expect(getFileType(uri('modules/core/public/forms/create.liquid'))).toBe(
        PlatformOSFileType.FormConfiguration,
      );
    });

    it('identifies module graphql', () => {
      expect(getFileType(uri('modules/core/public/graphql/query.graphql'))).toBe(
        PlatformOSFileType.GraphQL,
      );
      expect(getFileType(uri('modules/core/public/graph_queries/query.graphql'))).toBe(
        PlatformOSFileType.GraphQL,
      );
    });

    it('identifies module translations', () => {
      expect(getFileType(uri('modules/core/public/translations/en.yml'))).toBe(
        PlatformOSFileType.Translation,
      );
    });
  });

  describe('app/modules nested paths', () => {
    it('identifies nested module partials in lib', () => {
      expect(getFileType(uri('app/modules/core/public/lib/format.liquid'))).toBe(
        PlatformOSFileType.Partial,
      );
    });

    it('identifies nested module layouts', () => {
      expect(getFileType(uri('app/modules/core/public/views/layouts/default.liquid'))).toBe(
        PlatformOSFileType.Layout,
      );
    });

    it('identifies nested module pages', () => {
      expect(getFileType(uri('app/modules/core/public/views/pages/home.liquid'))).toBe(
        PlatformOSFileType.Page,
      );
    });
  });

  describe('false positive prevention — nested paths must not bleed into wrong type', () => {
    it('app/lib/smses/file.liquid is Partial, not Sms', () => {
      expect(getFileType(uri('app/lib/smses/file.liquid'))).toBe(PlatformOSFileType.Partial);
    });

    it('app/lib/emails/file.liquid is Partial, not Email', () => {
      expect(getFileType(uri('app/lib/emails/file.liquid'))).toBe(PlatformOSFileType.Partial);
    });

    it('app/lib/api_calls/file.liquid is Partial, not ApiCall', () => {
      expect(getFileType(uri('app/lib/api_calls/file.liquid'))).toBe(PlatformOSFileType.Partial);
    });

    it('modules/core/public/lib/smses/file.liquid is Partial, not Sms', () => {
      expect(getFileType(uri('modules/core/public/lib/smses/file.liquid'))).toBe(
        PlatformOSFileType.Partial,
      );
    });

    it('modules/core/public/lib/emails/file.liquid is Partial, not Email', () => {
      expect(getFileType(uri('modules/core/public/lib/emails/file.liquid'))).toBe(
        PlatformOSFileType.Partial,
      );
    });
  });

  describe('unknown paths return undefined', () => {
    it('returns undefined for a generator template with /lib/ in path', () => {
      expect(
        getFileType(uri('modules/core/generators/command/templates/lib/commands/create.liquid')),
      ).toBeUndefined();
    });

    it('returns undefined for a graphql generator template', () => {
      expect(
        getFileType(uri('modules/core/generators/crud/templates/graphql/create.graphql')),
      ).toBeUndefined();
    });

    it('returns undefined for app/stupid/file.liquid', () => {
      expect(getFileType(uri('app/stupid/file.liquid'))).toBeUndefined();
    });

    it('returns undefined for a file at project root', () => {
      expect(getFileType(uri('file.liquid'))).toBeUndefined();
    });

    it('returns undefined for a path that only partially matches', () => {
      expect(getFileType(uri('app/views/file.liquid'))).toBeUndefined();
    });
  });
});

// ─── isKnownLiquidFile ────────────────────────────────────────────────────────

describe('isKnownLiquidFile', () => {
  it('returns true for all Liquid file types', () => {
    expect(isKnownLiquidFile(uri('app/views/pages/home.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('app/views/layouts/default.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('app/views/partials/header.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('app/lib/utils.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('app/authorization_policies/can_edit.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('app/emails/welcome.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('app/api_calls/create.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('app/smses/notify.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('app/migrations/001_init.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('app/form_configurations/create.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('app/forms/create.liquid'))).toBe(true);
  });

  it('returns true for marketplace_builder Liquid files', () => {
    expect(isKnownLiquidFile(uri('marketplace_builder/views/pages/home.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('marketplace_builder/views/partials/header.liquid'))).toBe(true);
  });

  it('returns true for module Liquid files', () => {
    expect(isKnownLiquidFile(uri('modules/core/public/views/pages/home.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('modules/core/public/lib/utils.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('modules/core/public/form_configurations/create.liquid'))).toBe(
      true,
    );
  });

  it('returns false for GraphQL files', () => {
    expect(isKnownLiquidFile(uri('app/graphql/query.graphql'))).toBe(false);
  });

  it('returns false for YAML files', () => {
    expect(isKnownLiquidFile(uri('app/custom_model_types/property.yml'))).toBe(false);
    expect(isKnownLiquidFile(uri('app/translations/en.yml'))).toBe(false);
  });

  it('returns false for asset files', () => {
    expect(isKnownLiquidFile(uri('app/assets/app.js'))).toBe(false);
  });

  it('returns false for generator templates', () => {
    expect(
      isKnownLiquidFile(
        uri('modules/core/generators/command/templates/lib/commands/create.liquid'),
      ),
    ).toBe(false);
  });

  it('returns false for unrecognized paths', () => {
    expect(isKnownLiquidFile(uri('app/stupid/file.liquid'))).toBe(false);
  });
});

// ─── isKnownGraphQLFile ───────────────────────────────────────────────────────

describe('isKnownGraphQLFile', () => {
  it('returns true for app/graphql and app/graph_queries files', () => {
    expect(isKnownGraphQLFile(uri('app/graphql/users.graphql'))).toBe(true);
    expect(isKnownGraphQLFile(uri('app/graph_queries/users.graphql'))).toBe(true);
    expect(isKnownGraphQLFile(uri('app/graphql/nested/create_user.graphql'))).toBe(true);
  });

  it('returns true for marketplace_builder graphql files', () => {
    expect(isKnownGraphQLFile(uri('marketplace_builder/graphql/query.graphql'))).toBe(true);
  });

  it('returns true for module graphql files', () => {
    expect(isKnownGraphQLFile(uri('modules/core/public/graphql/query.graphql'))).toBe(true);
    expect(isKnownGraphQLFile(uri('modules/core/private/graphql/mutation.graphql'))).toBe(true);
    expect(isKnownGraphQLFile(uri('modules/core/public/graph_queries/query.graphql'))).toBe(true);
  });

  it('returns false for generator templates', () => {
    expect(
      isKnownGraphQLFile(uri('modules/core/generators/crud/templates/graphql/create.graphql')),
    ).toBe(false);
  });

  it('returns false for schema files at the project root', () => {
    expect(isKnownGraphQLFile(uri('schema.graphql'))).toBe(false);
    expect(isKnownGraphQLFile(uri('app/schema.graphql'))).toBe(false);
  });

  it('returns false for liquid files', () => {
    expect(isKnownGraphQLFile(uri('app/views/pages/home.liquid'))).toBe(false);
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

  it('CustomModelType (3 aliases)', () => {
    expect(getAppPaths(PlatformOSFileType.CustomModelType)).toEqual([
      'app/custom_model_types',
      'app/model_schemas',
      'app/schema',
    ]);
  });

  it('InstanceProfileType (3 aliases)', () => {
    expect(getAppPaths(PlatformOSFileType.InstanceProfileType)).toEqual([
      'app/instance_profile_types',
      'app/user_profile_types',
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
      expect(isPartial(uri('app/views/partials/header.liquid'))).toBe(true);
    });

    it('returns true for app/lib', () => {
      expect(isPartial(uri('app/lib/utils.liquid'))).toBe(true);
    });

    it('returns true for module lib', () => {
      expect(isPartial(uri('modules/core/public/lib/utils.liquid'))).toBe(true);
    });

    it('returns false for pages', () => {
      expect(isPartial(uri('app/views/pages/home.liquid'))).toBe(false);
    });

    it('returns false for generator template with /lib/ in path', () => {
      expect(isPartial(uri('modules/core/generators/command/templates/lib/create.liquid'))).toBe(
        false,
      );
    });
  });

  describe('isPage', () => {
    it('returns true for app/views/pages', () => {
      expect(isPage(uri('app/views/pages/home.liquid'))).toBe(true);
    });

    it('returns true for app/pages (legacy alias)', () => {
      expect(isPage(uri('app/pages/home.liquid'))).toBe(true);
    });

    it('returns true for marketplace_builder/views/pages', () => {
      expect(isPage(uri('marketplace_builder/views/pages/home.liquid'))).toBe(true);
    });

    it('returns false for layouts', () => {
      expect(isPage(uri('app/views/layouts/default.liquid'))).toBe(false);
    });
  });

  describe('isLayout', () => {
    it('returns true for app/views/layouts', () => {
      expect(isLayout(uri('app/views/layouts/default.liquid'))).toBe(true);
    });

    it('returns true for marketplace_builder/views/layouts', () => {
      expect(isLayout(uri('marketplace_builder/views/layouts/default.liquid'))).toBe(true);
    });

    it('returns true for module layouts', () => {
      expect(isLayout(uri('modules/core/public/views/layouts/default.liquid'))).toBe(true);
    });

    it('returns false for pages', () => {
      expect(isLayout(uri('app/views/pages/home.liquid'))).toBe(false);
    });
  });

  it('isAuthorization', () => {
    expect(isAuthorization(uri('app/authorization_policies/can_edit.liquid'))).toBe(true);
    expect(isAuthorization(uri('app/lib/can_edit.liquid'))).toBe(false);
  });

  it('isEmail', () => {
    expect(isEmail(uri('app/emails/welcome.liquid'))).toBe(true);
    expect(isEmail(uri('app/notifications/email_notifications/welcome.liquid'))).toBe(true);
    expect(isEmail(uri('app/lib/emails/welcome.liquid'))).toBe(false);
  });

  it('isApiCall', () => {
    expect(isApiCall(uri('app/api_calls/create.liquid'))).toBe(true);
    expect(isApiCall(uri('app/notifications/api_call_notifications/create.liquid'))).toBe(true);
    expect(isApiCall(uri('app/lib/api_calls/create.liquid'))).toBe(false);
  });

  it('isSms', () => {
    expect(isSms(uri('app/smses/notify.liquid'))).toBe(true);
    expect(isSms(uri('app/notifications/sms_notifications/notify.liquid'))).toBe(true);
    expect(isSms(uri('app/lib/smses/notify.liquid'))).toBe(false);
    expect(isSms(uri('modules/core/public/smses/notify.liquid'))).toBe(true);
    expect(isSms(uri('modules/core/public/lib/smses/notify.liquid'))).toBe(false);
  });

  it('isMigration', () => {
    expect(isMigration(uri('app/migrations/001_init.liquid'))).toBe(true);
    expect(isMigration(uri('app/lib/migrations/001_init.liquid'))).toBe(false);
  });

  it('isFormConfiguration', () => {
    expect(isFormConfiguration(uri('app/form_configurations/create_user.liquid'))).toBe(true);
    expect(isFormConfiguration(uri('app/forms/create_user.liquid'))).toBe(true);
    expect(isFormConfiguration(uri('modules/core/public/form_configurations/create.liquid'))).toBe(
      true,
    );
    expect(isFormConfiguration(uri('marketplace_builder/form_configurations/create.liquid'))).toBe(
      true,
    );
    expect(isFormConfiguration(uri('app/lib/create_user.liquid'))).toBe(false);
  });
});
