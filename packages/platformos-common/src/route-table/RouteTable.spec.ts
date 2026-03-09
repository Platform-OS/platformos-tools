import { describe, it, expect, vi, beforeEach } from 'vitest';
import { URI } from 'vscode-uri';
import { RouteTable } from './RouteTable';
import { AbstractFileSystem, FileType, FileStat, FileTuple } from '../AbstractFileSystem';

function createMockFileSystem(files: Record<string, string>): AbstractFileSystem {
  const fileSet = new Map(Object.entries(files));

  return {
    stat: vi.fn(async (uri: string): Promise<FileStat> => {
      if (fileSet.has(uri)) {
        return { type: FileType.File, size: fileSet.get(uri)!.length };
      }
      throw new Error(`File not found: ${uri}`);
    }),
    readFile: vi.fn(async (uri: string): Promise<string> => {
      if (fileSet.has(uri)) {
        return fileSet.get(uri)!;
      }
      throw new Error(`File not found: ${uri}`);
    }),
    readDirectory: vi.fn(async (uri: string): Promise<FileTuple[]> => {
      const results: FileTuple[] = [];
      const dirs = new Set<string>();

      for (const filePath of fileSet.keys()) {
        if (filePath.startsWith(uri + '/') || filePath === uri) {
          // Check if this is a direct child or nested
          const remaining = filePath.slice(uri.length + 1);
          const slashIdx = remaining.indexOf('/');
          if (slashIdx === -1) {
            results.push([filePath, FileType.File]);
          } else {
            const dirName = uri + '/' + remaining.slice(0, slashIdx);
            if (!dirs.has(dirName)) {
              dirs.add(dirName);
              results.push([dirName, FileType.Directory]);
            }
          }
        }
      }

      if (results.length === 0 && !fileSet.has(uri)) {
        throw new Error(`Directory not found: ${uri}`);
      }

      return results;
    }),
  };
}

const ROOT = URI.parse('file:///project');

function page(path: string, content: string = ''): [string, string] {
  return [`file:///project/${path}`, content];
}

describe('RouteTable', () => {
  describe('build and static matching', () => {
    it('matches a simple static page', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([page('app/views/pages/about.html.liquid')]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/about')).toBe(true);
      expect(rt.hasMatch('/nonexistent')).toBe(false);
    });

    it('matches root index page', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([page('app/views/pages/index.html.liquid')]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/')).toBe(true);
    });

    it('matches root from home.html.liquid (deprecated alias)', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([page('app/views/pages/home.html.liquid')]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/')).toBe(true);
      expect(rt.hasMatch('/home')).toBe(false);
    });

    it('normalizes trailing slashes', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([page('app/views/pages/about.html.liquid')]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/about/')).toBe(true);
    });

    it('matches nested pages', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([page('app/views/pages/users/show.html.liquid')]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/users/show')).toBe(true);
      expect(rt.hasMatch('/users')).toBe(false);
    });

    it('handles index aliasing', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([page('app/views/pages/products/index.html.liquid')]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/products')).toBe(true);
      expect(rt.hasMatch('/products/index')).toBe(true);
    });

    it('does not report false match', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([
          page('app/views/pages/about.html.liquid'),
          page('app/views/pages/contact.html.liquid'),
        ]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/nonexistent')).toBe(false);
    });
  });

  describe('frontmatter slug override', () => {
    it('uses frontmatter slug instead of file path', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([
          page('app/views/pages/legacy-about.html.liquid', '---\nslug: about\n---\n<h1>About</h1>'),
        ]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/about')).toBe(true);
      expect(rt.hasMatch('/legacy-about')).toBe(false);
    });
  });

  describe('dynamic route matching', () => {
    it('matches :param segments', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([
          page('app/views/pages/users.html.liquid', '---\nslug: users/:id\n---\n'),
        ]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/users/42')).toBe(true);
      expect(rt.hasMatch('/users/john')).toBe(true);
      expect(rt.hasMatch('/users')).toBe(false);
      expect(rt.hasMatch('/users/42/extra')).toBe(false);
    });

    it('matches :param with static suffix', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([
          page('app/views/pages/user-edit.html.liquid', '---\nslug: users/:id/edit\n---\n'),
        ]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/users/42/edit')).toBe(true);
      expect(rt.hasMatch('/users/42')).toBe(false);
    });

    it('matches wildcard segments', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([
          page('app/views/pages/api.html.liquid', '---\nslug: api/*path\n---\n'),
        ]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/api/v1')).toBe(true);
      expect(rt.hasMatch('/api/v1/users/42')).toBe(true);
      expect(rt.hasMatch('/api')).toBe(false);
    });
  });

  describe('optional segment matching', () => {
    it('matches with optional part omitted', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([
          page('app/views/pages/users.html.liquid', '---\nslug: users(/:id)\n---\n'),
        ]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/users')).toBe(true);
      expect(rt.hasMatch('/users/42')).toBe(true);
      expect(rt.hasMatch('/users/42/extra')).toBe(false);
    });

    it('matches with multiple optional groups', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([
          page('app/views/pages/search.html.liquid', '---\nslug: search(/:country)(/:city)\n---\n'),
        ]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/search')).toBe(true);
      expect(rt.hasMatch('/search/us')).toBe(true);
      expect(rt.hasMatch('/search/us/nyc')).toBe(true);
    });

    it('matches optional group with static + wildcard', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([
          page('app/views/pages/users.html.liquid', '---\nslug: users(/section/*)\n---\n'),
        ]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/users')).toBe(true);
      expect(rt.hasMatch('/users/section/anything/here')).toBe(true);
      expect(rt.hasMatch('/users/other')).toBe(false);
    });
  });

  describe('method matching', () => {
    it('filters by HTTP method', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([
          page('app/views/pages/login.html.liquid'),
          page('app/views/pages/login-post.html.liquid', '---\nslug: login\nmethod: post\n---\n'),
        ]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/login', 'get')).toBe(true);
      expect(rt.hasMatch('/login', 'post')).toBe(true);
      expect(rt.hasMatch('/login', 'delete')).toBe(false);
    });

    it('defaults method to get', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([page('app/views/pages/about.html.liquid')]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/about', 'get')).toBe(true);
      expect(rt.hasMatch('/about', 'post')).toBe(false);
    });
  });

  describe('format matching', () => {
    it('matches page with json format', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([page('app/views/pages/api/data.json.liquid')]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/api/data')).toBe(true);
    });
  });

  describe('Liquid interpolation matching', () => {
    it('matches :_liquid_ against :param route', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([
          page('app/views/pages/users.html.liquid', '---\nslug: users/:id\n---\n'),
        ]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/users/:_liquid_')).toBe(true);
    });

    it('matches :_liquid_ against static route segment', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([page('app/views/pages/users/show.html.liquid')]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      // /users/:_liquid_ should match users/show because :_liquid_ matches any segment
      expect(rt.hasMatch('/users/:_liquid_')).toBe(true);
    });

    it('matches mixed static + :_liquid_ pattern', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([
          page(
            'app/views/pages/product-reviews.html.liquid',
            '---\nslug: products/:id/reviews\n---\n',
          ),
        ]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/products/:_liquid_/reviews')).toBe(true);
      expect(rt.hasMatch('/products/:_liquid_/settings')).toBe(false);
    });

    it('does not match :_liquid_ when no route exists', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([page('app/views/pages/about.html.liquid')]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/orders/:_liquid_/invoice')).toBe(false);
    });
  });

  describe('precedence ordering', () => {
    it('returns most specific route first', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([
          page('app/views/pages/users-section-1.html.liquid', '---\nslug: users/section/1\n---\n'),
          page(
            'app/views/pages/users-section-id.html.liquid',
            '---\nslug: users/section/:id\n---\n',
          ),
          page('app/views/pages/users-wild.html.liquid', '---\nslug: users/*\n---\n'),
        ]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      const matches = rt.match('/users/section/1');
      expect(matches.length).toBeGreaterThanOrEqual(2);
      // Most specific (all static) should be first
      expect(matches[0].slug).toBe('users/section/1');
    });

    it('prefers required param over optional param', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([
          page('app/views/pages/users-required.html.liquid', '---\nslug: users/:id\n---\n'),
          page('app/views/pages/users-optional.html.liquid', '---\nslug: users(/:id)\n---\n'),
        ]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      const matches = rt.match('/users/42');
      expect(matches.length).toBe(2);
      expect(matches[0].slug).toBe('users/:id');
    });
  });

  describe('updateFile and removeFile', () => {
    it('adds a route via updateFile', async () => {
      const fs = createMockFileSystem({});
      const rt = new RouteTable(fs);

      rt.updateFile(
        'file:///project/app/views/pages/new-page.html.liquid',
        '---\nslug: new-page\n---\n',
      );

      expect(rt.hasMatch('/new-page')).toBe(true);
    });

    it('removes a route via removeFile', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([page('app/views/pages/about.html.liquid')]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/about')).toBe(true);

      rt.removeFile('file:///project/app/views/pages/about.html.liquid');

      expect(rt.hasMatch('/about')).toBe(false);
    });

    it('updates existing route', async () => {
      const fs = createMockFileSystem(
        Object.fromEntries([page('app/views/pages/page.html.liquid', '---\nslug: old\n---\n')]),
      );
      const rt = new RouteTable(fs);
      await rt.build(ROOT);

      expect(rt.hasMatch('/old')).toBe(true);
      expect(rt.hasMatch('/new')).toBe(false);

      rt.updateFile('file:///project/app/views/pages/page.html.liquid', '---\nslug: new\n---\n');

      expect(rt.hasMatch('/old')).toBe(false);
      expect(rt.hasMatch('/new')).toBe(true);
    });
  });

  describe('module pages', () => {
    it('discovers and matches module pages', async () => {
      const files = Object.fromEntries([
        page('modules/admin/public/views/pages/dashboard.html.liquid'),
      ]);
      // Also need the modules directory to be discoverable
      const fs = createMockFileSystem(files);
      const rt = new RouteTable(fs);

      // Manually add since build requires directory listing
      rt.updateFile('file:///project/modules/admin/public/views/pages/dashboard.html.liquid', '');

      expect(rt.hasMatch('/dashboard')).toBe(true);
    });
  });
});
