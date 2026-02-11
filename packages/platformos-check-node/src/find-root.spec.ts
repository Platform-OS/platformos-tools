import { findRoot, makeFileExists } from '@platformos/platformos-check-common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NodeFileSystem } from './NodeFileSystem';
import { makeTempWorkspace, Workspace } from './test/test-helpers';

const theme = {
  assets: {
    'theme.js': '',
    'theme.css': '',
  },
  locales: {
    'en.default.json': JSON.stringify({ beverage: 'coffee' }),
    'fr.json': '{}',
  },
};

describe('Unit: findRoot', () => {
  const fileExists = makeFileExists(NodeFileSystem);
  let workspace: Workspace;

  beforeAll(async () => {
    // We're intentionally not mocking here because we want to make sure
    // this works on Windows as well.
    workspace = await makeTempWorkspace({
      '.pos': '',
      app: {},
      '.git': {},
      modules: {},
    });
  });

  afterAll(async () => {
    await workspace.clean();
  });

  it('finds the root of a pos project', async () => {
    const root = await findRoot(workspace.uri('.'), fileExists);
    expect(root).toBe(workspace.uri('.'));
  });
});
