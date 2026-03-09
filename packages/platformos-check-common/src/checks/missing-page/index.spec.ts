import { describe, it, expect } from 'vitest';
import { runLiquidCheck } from '../../test';
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
      const sourceCode =
        '{% assign url = "/nonexistent" %}\n<a href="{{ url }}">Link</a>';
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
      const sourceCode =
        '{% assign url = "/ABOUT" | downcase %}\n<a href="{{ url }}">Link</a>';
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
      expect(offenses.map((o) => o.message)).toEqual([
        "No page found for route '/submit' (POST)",
      ]);
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
      const sourceCode =
        '{% assign url = "/about" %}\n<a href="{{ url }}">About</a>';
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
      const sourceCode =
        '{% assign url = "/about" %}\n<a href="{{ url | escape }}">About</a>';
      const offenses = await runLiquidCheck(
        MissingPage,
        sourceCode,
        'app/views/pages/home.html.liquid',
      );
      // {{ url | escape }} has filters → not a simple variable → fully dynamic → skipped
      expect(offenses.map((o) => o.message)).toEqual([]);
    });

    it('does not report when variable has lookups in href (unresolvable)', async () => {
      const sourceCode =
        '{% assign config = "test" %}\n<a href="{{ config.url }}">Link</a>';
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
      const sourceCode =
        '{% assign slug = "about" %}\n<a href="/pages/{{ slug }}">About</a>';
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
      const sourceCode =
        '{% liquid\n  assign url = "/about"\n%}\n<a href="{{ url }}">About</a>';
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
      const sourceCode =
        '{% capture url %}/about{% endcapture %}\n<a href="{{ url }}">About</a>';
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
});
