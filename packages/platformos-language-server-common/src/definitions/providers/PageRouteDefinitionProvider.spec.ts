import { assert, beforeEach, describe, expect, it } from 'vitest';
import { DefinitionParams, LocationLink } from 'vscode-languageserver-protocol';
import { AbstractFileSystem, FileType } from '@platformos/platformos-common';
import { DocumentManager } from '../../documents';
import { DefinitionProvider } from '../DefinitionProvider';

function createMockFs(files: Record<string, string>): AbstractFileSystem {
  const fileUris = new Map<string, string>();
  const dirEntries = new Map<string, [string, FileType][]>();

  for (const [path, content] of Object.entries(files)) {
    const uri = `file:///project/${path}`;
    fileUris.set(uri, content);

    // Build directory entries
    const parts = path.split('/');
    for (let i = 0; i < parts.length; i++) {
      const dirPath = parts.slice(0, i + 1).join('/');
      const parentPath = parts.slice(0, i).join('/');
      const parentUri = parentPath ? `file:///project/${parentPath}` : 'file:///project';
      const childUri = `file:///project/${dirPath}`;
      const isFile = i === parts.length - 1;

      if (!dirEntries.has(parentUri)) dirEntries.set(parentUri, []);
      const entries = dirEntries.get(parentUri)!;
      if (!entries.some(([u]) => u === childUri)) {
        entries.push([childUri, isFile ? FileType.File : FileType.Directory]);
      }
    }
  }

  return {
    async stat(uri: string) {
      if (fileUris.has(uri)) return { type: FileType.File, size: fileUris.get(uri)!.length };
      if (dirEntries.has(uri)) return { type: FileType.Directory, size: 0 };
      throw new Error(`ENOENT: ${uri}`);
    },
    async readFile(uri: string) {
      if (fileUris.has(uri)) return fileUris.get(uri)!;
      throw new Error(`ENOENT: ${uri}`);
    },
    async readDirectory(uri: string) {
      if (dirEntries.has(uri)) return dirEntries.get(uri)!;
      throw new Error(`ENOENT: ${uri}`);
    },
  };
}

describe('Module: PageRouteDefinitionProvider', () => {
  let provider: DefinitionProvider;
  let documentManager: DocumentManager;

  function setup(pageFiles: Record<string, string>) {
    documentManager = new DocumentManager();

    // Add .pos sentinel file so findAppRootURI works
    const files: Record<string, string> = { '.pos': '' };
    for (const [path, content] of Object.entries(pageFiles)) {
      files[path] = content;
    }

    const fs = createMockFs(files);
    const findAppRootURI = async (_uri: string) => 'file:///project';
    const mockGetDefaultLocaleSourceCode = async () => null;

    provider = new DefinitionProvider(
      documentManager,
      mockGetDefaultLocaleSourceCode,
      fs,
      findAppRootURI,
    );
  }

  it('navigates to a static page from href', async () => {
    setup({
      'app/views/pages/about.html.liquid': '<h1>About</h1>',
    });

    documentManager.open(
      'file:///project/app/views/pages/home.html.liquid',
      '<a href="/about">About</a>',
      1,
    );

    const params: DefinitionParams = {
      textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
      position: { line: 0, character: 11 }, // Inside "/about"
    };

    const result = await provider.definitions(params);
    assert(result);
    expect(result).toHaveLength(1);
    assert(LocationLink.is(result[0]));
    expect(result[0].targetUri).toBe('file:///project/app/views/pages/about.html.liquid');
  });

  it('navigates to a dynamic route page', async () => {
    setup({
      'app/views/pages/user.html.liquid': '---\nslug: users/:id\n---\n<h1>User</h1>',
    });

    documentManager.open(
      'file:///project/app/views/pages/home.html.liquid',
      '<a href="/users/42">User</a>',
      1,
    );

    const params: DefinitionParams = {
      textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
      position: { line: 0, character: 12 }, // Inside "/users/42"
    };

    const result = await provider.definitions(params);
    assert(result);
    expect(result).toHaveLength(1);
    expect(result[0].targetUri).toBe('file:///project/app/views/pages/user.html.liquid');
  });

  it('navigates to POST page from form action', async () => {
    setup({
      'app/views/pages/contact.html.liquid': '---\nmethod: post\n---\n<h1>Contact</h1>',
    });

    documentManager.open(
      'file:///project/app/views/pages/home.html.liquid',
      '<form action="/contact" method="post"><button>Send</button></form>',
      1,
    );

    const params: DefinitionParams = {
      textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
      position: { line: 0, character: 16 }, // Inside "/contact"
    };

    const result = await provider.definitions(params);
    assert(result);
    expect(result).toHaveLength(1);
    expect(result[0].targetUri).toBe('file:///project/app/views/pages/contact.html.liquid');
  });

  it('navigates to DELETE page from form with _method inside a div wrapper', async () => {
    setup({
      'app/views/pages/user-delete.html.liquid': '---\nslug: users/:id\nmethod: delete\n---\n',
    });

    documentManager.open(
      'file:///project/app/views/pages/home.html.liquid',
      '<form action="/users/1" method="post"><div><input type="hidden" name="_method" value="delete"></div><button>Delete</button></form>',
      1,
    );

    const params: DefinitionParams = {
      textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
      position: { line: 0, character: 16 }, // Inside "/users/1"
    };

    const result = await provider.definitions(params);
    assert(result);
    expect(result).toHaveLength(1);
    expect(result[0].targetUri).toBe('file:///project/app/views/pages/user-delete.html.liquid');
  });

  it('returns null for external URLs', async () => {
    setup({});

    documentManager.open(
      'file:///project/app/views/pages/home.html.liquid',
      '<a href="https://example.com">External</a>',
      1,
    );

    const params: DefinitionParams = {
      textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
      position: { line: 0, character: 12 }, // Inside "https://example.com"
    };

    const result = await provider.definitions(params);
    assert(result === null);
  });

  it('returns null when no matching page exists', async () => {
    setup({
      'app/views/pages/about.html.liquid': '<h1>About</h1>',
    });

    documentManager.open(
      'file:///project/app/views/pages/home.html.liquid',
      '<a href="/nonexistent">Link</a>',
      1,
    );

    const params: DefinitionParams = {
      textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
      position: { line: 0, character: 12 }, // Inside "/nonexistent"
    };

    const result = await provider.definitions(params);
    assert(result === null);
  });

  it('navigates with Liquid interpolation in href', async () => {
    setup({
      'app/views/pages/user.html.liquid': '---\nslug: users/:id\n---\n<h1>User</h1>',
    });

    documentManager.open(
      'file:///project/app/views/pages/home.html.liquid',
      '<a href="/users/{{ user.id }}">User</a>',
      1,
    );

    const params: DefinitionParams = {
      textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
      position: { line: 0, character: 11 }, // Inside the href value, on "/users/"
    };

    const result = await provider.definitions(params);
    assert(result);
    expect(result).toHaveLength(1);
    expect(result[0].targetUri).toBe('file:///project/app/views/pages/user.html.liquid');
  });

  it('navigates to page when <a> is deeply nested inside other elements', async () => {
    setup({
      'app/views/pages/about.html.liquid': '<h1>About</h1>',
    });

    documentManager.open(
      'file:///project/app/views/pages/home.html.liquid',
      '<div><table><tbody><tr><td><a href="/about">About</a></td></tr></tbody></table></div>',
      1,
    );

    const params: DefinitionParams = {
      textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
      position: { line: 0, character: 37 }, // Inside "/about"
    };

    const result = await provider.definitions(params);
    assert(result);
    expect(result).toHaveLength(1);
    expect(result[0].targetUri).toBe('file:///project/app/views/pages/about.html.liquid');
  });

  it('navigates when cursor is on the tag name of <a>', async () => {
    setup({
      'app/views/pages/about.html.liquid': '<h1>About</h1>',
    });

    documentManager.open(
      'file:///project/app/views/pages/home.html.liquid',
      '<a href="/about">About</a>',
      1,
    );

    const params: DefinitionParams = {
      textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
      position: { line: 0, character: 1 }, // On the "a" tag name
    };

    const result = await provider.definitions(params);
    assert(result);
    expect(result).toHaveLength(1);
    assert(LocationLink.is(result[0]));
    expect(result[0].targetUri).toBe('file:///project/app/views/pages/about.html.liquid');
  });

  it('navigates when cursor is on the href attribute name', async () => {
    setup({
      'app/views/pages/about.html.liquid': '<h1>About</h1>',
    });

    documentManager.open(
      'file:///project/app/views/pages/home.html.liquid',
      '<a href="/about">About</a>',
      1,
    );

    const params: DefinitionParams = {
      textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
      position: { line: 0, character: 4 }, // On "href"
    };

    const result = await provider.definitions(params);
    assert(result);
    expect(result).toHaveLength(1);
    assert(LocationLink.is(result[0]));
    expect(result[0].targetUri).toBe('file:///project/app/views/pages/about.html.liquid');
  });

  it('returns null when cursor is on a non-URL attribute of <a>', async () => {
    setup({
      'app/views/pages/about.html.liquid': '<h1>About</h1>',
    });

    documentManager.open(
      'file:///project/app/views/pages/home.html.liquid',
      '<a class="link" href="/about">About</a>',
      1,
    );

    const params: DefinitionParams = {
      textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
      position: { line: 0, character: 5 }, // On "class" attr name
    };

    const result = await provider.definitions(params);
    assert(result === null);
  });

  it('navigates when cursor is on the tag name of <form>', async () => {
    setup({
      'app/views/pages/contact.html.liquid': '---\nmethod: post\n---\n<h1>Contact</h1>',
    });

    documentManager.open(
      'file:///project/app/views/pages/home.html.liquid',
      '<form action="/contact" method="post"><button>Send</button></form>',
      1,
    );

    const params: DefinitionParams = {
      textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
      position: { line: 0, character: 2 }, // On "form" tag name
    };

    const result = await provider.definitions(params);
    assert(result);
    expect(result).toHaveLength(1);
    expect(result[0].targetUri).toBe('file:///project/app/views/pages/contact.html.liquid');
  });

  it('navigates when cursor is on action attribute name of <form>', async () => {
    setup({
      'app/views/pages/contact.html.liquid': '---\nmethod: post\n---\n<h1>Contact</h1>',
    });

    documentManager.open(
      'file:///project/app/views/pages/home.html.liquid',
      '<form action="/contact" method="post"><button>Send</button></form>',
      1,
    );

    const params: DefinitionParams = {
      textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
      position: { line: 0, character: 8 }, // On "action" attr name
    };

    const result = await provider.definitions(params);
    assert(result);
    expect(result).toHaveLength(1);
    expect(result[0].targetUri).toBe('file:///project/app/views/pages/contact.html.liquid');
  });

  it('returns null when cursor is on tag name of non-a/form element', async () => {
    setup({
      'app/views/pages/about.html.liquid': '<h1>About</h1>',
    });

    documentManager.open(
      'file:///project/app/views/pages/home.html.liquid',
      '<div><a href="/about">About</a></div>',
      1,
    );

    const params: DefinitionParams = {
      textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
      position: { line: 0, character: 2 }, // On "div" tag name
    };

    const result = await provider.definitions(params);
    assert(result === null);
  });

  it('navigates from absolute self-referencing URL', async () => {
    setup({
      'app/views/pages/about.html.liquid': '<h1>About</h1>',
    });

    documentManager.open(
      'file:///project/app/views/pages/home.html.liquid',
      '<a href="https://{{ context.location.host }}/about">About</a>',
      1,
    );

    const params: DefinitionParams = {
      textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
      position: { line: 0, character: 12 }, // Inside the href value
    };

    const result = await provider.definitions(params);
    assert(result);
    expect(result).toHaveLength(1);
    expect(result[0].targetUri).toBe('file:///project/app/views/pages/about.html.liquid');
  });

  describe('assign-tracking', () => {
    it('navigates when href uses a variable assigned with a static URL', async () => {
      setup({
        'app/views/pages/about.html.liquid': '<h1>About</h1>',
      });

      documentManager.open(
        'file:///project/app/views/pages/home.html.liquid',
        '{% assign url = "/about" %}\n<a href="{{ url }}">About</a>',
        1,
      );

      const params: DefinitionParams = {
        textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
        position: { line: 1, character: 12 }, // Inside {{ url }}
      };

      const result = await provider.definitions(params);
      assert(result);
      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe('file:///project/app/views/pages/about.html.liquid');
    });

    it('navigates when href uses a variable built with append filters', async () => {
      setup({
        'app/views/pages/group-edit.html.liquid': '---\nslug: groups/:id/edit\n---\n',
      });

      documentManager.open(
        'file:///project/app/views/pages/home.html.liquid',
        '{% assign url = "/groups/" | append: group.id | append: "/edit" %}\n<a href="{{ url }}">Edit</a>',
        1,
      );

      const params: DefinitionParams = {
        textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
        position: { line: 1, character: 12 }, // Inside {{ url }}
      };

      const result = await provider.definitions(params);
      assert(result);
      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe('file:///project/app/views/pages/group-edit.html.liquid');
    });

    it('navigates when cursor is on the <a tag name with an assigned variable href', async () => {
      setup({
        'app/views/pages/about.html.liquid': '<h1>About</h1>',
      });

      documentManager.open(
        'file:///project/app/views/pages/home.html.liquid',
        '{% assign url = "/about" %}\n<a href="{{ url }}">About</a>',
        1,
      );

      const params: DefinitionParams = {
        textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
        position: { line: 1, character: 1 }, // On the "a" tag name
      };

      const result = await provider.definitions(params);
      assert(result);
      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe('file:///project/app/views/pages/about.html.liquid');
    });

    it('navigates form action with assigned variable', async () => {
      setup({
        'app/views/pages/contact.html.liquid': '---\nmethod: post\n---\n<h1>Contact</h1>',
      });

      documentManager.open(
        'file:///project/app/views/pages/home.html.liquid',
        '{% assign url = "/contact" %}\n<form action="{{ url }}" method="post"><button>Send</button></form>',
        1,
      );

      const params: DefinitionParams = {
        textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
        position: { line: 1, character: 16 }, // Inside {{ url }}
      };

      const result = await provider.definitions(params);
      assert(result);
      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe('file:///project/app/views/pages/contact.html.liquid');
    });

    it('returns null for an unresolvable assigned variable', async () => {
      setup({
        'app/views/pages/about.html.liquid': '<h1>About</h1>',
      });

      documentManager.open(
        'file:///project/app/views/pages/home.html.liquid',
        '{% assign url = some_var | downcase %}\n<a href="{{ url }}">About</a>',
        1,
      );

      const params: DefinitionParams = {
        textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
        position: { line: 1, character: 12 }, // Inside {{ url }}
      };

      const result = await provider.definitions(params);
      assert(result === null);
    });

    it('navigates when assign is inside a nested block (scope-unaware)', async () => {
      setup({
        'app/views/pages/about.html.liquid': '<h1>About</h1>',
      });

      documentManager.open(
        'file:///project/app/views/pages/home.html.liquid',
        '{% if true %}{% assign url = "/about" %}{% endif %}\n<a href="{{ url }}">About</a>',
        1,
      );

      const params: DefinitionParams = {
        textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
        position: { line: 1, character: 12 }, // Inside {{ url }}
      };

      const result = await provider.definitions(params);
      assert(result);
      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe('file:///project/app/views/pages/about.html.liquid');
    });

    it('navigates when assign and <a> are both inside the same block tag', async () => {
      // Regression test: when buildVariableMap skips recursion into block containers
      // that end after beforeOffset, assigns inside the same block as <a> are missed.
      setup({
        'app/views/pages/about.html.liquid': '<h1>About</h1>',
      });

      const source =
        '{% if true %}{% assign url = "/about" %}<a href="{{ url }}">About</a>{% endif %}';
      documentManager.open('file:///project/app/views/pages/home.html.liquid', source, 1);

      const urlOffset = source.indexOf('{{ url }}');
      const params: DefinitionParams = {
        textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
        position: { line: 0, character: urlOffset + 3 }, // Inside {{ url }}
      };

      const result = await provider.definitions(params);
      assert(result);
      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe('file:///project/app/views/pages/about.html.liquid');
    });

    it('navigates when assign is inside a {% liquid %} block in the same container', async () => {
      setup({
        'app/views/pages/about.html.liquid': '<h1>About</h1>',
      });

      const source =
        '{% if true %}{% liquid\n  assign url = "/about"\n%}<a href="{{ url }}">About</a>{% endif %}';
      documentManager.open('file:///project/app/views/pages/home.html.liquid', source, 1);

      const urlOffset = source.indexOf('{{ url }}');
      const urlLine = source.slice(0, urlOffset).split('\n').length - 1;
      const urlChar = urlOffset - source.lastIndexOf('\n', urlOffset - 1) - 1;
      const params: DefinitionParams = {
        textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
        position: { line: urlLine, character: urlChar + 3 }, // Inside {{ url }}
      };

      const result = await provider.definitions(params);
      assert(result);
      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe('file:///project/app/views/pages/about.html.liquid');
    });
  });

  describe('format-aware go-to-definition', () => {
    it('navigates to the json page when URL has .json suffix', async () => {
      setup({
        'app/views/pages/api/my-page.html.liquid': '<h1>HTML</h1>',
        'app/views/pages/api/my-page.json.liquid': '{ "data": true }',
      });

      documentManager.open(
        'file:///project/app/views/pages/home.html.liquid',
        '<a href="/api/my-page.json">JSON</a>',
        1,
      );

      const params: DefinitionParams = {
        textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
        position: { line: 0, character: 15 }, // Inside href value
      };

      const result = await provider.definitions(params);
      assert(result);
      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toContain('my-page.json.liquid');
    });

    it('navigates to only html page when URL has no format suffix', async () => {
      setup({
        'app/views/pages/api/my-page.html.liquid': '<h1>HTML</h1>',
        'app/views/pages/api/my-page.json.liquid': '{ "data": true }',
      });

      documentManager.open(
        'file:///project/app/views/pages/home.html.liquid',
        '<a href="/api/my-page">HTML only</a>',
        1,
      );

      const params: DefinitionParams = {
        textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
        position: { line: 0, character: 15 }, // Inside href value
      };

      const result = await provider.definitions(params);
      assert(result);
      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toContain('my-page.html.liquid');
    });
  });

  describe('assign override — position-aware variable resolution', () => {
    it('first link goes to /about, second link goes to /contact', async () => {
      setup({
        'app/views/pages/about.html.liquid': '<h1>About</h1>',
        'app/views/pages/contact.html.liquid': '<h1>Contact</h1>',
      });

      // {% assign url = "/about" %}<a href="{{ url }}">..</a>{% assign url = "/contact" %}<a href="{{ url }}">..</a>
      const source =
        '{% assign url = "/about" %}<a href="{{ url }}">About</a>{% assign url = "/contact" %}<a href="{{ url }}">Contact</a>';
      documentManager.open('file:///project/app/views/pages/home.html.liquid', source, 1);

      // First <a> — cursor inside the first href="{{ url }}"
      // The first <a> starts at offset 27, href value "{{ url }}" is around offset 37
      const firstHrefOffset = source.indexOf('{{ url }}');
      const firstLine = source.slice(0, firstHrefOffset).split('\n').length - 1;
      const firstChar = firstHrefOffset - source.lastIndexOf('\n', firstHrefOffset - 1) - 1;

      const result1 = await provider.definitions({
        textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
        position: { line: firstLine, character: firstChar + 3 }, // Inside {{ url }}
      });
      assert(result1);
      expect(result1).toHaveLength(1);
      expect(result1[0].targetUri).toBe('file:///project/app/views/pages/about.html.liquid');

      // Second <a> — cursor inside the second href="{{ url }}"
      const secondHrefOffset = source.indexOf('{{ url }}', firstHrefOffset + 1);
      const secondLine = source.slice(0, secondHrefOffset).split('\n').length - 1;
      const secondChar = secondHrefOffset - source.lastIndexOf('\n', secondHrefOffset - 1) - 1;

      const result2 = await provider.definitions({
        textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
        position: { line: secondLine, character: secondChar + 3 }, // Inside {{ url }}
      });
      assert(result2);
      expect(result2).toHaveLength(1);
      expect(result2[0].targetUri).toBe('file:///project/app/views/pages/contact.html.liquid');
    });
  });

  describe('invalidateRouteTable', () => {
    it('forces a full rebuild on next definition request', async () => {
      // Initial setup with /about page
      const files: Record<string, string> = {
        '.pos': '',
        'app/views/pages/about.html.liquid': '<h1>About</h1>',
      };

      const fileUris = new Map<string, string>();
      const dirEntries = new Map<string, [string, FileType][]>();

      function rebuildIndex() {
        fileUris.clear();
        dirEntries.clear();
        for (const [path, content] of Object.entries(files)) {
          const uri = `file:///project/${path}`;
          fileUris.set(uri, content);
          const parts = path.split('/');
          for (let i = 0; i < parts.length; i++) {
            const dirPath = parts.slice(0, i + 1).join('/');
            const parentPath = parts.slice(0, i).join('/');
            const parentUri = parentPath ? `file:///project/${parentPath}` : 'file:///project';
            const childUri = `file:///project/${dirPath}`;
            const isFile = i === parts.length - 1;
            if (!dirEntries.has(parentUri)) dirEntries.set(parentUri, []);
            const entries = dirEntries.get(parentUri)!;
            if (!entries.some(([u]) => u === childUri)) {
              entries.push([childUri, isFile ? FileType.File : FileType.Directory]);
            }
          }
        }
      }

      rebuildIndex();

      const fs: AbstractFileSystem = {
        async stat(uri: string) {
          if (fileUris.has(uri)) return { type: FileType.File, size: fileUris.get(uri)!.length };
          if (dirEntries.has(uri)) return { type: FileType.Directory, size: 0 };
          throw new Error(`ENOENT: ${uri}`);
        },
        async readFile(uri: string) {
          if (fileUris.has(uri)) return fileUris.get(uri)!;
          throw new Error(`ENOENT: ${uri}`);
        },
        async readDirectory(uri: string) {
          if (dirEntries.has(uri)) return dirEntries.get(uri)!;
          throw new Error(`ENOENT: ${uri}`);
        },
      };

      documentManager = new DocumentManager();
      provider = new DefinitionProvider(
        documentManager,
        async () => null,
        fs,
        async () => 'file:///project',
      );

      // Open a page that links to /about
      documentManager.open(
        'file:///project/app/views/pages/home.html.liquid',
        '<a href="/about">About</a>',
        1,
      );

      const params: DefinitionParams = {
        textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
        position: { line: 0, character: 12 },
      };

      // First request triggers build — /about is found
      const result1 = await provider.definitions(params);
      assert(result1);
      expect(result1).toHaveLength(1);

      // Simulate branch switch: remove /about, add /contact
      delete files['app/views/pages/about.html.liquid'];
      files['app/views/pages/contact.html.liquid'] = '<h1>Contact</h1>';
      rebuildIndex();

      // Without invalidation, the cached route table still finds /about
      const result2 = await provider.definitions(params);
      assert(result2);
      expect(result2).toHaveLength(1); // Still finds old /about from cache

      // Invalidate — forces a full rebuild on next request
      provider.invalidateRouteTable();

      // Now the route table is rebuilt from the new filesystem state
      const result3 = await provider.definitions(params);
      // /about no longer exists, so no definitions found
      expect(result3).toEqual(null);

      // Verify /contact is now discoverable
      documentManager.open(
        'file:///project/app/views/pages/home.html.liquid',
        '<a href="/contact">Contact</a>',
        2,
      );

      const contactParams: DefinitionParams = {
        textDocument: { uri: 'file:///project/app/views/pages/home.html.liquid' },
        position: { line: 0, character: 14 },
      };

      const result4 = await provider.definitions(contactParams);
      assert(result4);
      expect(result4).toHaveLength(1);
      expect(result4[0].targetUri).toBe('file:///project/app/views/pages/contact.html.liquid');
    });
  });
});
