import { afterEach, assert, beforeEach, describe, expect, it } from 'vitest';
import normalize from 'normalize-path';
import { Config, SourceCodeType, getApp, getAppFilesPathPattern } from './index';
import { Workspace, makeTempWorkspace } from './test/test-helpers';
import { pathToFileURL } from 'node:url';

describe('Unit: getApp', () => {
  let workspace: Workspace;

  beforeEach(async () => {
    workspace = await makeTempWorkspace({
      locales: {
        'en.default.json': '{}',
      },
      app: {
        views: {
          partials: {
            'header.liquid': '',
          },
        },
      },
    });
  });

  afterEach(async () => {
    await workspace.clean();
  });

  it('should correctly get app on all platforms', async () => {
    const config: Config = {
      checks: [],
      rootUri: workspace.rootUri,
      settings: {},
    };

    const app = await getApp(config);
    const jsonFile = app.find((sc) => sc.type === SourceCodeType.JSON);
    assert(jsonFile);

    // internally we expect the path to be normalized
    // Use .replace() instead of normalize-path here because this is a URI (file:///...),
    // not a filesystem path — normalize-path would collapse the triple slash.
    expect(jsonFile.uri).to.equal(workspace.uri('locales/en.default.json').replace(/\\/g, '/'));
  });
});

describe('Unit: getAppFilesPathPattern', () => {
  // This is mostly just to catch edge cases in Windows paths. We want
  // to ensure that paths do not start with a leading slash on Windows.
  it('should correctly format the glob pattern', () => {
    const rootUri = pathToFileURL(__dirname);
    const normalizedGlob = getAppFilesPathPattern(rootUri.toString());

    expect(normalizedGlob).to.equal(normalize(__dirname) + '/**/*.{liquid,json,graphql,yml,yaml}');
  });
});
