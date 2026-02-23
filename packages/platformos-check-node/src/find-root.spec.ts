import { findRoot, makeFileExists } from '@platformos/platformos-check-common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NodeFileSystem } from './NodeFileSystem';
import { makeTempWorkspace, Workspace } from './test/test-helpers';

describe('Unit: findRoot', () => {
  const fileExists = makeFileExists(NodeFileSystem);

  describe('with .pos sentinel file', () => {
    let workspace: Workspace;

    beforeAll(async () => {
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

  describe('with .platformos-check.yml config file', () => {
    let workspace: Workspace;

    beforeAll(async () => {
      workspace = await makeTempWorkspace({
        '.platformos-check.yml': '',
        app: {},
      });
    });

    afterAll(async () => {
      await workspace.clean();
    });

    it('finds the root by .platformos-check.yml', async () => {
      const root = await findRoot(workspace.uri('.'), fileExists);
      expect(root).toBe(workspace.uri('.'));
    });
  });

  describe('with only modules/ at root', () => {
    let workspace: Workspace;

    beforeAll(async () => {
      workspace = await makeTempWorkspace({
        modules: {
          'my-module': {
            public: {
              views: {
                pages: {
                  'index.liquid': '',
                },
              },
            },
          },
        },
      });
    });

    afterAll(async () => {
      await workspace.clean();
    });

    it('finds the root by top-level modules/', async () => {
      const root = await findRoot(workspace.uri('modules/my-module/public/views/pages'), fileExists);
      expect(root).toBe(workspace.uri('.'));
    });
  });

  describe('with modules inside app/', () => {
    let workspace: Workspace;

    beforeAll(async () => {
      workspace = await makeTempWorkspace({
        '.pos': '',
        app: {
          modules: {
            'my-module': {
              public: {
                views: {
                  pages: {
                    'index.liquid': '',
                  },
                },
              },
            },
          },
          views: {
            pages: {
              'home.liquid': '',
            },
          },
        },
      });
    });

    afterAll(async () => {
      await workspace.clean();
    });

    it('does not treat app/ as root when it contains modules/', async () => {
      const root = await findRoot(workspace.uri('app/modules/my-module/public/views/pages'), fileExists);
      expect(root).toBe(workspace.uri('.'));
    });

    it('does not treat app/ as root when searching from app/views/', async () => {
      const root = await findRoot(workspace.uri('app/views/pages'), fileExists);
      expect(root).toBe(workspace.uri('.'));
    });
  });
});
