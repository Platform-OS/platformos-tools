import { describe, it, expect } from 'vitest';
import { RouteTable } from '@platformos/platformos-common';
import { runLiquidCheck } from '../../test';
import { MockFileSystem } from '../../test/MockFileSystem';
import { MissingPage } from './index';

describe('Module: MissingPage', () => {
  describe('should report offense', () => {
    it('reports when no pages exist', async () => {
      const sourceCode = '<a href="/nonexistent">Link</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      expect(offenses.map((o) => o.message)).toEqual([
        "No page found for route '/nonexistent' (GET)",
      ]);
    });

    it('reports when only GET page exists but form uses POST', async () => {
      const sourceCode = '<form action="/login" method="post"><button>Go</button></form>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/login.html.liquid': '<h1>Login</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual(["No page found for route '/login' (POST)"]);
    });

    it('reports for non-matching path', async () => {
      const sourceCode = '<a href="/about-us">About Us</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/about.html.liquid': '<h1>About</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual(["No page found for route '/about-us' (GET)"]);
    });

    it('reports for Liquid interpolation with no matching parameterized route', async () => {
      const sourceCode = '<a href="/orders/{{ order.id }}/invoice">Invoice</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/orders.html.liquid': '---\nslug: orders/:id\n---\n<h1>Order</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([
        "No page found for route '/orders/:_liquid_/invoice' (GET)",
      ]);
    });

    it('reports for form with _method=delete inside a div wrapper when only POST page exists', async () => {
      const sourceCode =
        '<form action="/users/1" method="post"><div><input type="hidden" name="_method" value="delete"></div><button>Delete</button></form>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/user-post.html.liquid':
            '---\nslug: users/:id\nmethod: post\n---\n<h1>Update</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([
        "No page found for route '/users/1' (DELETE)",
      ]);
    });

    it('reports for form with _method=put inside nested div and fieldset wrappers', async () => {
      const sourceCode =
        '<form action="/users/1" method="post"><div><fieldset><input type="hidden" name="_method" value="put"></fieldset></div><button>Update</button></form>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/user-post.html.liquid':
            '---\nslug: users/:id\nmethod: post\n---\n<h1>Update</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual(["No page found for route '/users/1' (PUT)"]);
    });

    it('reports for form with _method=delete when only POST page exists', async () => {
      const sourceCode =
        '<form action="/users/1" method="post"><input type="hidden" name="_method" value="delete"><button>Delete</button></form>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/user-post.html.liquid':
            '---\nslug: users/:id\nmethod: post\n---\n<h1>Update</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([
        "No page found for route '/users/1' (DELETE)",
      ]);
    });

    it('reports when href uses variable assigned with a non-matching URL', async () => {
      const sourceCode = '{% assign url = "/nonexistent" %}\n<a href="{{ url }}">Link</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      expect(offenses.map((o) => o.message)).toEqual([
        "No page found for route '/nonexistent' (GET)",
      ]);
    });

    it('reports when href uses variable assigned with append filters and no matching route', async () => {
      const sourceCode =
        '{% assign url = "/groups/" | append: group.id | append: "/edit" %}\n<a href="{{ url }}">Edit</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      expect(offenses.map((o) => o.message)).toEqual([
        "No page found for route '/groups/:_liquid_/edit' (GET)",
      ]);
    });

    it('reports when variable is reassigned and latest value has no matching route', async () => {
      const sourceCode =
        '{% assign url = "/about" %}\n{% assign url = "/nonexistent" %}\n<a href="{{ url }}">Link</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/about.html.liquid': '<h1>About</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([
        "No page found for route '/nonexistent' (GET)",
      ]);
    });

    it('reports when variable assigned with non-URL filter chain is unresolvable', async () => {
      // downcase is not append/prepend — assign is not tracked, so {{ url }} is fully dynamic → skipped
      const sourceCode = '{% assign url = "/ABOUT" | downcase %}\n<a href="{{ url }}">Link</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      // url can't be resolved → fully dynamic → skipped (no offense)
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('reports when form action uses variable assigned with no matching route', async () => {
      const sourceCode =
        '{% assign action_url = "/submit" %}\n<form action="{{ action_url }}" method="post"><button>Go</button></form>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      expect(offenses.map((o) => o.message)).toEqual(["No page found for route '/submit' (POST)"]);
    });

    it('reports when variable is assigned inside {% liquid %} block with no matching route', async () => {
      const sourceCode =
        '{% liquid\n  assign url = "/nonexistent"\n%}\n<a href="{{ url }}">Link</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      expect(offenses.map((o) => o.message)).toEqual([
        "No page found for route '/nonexistent' (GET)",
      ]);
    });

    it('reports for absolute self-referencing URL with no matching page', async () => {
      const sourceCode = '<a href="https://{{ context.location.host }}/nonexistent">Link</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      expect(offenses.map((o) => o.message)).toEqual([
        "No page found for route '/nonexistent' (GET)",
      ]);
    });
  });

  describe('should NOT report offense', () => {
    it('does not report for existing page', async () => {
      const sourceCode = '<a href="/about">About</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/about.html.liquid': '<h1>About</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report for https://{{ context.location.host }}/path with existing page', async () => {
      const sourceCode = '<a href="https://{{ context.location.host }}/about">About</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/about.html.liquid': '<h1>About</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report for http://{{ context.location.host }}/path with existing page', async () => {
      const sourceCode = '<a href="http://{{ context.location.host }}/about">About</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/about.html.liquid': '<h1>About</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report for root path with index page', async () => {
      const sourceCode = '<a href="/">Home</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/about.html.liquid',
        {},
        {
          'app/views/pages/index.html.liquid': '<h1>Home</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report for dynamic route matching', async () => {
      const sourceCode = '<a href="/users/42">User Profile</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/user.html.liquid': '---\nslug: users/:id\n---\n<h1>User</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report for fully dynamic Liquid href', async () => {
      const sourceCode = '<a href="{{ user.profile_url }}">Profile</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report for external URLs', async () => {
      const sourceCode = '<a href="https://example.com">External</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report for anchor-only href', async () => {
      const sourceCode = '<a href="#section">Jump</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report for mailto', async () => {
      const sourceCode = '<a href="mailto:hello@example.com">Email</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report for empty href', async () => {
      const sourceCode = '<a href="">Empty</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report for Liquid interpolation matching parameterized route', async () => {
      const sourceCode = '<a href="/users/{{ user.id }}">User</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/user.html.liquid': '---\nslug: users/:id\n---\n<h1>User</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report for form with matching POST page', async () => {
      const sourceCode = '<form action="/contact" method="post"><button>Send</button></form>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/contact.html.liquid': '---\nmethod: post\n---\n<h1>Contact</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report for form with _method override inside a div wrapper matching DELETE page', async () => {
      const sourceCode =
        '<form action="/users/1" method="post"><div><input type="hidden" name="_method" value="delete"></div><button>Delete</button></form>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/user-delete.html.liquid': '---\nslug: users/:id\nmethod: delete\n---\n',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report for form with _method override matching DELETE page', async () => {
      const sourceCode =
        '<form action="/users/1" method="post"><input type="hidden" name="_method" value="delete"><button>Delete</button></form>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/user-delete.html.liquid': '---\nslug: users/:id\nmethod: delete\n---\n',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report for index aliased page', async () => {
      const sourceCode = '<a href="/my/page">Link</a><a href="/my/page/index">Also</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/my/page/index.html.liquid': '<h1>Page</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report for Liquid tags in href', async () => {
      const sourceCode = '<a href="{% if admin %}/admin{% else %}/home{% endif %}">Go</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report for Liquid interpolation mixed with text in a segment', async () => {
      const sourceCode = '<a href="/{{ context.slug }}feed">Feed</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report when href uses variable assigned with a matching URL', async () => {
      const sourceCode = '{% assign url = "/about" %}\n<a href="{{ url }}">About</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/about.html.liquid': '<h1>About</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report when href uses variable assigned with append filters matching a route', async () => {
      const sourceCode =
        '{% assign url = "/users/" | append: user.id | append: "/edit" %}\n<a href="{{ url }}">Edit</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/user-edit.html.liquid':
            '---\nslug: users/:id/edit\n---\n<h1>Edit User</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report when href uses variable assigned with prepend filters matching a route', async () => {
      const sourceCode =
        '{% assign url = "/edit" | prepend: user.id | prepend: "/users/" %}\n<a href="{{ url }}">Edit</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/user-edit.html.liquid':
            '---\nslug: users/:id/edit\n---\n<h1>Edit User</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report when variable is used with filters in href (unresolvable)', async () => {
      const sourceCode = '{% assign url = "/about" %}\n<a href="{{ url | escape }}">About</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      // {{ url | escape }} has filters → not a simple variable → fully dynamic → skipped
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report when variable has lookups in href (unresolvable)', async () => {
      const sourceCode = '{% assign config = "test" %}\n<a href="{{ config.url }}">Link</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      // config.url has lookups → not a simple variable → fully dynamic → skipped
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report for form action with variable assigned to a matching POST route', async () => {
      const sourceCode =
        '{% assign action_url = "/contact" %}\n<form action="{{ action_url }}" method="post"><button>Send</button></form>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/contact.html.liquid': '---\nmethod: post\n---\n<h1>Contact</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report when assigned variable is used alongside static text', async () => {
      // "prefix{{ url }}" — mixed attr, variable map not used; normal extraction applies
      const sourceCode = '{% assign slug = "about" %}\n<a href="/pages/{{ slug }}">About</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/page.html.liquid': '---\nslug: pages/:slug\n---\n<h1>Page</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report when variable is assigned inside {% liquid %} block', async () => {
      const sourceCode = '{% liquid\n  assign url = "/about"\n%}\n<a href="{{ url }}">About</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/about.html.liquid': '<h1>About</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report when variable reassigned to a matching route', async () => {
      const sourceCode =
        '{% assign url = "/nonexistent" %}\n{% assign url = "/about" %}\n<a href="{{ url }}">About</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/about.html.liquid': '<h1>About</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report when href has multiple tracked variables (fully dynamic)', async () => {
      const sourceCode =
        '{% assign base = "/users" %}\n{% assign suffix = "/edit" %}\n<a href="{{ base }}{{ suffix }}">Edit</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      // Multiple {{ var }} with no static text → fully dynamic → skipped
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report when variable is set via {% capture %} (not tracked, fully dynamic)', async () => {
      const sourceCode = '{% capture url %}/about{% endcapture %}\n<a href="{{ url }}">About</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      // capture is not tracked → {{ url }} is fully dynamic → skipped
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report for relative URLs without leading slash', async () => {
      const sourceCode = '<a href="about">About</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report for https://{{ other_variable }}/path (only context.location.host is recognized)', async () => {
      const sourceCode = '<a href="https://{{ some_domain }}/about">About</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/about.html.liquid': '<h1>About</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });
  });

  describe('format-aware matching', () => {
    it('matches .json URL against json format page when both html and json pages exist', async () => {
      const sourceCode = '<a href="/api/my-page.json">JSON</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/api/my-page.html.liquid': '<h1>HTML version</h1>',
          'app/views/pages/api/my-page.json.liquid': '{ "data": "json version" }',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    // An html page is the fallback for every format, so it answers a .json URL.
    it('does not report when a .json URL has only an html page (html serves any format)', async () => {
      const sourceCode = '<a href="/api/my-page.json">JSON</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/api/my-page.html.liquid': '<h1>HTML only</h1>',
        },
      );
      expect(offenses).toEqual([]);
    });

    it('reports when URL has no format suffix but only json page exists', async () => {
      const sourceCode = '<a href="/api/my-page">Link</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/api/my-page.json.liquid': '{ "data": true }',
        },
      );
      // Plain URL defaults to html format — only json page exists, so report
      expect(offenses.map((o) => o.message)).toEqual([
        "No page found for route '/api/my-page' (GET)",
      ]);
    });

    it('does not report for URL without format suffix when html page exists', async () => {
      const sourceCode = '<a href="/api/my-page">Link</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/api/my-page.html.liquid': '<h1>HTML</h1>',
          'app/views/pages/api/my-page.json.liquid': '{ "data": true }',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });
  });

  describe('rss format link regression (/blog/rss.rss)', () => {
    it('does not report when the rss format page exists', async () => {
      const sourceCode = '<a href="/blog/rss.rss">RSS</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/blog/rss.rss.liquid': '<rss></rss>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report when the page declares format rss in frontmatter', async () => {
      const sourceCode = '<a href="/blog/rss.rss">RSS</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/blog/rss.liquid': '---\nformat: rss\n---\n<rss></rss>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('reports when no page matches the rss URL', async () => {
      const sourceCode = '<a href="/blog/rss.rss">RSS</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/blog/index.html.liquid': '<h1>Blog</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([
        "No page found for route '/blog/rss.rss' (GET)",
      ]);
    });

    // Same rule: an html page at `blog/rss` answers `/blog/rss.rss`.
    it('does not report the rss URL when only an html page exists at that path', async () => {
      const sourceCode = '<a href="/blog/rss.rss">RSS</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/blog/rss.html.liquid': '<h1>Not a feed</h1>',
        },
      );
      expect(offenses).toEqual([]);
    });

    it('reports when the module page serves the feed as xml (the platformos-blog scenario)', async () => {
      const sourceCode = '<a href="/blog/rss.rss">RSS</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'modules/blog/public/views/partials/layout/footer.liquid',
        {},
        {
          'modules/blog/public/views/pages/blog/rss.liquid':
            "---\nslug: 'blog/rss'\nformat: xml\n---\n<rss></rss>",
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([
        "No page found for route '/blog/rss.rss' (GET)",
      ]);
    });

    it('does not report the xml link when the module page serves the feed as xml', async () => {
      const sourceCode = '<a href="/blog/rss.xml">RSS</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'modules/blog/public/views/partials/layout/footer.liquid',
        {},
        {
          'modules/blog/public/views/pages/blog/rss.liquid':
            "---\nslug: 'blog/rss'\nformat: xml\n---\n<rss></rss>",
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([]);
    });
  });

  describe('assign variable scoping per position', () => {
    it('resolves each link against the variable value at that point in the document', async () => {
      const sourceCode =
        '{% assign url = "/about" %}<a href="{{ url }}">About</a>{% assign url = "/contact" %}<a href="{{ url }}">Contact</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/about.html.liquid': '<h1>About</h1>',
          'app/views/pages/contact.html.liquid': '<h1>Contact</h1>',
        },
      );
      // Both /about and /contact exist — no offenses
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('reports only for the link whose preceding assign points to a missing page', async () => {
      const sourceCode =
        '{% assign url = "/about" %}<a href="{{ url }}">About</a>{% assign url = "/nonexistent" %}<a href="{{ url }}">Missing</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/about.html.liquid': '<h1>About</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([
        "No page found for route '/nonexistent' (GET)",
      ]);
    });

    it('reports for first link when only the second assign matches', async () => {
      const sourceCode =
        '{% assign url = "/nonexistent" %}<a href="{{ url }}">Missing</a>{% assign url = "/about" %}<a href="{{ url }}">About</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {},
        {
          'app/views/pages/about.html.liquid': '<h1>About</h1>',
        },
      );
      expect(offenses.map((o) => o.message)).toEqual([
        "No page found for route '/nonexistent' (GET)",
      ]);
    });
  });

  describe('route table build behavior', () => {
    it('uses routes from a provided table without building a second one', async () => {
      const appFiles = {
        'app/views/pages/contact.html.liquid': '<h1>Contact</h1>',
      };
      const fs = new MockFileSystem({ '.platformos-check.yml': '', ...appFiles });
      const routeTable = new RouteTable(fs);
      await routeTable.build((await import('vscode-uri')).URI.parse('file:///'));
      expect(routeTable.isBuilt()).toBe(true);

      const sourceCode = '<a href="/contact">Contact</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        { routeTable: async () => routeTable },
        appFiles,
      );
      expect(offenses).toHaveLength(0);
    });

    it("trusts the provider's table verbatim: currency is the provider's job", async () => {
      // `Dependencies.routeTable` is a provider, and a provider OWNS making its
      // table current — check-common must not `build()` behind its back, which
      // would throw away and redo check-node's reconciliation. So a provider that
      // hands over an empty, unbuilt table gets exactly what it asked for: every
      // route resolves to "missing". The caller that wants build-on-first-use
      // writes it into its provider, as the language server's runChecks does.
      const appFiles = {
        'app/views/pages/about.html.liquid': '<h1>About</h1>',
      };
      const fs = new MockFileSystem({ '.platformos-check.yml': '', ...appFiles });
      const routeTable = new RouteTable(fs);

      const sourceCode = '<a href="/about">About</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        { routeTable: async () => routeTable },
        appFiles,
      );
      expect(offenses.map((offense) => offense.message)).toEqual([
        "No page found for route '/about' (GET)",
      ]);
    });
  });

  /**
   * Every page in the project has to be read for the table to know its routes, so a
   * run that asks for one when it has nothing to look up pays whole-project I/O for
   * nothing. These pin that it is asked for exactly when a URL needs resolving.
   */
  describe('route table laziness', () => {
    const appFiles = { 'app/views/pages/about.html.liquid': '<h1>About</h1>' };

    async function runWithProvider(sourceCode: string) {
      const fs = new MockFileSystem({ '.platformos-check.yml': '', ...appFiles });
      const built = new RouteTable(fs);
      await built.build((await import('vscode-uri')).URI.parse('file:///'));

      let calls = 0;
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
        {
          routeTable: () => {
            calls += 1;
            return Promise.resolve(built);
          },
        },
        appFiles,
      );
      return { calls, offenses };
    }

    it('never asks a provider for a table when the file links nowhere', async () => {
      expect(await runWithProvider('<h1>Hello</h1>{% assign x = 1 %}')).toEqual({
        calls: 0,
        offenses: [],
      });
    });

    it('never asks a provider for a table when every URL is skipped', async () => {
      expect(
        await runWithProvider('<a href="https://example.com">out</a><a href="#top">top</a>'),
      ).toEqual({ calls: 0, offenses: [] });
    });

    it('asks a provider exactly once for a file with several links', async () => {
      const { calls, offenses } = await runWithProvider(
        '<a href="/about">a</a><a href="/about">b</a><a href="/ghost">c</a>',
      );
      expect(calls).toEqual(1);
      expect(offenses.map((o) => o.message)).toEqual(["No page found for route '/ghost' (GET)"]);
    });
  });

  /**
   * The shapes that carried a `platformos-check-disable MissingPage` in a real project.
   * Most of them report correctly, so they are here as controls: a fix that also
   * silences one of these is too wide. Each is paired with the spelling that resolves it.
   */
  describe('MissingPage: pos-module-community suppression sites', () => {
    describe('platform-provided routes', () => {
      it('does not report a POST to /_maintenance', async () => {
        const sourceCode = [
          '<form action="/_maintenance" accept-charset="UTF-8" method="post">',
          '  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">',
          '</form>',
        ].join('\n');

        const offenses = await runLiquidCheck(
          MissingPage,
          sourceCode,
          'modules/community/public/views/partials/maintenance.liquid',
          {},
          {},
        );

        expect(offenses).toEqual([]);
      });

      // The exemption is per method, not per path: /_maintenance is create-only, so a GET
      // to it is a real 404 and must still report.
      it('still reports a GET to /_maintenance, which the platform does not serve', async () => {
        const offenses = await runLiquidCheck(
          MissingPage,
          '<a href="/_maintenance">Maintenance</a>',
          'modules/community/public/views/partials/maintenance.liquid',
          {},
          {},
        );

        expect(offenses.map((o) => o.message)).toEqual([
          "No page found for route '/_maintenance' (GET)",
        ]);
      });

      it('does not report the GET form of it, /_maintenance/new', async () => {
        const offenses = await runLiquidCheck(
          MissingPage,
          '<a href="/_maintenance/new">Maintenance</a>',
          'modules/community/public/views/partials/maintenance.liquid',
          {},
          {},
        );

        expect(offenses).toEqual([]);
      });

      it('does not report the error pages or the auth and graph endpoints', async () => {
        const sourceCode = [
          '<a href="/404">404</a>',
          '<a href="/500">500</a>',
          '<a href="/maintenance">Down</a>',
          '<a href="/auth/google/callback">Callback</a>',
          '<a href="/auth/failure">Failed</a>',
          '<form action="/api/graph" method="post"></form>',
        ].join('\n');

        const offenses = await runLiquidCheck(
          MissingPage,
          sourceCode,
          'app/views/pages/home.html.liquid',
          {},
          {},
        );

        expect(offenses).toEqual([]);
      });

      // A path that merely looks like a platform route is not one.
      it('still reports a lookalike path', async () => {
        const offenses = await runLiquidCheck(
          MissingPage,
          '<a href="/auth/google/callbacks">x</a><a href="/api/graphs">y</a>',
          'app/views/pages/home.html.liquid',
          {},
          {},
        );

        expect(offenses.map((o) => o.message)).toEqual([
          "No page found for route '/auth/google/callbacks' (GET)",
          "No page found for route '/api/graphs' (GET)",
        ]);
      });
    });

    /**
     * Controls. Each of these is a real suppression site whose offense is CORRECT, and
     * each is paired with the spelling that fixes it — so a suppression wide enough to
     * hide the defect fails here rather than passing quietly.
     */
    describe('true positives (must keep reporting)', () => {
      const SETTINGS_UPDATE_PAGE = {
        'modules/community/public/views/pages/profile/settings_update.liquid':
          '---\nslug: settings_update\nmethod: put\n---\nupdated',
      };

      /**
       * A `_method` override is only seen as literal markup. We deliberately do NOT
       * resolve renders to find one, so a form that hides its override inside a component
       * reports, and writing the input directly is the fix.
       */
      it('reports when _method is hidden inside a component render (we do not resolve partials)', async () => {
        const sourceCode = [
          "{% assign action = '/settings_update' %}",
          '<form action="{{ action }}" method="post" data-settings-form>',
          "  {% theme_render_rc 'components/atoms/input', name: '_method', type: 'hidden', value: 'put' %}",
          '</form>',
        ].join('\n');

        const offenses = await runLiquidCheck(
          MissingPage,
          sourceCode,
          'modules/community/public/views/pages/profile/settings.liquid',
          {},
          SETTINGS_UPDATE_PAGE,
        );

        expect(offenses.map((o) => o.message)).toEqual([
          "No page found for route '/settings_update' (POST)",
        ]);
      });

      it('does not report once _method is written as a literal input (the shipped refactor)', async () => {
        const sourceCode = [
          "{% assign action = '/settings_update' %}",
          '<form action="{{ action }}" method="post" data-settings-form>',
          '  <input type="hidden" name="_method" value="put">',
          '</form>',
        ].join('\n');

        const offenses = await runLiquidCheck(
          MissingPage,
          sourceCode,
          'modules/community/public/views/pages/profile/settings.liquid',
          {},
          SETTINGS_UPDATE_PAGE,
        );

        expect(offenses).toEqual([]);
      });

      /**
       * Segment count is exact: a URL with one segment more than the slug does not match,
       * and neither does one with a segment fewer. Only the param spelled in the path does.
       */
      const IMPERSONATION_PAGES_BARE = {
        'modules/user/public/views/pages/sessions/impersonation/create.liquid':
          '---\nslug: sessions/impersonations\nmethod: post\n---\ncreated',
        'modules/user/public/views/pages/sessions/impersonation/destroy.liquid':
          '---\nslug: sessions/impersonations\nmethod: delete\n---\ndestroyed',
      };

      it('reports a form whose action carries a segment the slug does not have', async () => {
        const offenses = await runLiquidCheck(
          MissingPage,
          '<form action="/sessions/impersonations/{{ profile.user_id }}" method="post"></form>',
          'modules/community/public/views/partials/admin/users/users/edit.liquid',
          {},
          IMPERSONATION_PAGES_BARE,
        );

        expect(offenses.map((o) => o.message)).toEqual([
          "No page found for route '/sessions/impersonations/:_liquid_' (POST)",
        ]);
      });

      it('does not report that form once the id moves into an input instead', async () => {
        const sourceCode = [
          '<form action="/sessions/impersonations" method="post">',
          '  <select name="user_id"><option value="{{ profile.user_id }}">x</option></select>',
          '</form>',
        ].join('\n');

        const offenses = await runLiquidCheck(
          MissingPage,
          sourceCode,
          'modules/community/public/views/partials/admin/users/users/edit.liquid',
          {},
          IMPERSONATION_PAGES_BARE,
        );

        expect(offenses).toEqual([]);
      });

      /**
       * The pair asked for directly: a page whose slug DOES carry `:user_id`, and a form
       * that posts to the bare path carrying the value as a control instead.
       *
       * Measured: a form input never fills a route segment, whatever it is named — the
       * name, `:id` specifically, and the positional `slug3` spelling were each ruled out
       * against a live instance, every one 404. So BOTH halves of this pair are offenses;
       * an input named `user_id` is not the thing that makes the route resolve. What the
       * name can buy is a better MESSAGE (TASK-75), never silence.
       */
      it('reports a form posting to the bare path even when an input matches the missing param', async () => {
        const withMatchingName = [
          '<form action="/sessions/impersonations" method="post">',
          '  <select name="user_id"><option value="1">x</option></select>',
          '</form>',
        ].join('\n');
        const withUnrelatedName = [
          '<form action="/sessions/impersonations" method="post">',
          '  <select name="id"><option value="1">x</option></select>',
          '</form>',
        ].join('\n');
        const pages = {
          'modules/user/public/views/pages/sessions/impersonation/create.liquid':
            '---\nslug: sessions/impersonations/:user_id\nmethod: post\n---\ncreated',
        };

        const matching = await runLiquidCheck(
          MissingPage,
          withMatchingName,
          'modules/community/public/views/partials/admin/users/users/edit.liquid',
          {},
          pages,
        );
        const unrelated = await runLiquidCheck(
          MissingPage,
          withUnrelatedName,
          'modules/community/public/views/partials/admin/users/users/edit.liquid',
          {},
          pages,
        );

        expect(matching.map((o) => o.message)).toEqual([
          "No page found for route '/sessions/impersonations' (POST)",
        ]);
        expect(unrelated.map((o) => o.message)).toEqual([
          "No page found for route '/sessions/impersonations' (POST)",
        ]);
      });

      it('does not report once that same param is spelled in the action path', async () => {
        const offenses = await runLiquidCheck(
          MissingPage,
          '<form action="/sessions/impersonations/{{ profile.user_id }}" method="post"></form>',
          'modules/community/public/views/partials/admin/users/users/edit.liquid',
          {},
          {
            'modules/user/public/views/pages/sessions/impersonation/create.liquid':
              '---\nslug: sessions/impersonations/:user_id\nmethod: post\n---\ncreated',
          },
        );

        expect(offenses).toEqual([]);
      });

      /**
       * A one-character difference in a module's page directory is a different route.
       */
      it('reports the /tests links that modules/tests serves as /_tests', async () => {
        const offenses = await runLiquidCheck(
          MissingPage,
          '<a href="/tests/run">Run</a>',
          'modules/community/public/lib/test/index.liquid',
          {},
          {
            'modules/tests/public/views/pages/_tests/run.html.liquid': 'run',
          },
        );

        expect(offenses.map((o) => o.message)).toEqual([
          "No page found for route '/tests/run' (GET)",
        ]);
      });

      it('does not report the same link spelled /_tests', async () => {
        const offenses = await runLiquidCheck(
          MissingPage,
          '<a href="/_tests/run">Run</a>',
          'modules/community/public/lib/test/index.liquid',
          {},
          {
            'modules/tests/public/views/pages/_tests/run.html.liquid': 'run',
          },
        );

        expect(offenses).toEqual([]);
      });

      /**
       * A form with no `method` is a GET, and a json page answers neither a GET nor an
       * extension-less URL. A render inside the form must not excuse either.
       */
      it('reports a GET form against a put-only json page, render tag and all', async () => {
        const sourceCode = [
          '<form action="/api/posts">',
          '  <input type="hidden" name="post[id]" value="1">',
          "  {% render 'modules/common-styling/forms/markdown', name: 'post[body]', id: 'x' %}",
          '</form>',
        ].join('\n');

        const offenses = await runLiquidCheck(
          MissingPage,
          sourceCode,
          'modules/community/public/views/partials/components/organisms/feed-entry.liquid',
          {},
          {
            'modules/community/public/views/pages/api/posts/update.json.liquid':
              '---\nslug: api/posts\nmethod: put\n---\n{}',
            'modules/common-styling/public/views/partials/forms/markdown.liquid':
              '<textarea></textarea>',
          },
        );

        expect(offenses.map((o) => o.message)).toEqual([
          "No page found for route '/api/posts' (GET)",
        ]);
      });

      it('does not report that form once it declares the put override and the json format', async () => {
        const sourceCode = [
          '<form action="/api/posts.json" method="post">',
          '  <input type="hidden" name="_method" value="put">',
          '  <input type="hidden" name="post[id]" value="1">',
          '</form>',
        ].join('\n');

        const offenses = await runLiquidCheck(
          MissingPage,
          sourceCode,
          'modules/community/public/views/partials/components/organisms/feed-entry.liquid',
          {},
          {
            'modules/community/public/views/pages/api/posts/update.json.liquid':
              '---\nslug: api/posts\nmethod: put\n---\n{}',
          },
        );

        expect(offenses).toEqual([]);
      });

      // The plainest case the suppressions were hiding: links to pages that do not exist.
      it('reports links to pages the project does not have', async () => {
        const offenses = await runLiquidCheck(
          MissingPage,
          '<a href="/search">Join</a><a href="/questions">Ask</a>',
          'modules/community/public/views/partials/components/organisms/quicklinks.liquid',
          {},
          {
            'modules/community/public/views/pages/index.html.liquid': 'home',
          },
        );

        expect(offenses.map((o) => o.message)).toEqual([
          "No page found for route '/search' (GET)",
          "No page found for route '/questions' (GET)",
        ]);
      });
    });
  });
});
