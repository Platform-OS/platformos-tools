import { describe, expect, it } from 'vitest';

import { isObjectInScope, ObjectAccess } from './object-scope';
import { PlatformOSFileType } from './path-utils';

/**
 * The real `access` shapes from the platformOS Liquid docset. All four are `global: true`,
 * and only `context` is in scope inside a partial — which is the whole point of the rule.
 */
const CONTEXT: ObjectAccess = {
  global: true,
  parents: [],
  template: [],
  app_file_type: null,
};
const DATA: ObjectAccess = {
  global: true,
  parents: [],
  template: [],
  app_file_type: 'api_call',
};
const FORLOOP: ObjectAccess = {
  global: true,
  parents: [{ object: 'forloop', property: 'parentloop' }],
  template: [],
};
/** `params` and friends: reached as `context.params`, never bare. */
const NOT_GLOBAL: ObjectAccess = { global: false, parents: [], template: [] };

describe('isObjectInScope', () => {
  it('treats a global object with no file-type restriction as in scope anywhere', () => {
    expect(isObjectInScope(CONTEXT, PlatformOSFileType.Partial)).toBe(true);
    expect(isObjectInScope(CONTEXT, PlatformOSFileType.ApiCall)).toBe(true);
    expect(isObjectInScope(CONTEXT, undefined)).toBe(true);
  });

  it('confines an app_file_type object to that file type', () => {
    expect(isObjectInScope(DATA, PlatformOSFileType.ApiCall)).toBe(true);
    expect(isObjectInScope(DATA, PlatformOSFileType.Partial)).toBe(false);
    expect(isObjectInScope(DATA, PlatformOSFileType.Page)).toBe(false);
    expect(isObjectInScope(DATA, PlatformOSFileType.Layout)).toBe(false);
  });

  it('does not put an app_file_type object in scope for an unclassified file', () => {
    expect(isObjectInScope(DATA, undefined)).toBe(false);
  });

  it('never treats a parented object as a file-level global', () => {
    expect(isObjectInScope(FORLOOP, PlatformOSFileType.Partial)).toBe(false);
    expect(isObjectInScope(FORLOOP, PlatformOSFileType.Page)).toBe(false);
  });

  it('treats a non-global object as out of scope, since it is reached through its parent', () => {
    expect(isObjectInScope(NOT_GLOBAL, PlatformOSFileType.Partial)).toBe(false);
  });

  it('treats a missing access block as in scope, since the docset says nothing', () => {
    expect(isObjectInScope(undefined, PlatformOSFileType.Partial)).toBe(true);
  });

  it('stays permissive for an app_file_type it has never heard of', () => {
    // A docset naming a file type this version does not know is not evidence about scope,
    // and must not become a false positive.
    const unknown: ObjectAccess = {
      global: true,
      parents: [],
      template: [],
      app_file_type: 'some_future_file_type',
    };

    expect(isObjectInScope(unknown, PlatformOSFileType.Partial)).toBe(true);
  });

  it('honours Shopify-era template scoping, which platformOS leaves empty', () => {
    const templateScoped: ObjectAccess = {
      global: false,
      parents: [],
      template: ['product'],
    };

    expect(isObjectInScope(templateScoped, PlatformOSFileType.Partial)).toBe(true);
  });
});
