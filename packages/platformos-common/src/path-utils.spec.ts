import { describe, it, expect } from 'vitest';
import {
  PlatformOSFileType,
  getFileType,
  getAppPaths,
  getModulePaths,
  isKnownLiquidFile,
  isPartial,
  isPage,
  isLayout,
  isAuthorization,
  isEmail,
  isApiCall,
  isSms,
  isMigration,
} from './path-utils';

// Helper: build a realistic absolute URI
const uri = (path: string) => `file:///project/${path}`;

describe('getFileType', () => {
  describe('app-level paths', () => {
    it('identifies pages', () => {
      expect(getFileType(uri('app/views/pages/home.liquid'))).toBe(PlatformOSFileType.Page);
      expect(getFileType(uri('app/views/pages/nested/category/item.liquid'))).toBe(
        PlatformOSFileType.Page,
      );
    });

    it('identifies layouts', () => {
      expect(getFileType(uri('app/views/layouts/default.liquid'))).toBe(PlatformOSFileType.Layout);
    });

    it('identifies partials in views/partials', () => {
      expect(getFileType(uri('app/views/partials/header.liquid'))).toBe(PlatformOSFileType.Partial);
      expect(getFileType(uri('app/views/partials/nested/card.liquid'))).toBe(
        PlatformOSFileType.Partial,
      );
    });

    it('identifies partials in app/lib', () => {
      expect(getFileType(uri('app/lib/helpers/format.liquid'))).toBe(PlatformOSFileType.Partial);
      expect(getFileType(uri('app/lib/utils.liquid'))).toBe(PlatformOSFileType.Partial);
    });

    it('identifies authorization_policies', () => {
      expect(getFileType(uri('app/authorization_policies/can_edit.liquid'))).toBe(
        PlatformOSFileType.Authorization,
      );
    });

    it('identifies emails', () => {
      expect(getFileType(uri('app/emails/welcome.liquid'))).toBe(PlatformOSFileType.Email);
    });

    it('identifies api_calls', () => {
      expect(getFileType(uri('app/api_calls/create_user.liquid'))).toBe(PlatformOSFileType.ApiCall);
    });

    it('identifies smses', () => {
      expect(getFileType(uri('app/smses/notification.liquid'))).toBe(PlatformOSFileType.Sms);
    });

    it('identifies migrations', () => {
      expect(getFileType(uri('app/migrations/20230101_add_users.liquid'))).toBe(
        PlatformOSFileType.Migration,
      );
    });

    it('identifies graphql', () => {
      expect(getFileType(uri('app/graphql/users.graphql'))).toBe(PlatformOSFileType.GraphQL);
    });

    it('identifies assets', () => {
      expect(getFileType(uri('app/assets/app.js'))).toBe(PlatformOSFileType.Asset);
      expect(getFileType(uri('app/assets/styles.css'))).toBe(PlatformOSFileType.Asset);
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
    });

    it('identifies module layouts', () => {
      expect(getFileType(uri('modules/core/public/views/layouts/default.liquid'))).toBe(
        PlatformOSFileType.Layout,
      );
    });

    it('identifies module partials in views/partials', () => {
      expect(getFileType(uri('modules/core/public/views/partials/card.liquid'))).toBe(
        PlatformOSFileType.Partial,
      );
    });

    it('identifies module partials in lib', () => {
      expect(getFileType(uri('modules/core/public/lib/utils.liquid'))).toBe(
        PlatformOSFileType.Partial,
      );
      expect(getFileType(uri('modules/core/private/lib/internal.liquid'))).toBe(
        PlatformOSFileType.Partial,
      );
    });

    it('identifies module smses', () => {
      expect(getFileType(uri('modules/core/public/smses/alert.liquid'))).toBe(
        PlatformOSFileType.Sms,
      );
    });

    it('identifies module graphql', () => {
      expect(getFileType(uri('modules/core/public/graphql/query.graphql'))).toBe(
        PlatformOSFileType.GraphQL,
      );
    });
  });

  describe('app/modules paths', () => {
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
        getFileType(
          uri('modules/core/generators/command/templates/lib/commands/create.liquid'),
        ),
      ).toBeUndefined();
    });

    it('returns undefined for app/stupid/file.liquid', () => {
      expect(getFileType(uri('app/stupid/file.liquid'))).toBeUndefined();
    });

    it('returns undefined for a file at project root', () => {
      expect(getFileType(uri('file.liquid'))).toBeUndefined();
    });

    it('returns undefined for a path that only partially matches', () => {
      // has 'views' but not 'views/pages' or 'views/layouts' etc.
      expect(getFileType(uri('app/views/file.liquid'))).toBeUndefined();
    });
  });
});

describe('isKnownLiquidFile', () => {
  it('returns true for all liquid file types', () => {
    expect(isKnownLiquidFile(uri('app/views/pages/home.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('app/views/layouts/default.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('app/views/partials/header.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('app/lib/utils.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('app/authorization_policies/can_edit.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('app/emails/welcome.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('app/api_calls/create.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('app/smses/notify.liquid'))).toBe(true);
    expect(isKnownLiquidFile(uri('app/migrations/001_init.liquid'))).toBe(true);
  });

  it('returns false for GraphQL files', () => {
    expect(isKnownLiquidFile(uri('app/graphql/query.graphql'))).toBe(false);
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

describe('getAppPaths', () => {
  it('returns correct paths for Page', () => {
    expect(getAppPaths(PlatformOSFileType.Page)).toEqual(['app/views/pages']);
  });

  it('returns correct paths for Layout', () => {
    expect(getAppPaths(PlatformOSFileType.Layout)).toEqual(['app/views/layouts']);
  });

  it('returns correct paths for Partial (two dirs)', () => {
    expect(getAppPaths(PlatformOSFileType.Partial)).toEqual(['app/views/partials', 'app/lib']);
  });

  it('returns correct paths for GraphQL', () => {
    expect(getAppPaths(PlatformOSFileType.GraphQL)).toEqual(['app/graphql']);
  });

  it('returns correct paths for Asset', () => {
    expect(getAppPaths(PlatformOSFileType.Asset)).toEqual(['app/assets']);
  });
});

describe('getModulePaths', () => {
  it('returns all 8 module paths for Partial', () => {
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

  it('returns all 4 module paths for GraphQL', () => {
    expect(getModulePaths(PlatformOSFileType.GraphQL, 'mymodule')).toEqual([
      'app/modules/mymodule/public/graphql',
      'app/modules/mymodule/private/graphql',
      'modules/mymodule/public/graphql',
      'modules/mymodule/private/graphql',
    ]);
  });

  it('returns all 4 module paths for Page', () => {
    expect(getModulePaths(PlatformOSFileType.Page, 'core')).toEqual([
      'app/modules/core/public/views/pages',
      'app/modules/core/private/views/pages',
      'modules/core/public/views/pages',
      'modules/core/private/views/pages',
    ]);
  });
});

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
      expect(
        isPartial(uri('modules/core/generators/command/templates/lib/create.liquid')),
      ).toBe(false);
    });
  });

  describe('isPage', () => {
    it('returns true for app/views/pages', () => {
      expect(isPage(uri('app/views/pages/home.liquid'))).toBe(true);
    });

    it('returns false for layouts', () => {
      expect(isPage(uri('app/views/layouts/default.liquid'))).toBe(false);
    });
  });

  describe('isLayout', () => {
    it('returns true for app/views/layouts', () => {
      expect(isLayout(uri('app/views/layouts/default.liquid'))).toBe(true);
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
    expect(isEmail(uri('app/lib/emails/welcome.liquid'))).toBe(false);
  });

  it('isApiCall', () => {
    expect(isApiCall(uri('app/api_calls/create.liquid'))).toBe(true);
    expect(isApiCall(uri('app/lib/api_calls/create.liquid'))).toBe(false);
  });

  it('isSms', () => {
    expect(isSms(uri('app/smses/notify.liquid'))).toBe(true);
    expect(isSms(uri('app/lib/smses/notify.liquid'))).toBe(false);
    expect(isSms(uri('modules/core/public/smses/notify.liquid'))).toBe(true);
    expect(isSms(uri('modules/core/public/lib/smses/notify.liquid'))).toBe(false);
  });

  it('isMigration', () => {
    expect(isMigration(uri('app/migrations/001_init.liquid'))).toBe(true);
    expect(isMigration(uri('app/lib/migrations/001_init.liquid'))).toBe(false);
  });
});
