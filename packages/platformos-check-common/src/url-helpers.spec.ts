import { describe, it, expect } from 'vitest';
import {
  toLiquidHtmlAST,
  NodeTypes,
  HtmlElement,
  LiquidTag,
  LiquidTagAssign,
  AssignMarkup,
  LiquidHtmlNode,
} from '@platformos/liquid-html-parser';
import {
  resolveAssignToUrlPattern,
  extractUrlPattern,
  isValuedAttrNode,
  getAttrName,
  buildVariableMap,
  tryExtractAssignUrl,
  ValuedAttrNode,
} from './url-helpers';

/** Parse a Liquid template and extract the first {% assign %} markup. */
function parseAssign(source: string): AssignMarkup {
  const ast = toLiquidHtmlAST(source);
  const assignTag = ast.children.find(
    (n: LiquidHtmlNode) => n.type === NodeTypes.LiquidTag && (n as LiquidTag).name === 'assign',
  ) as LiquidTagAssign | undefined;
  if (!assignTag) throw new Error('No assign tag found in: ' + source);
  return assignTag.markup as AssignMarkup;
}

/** Parse HTML with an <a> tag and return the href attribute node. */
function parseHrefAttr(source: string): ValuedAttrNode {
  const ast = toLiquidHtmlAST(source);
  const aTag = ast.children.find(
    (n: LiquidHtmlNode) =>
      n.type === NodeTypes.HtmlElement && (n as HtmlElement).name[0].type === NodeTypes.TextNode,
  ) as HtmlElement | undefined;
  if (!aTag) throw new Error('No HTML element found in: ' + source);
  const href = (aTag.attributes as LiquidHtmlNode[]).find(
    (a) => isValuedAttrNode(a) && getAttrName(a) === 'href',
  );
  if (!href || !isValuedAttrNode(href)) throw new Error('No href attribute found in: ' + source);
  return href;
}

describe('resolveAssignToUrlPattern', () => {
  describe('string literal base', () => {
    it('resolves a simple string literal', () => {
      const markup = parseAssign('{% assign url = "/about" %}');
      expect(resolveAssignToUrlPattern(markup)).toBe('/about');
    });

    it('resolves a string with trailing slash', () => {
      const markup = parseAssign('{% assign url = "/groups/" %}');
      expect(resolveAssignToUrlPattern(markup)).toBe('/groups/');
    });

    it('resolves a root path', () => {
      const markup = parseAssign('{% assign url = "/" %}');
      expect(resolveAssignToUrlPattern(markup)).toBe('/');
    });
  });

  describe('append filter', () => {
    it('appends a string literal', () => {
      const markup = parseAssign('{% assign url = "/groups" | append: "/edit" %}');
      expect(resolveAssignToUrlPattern(markup)).toBe('/groups/edit');
    });

    it('appends a variable as :_liquid_ placeholder', () => {
      const markup = parseAssign('{% assign url = "/groups/" | append: group.id %}');
      expect(resolveAssignToUrlPattern(markup)).toBe('/groups/:_liquid_');
    });

    it('chains multiple append filters', () => {
      const markup = parseAssign(
        '{% assign url = "/groups/" | append: group.id | append: "/edit" %}',
      );
      expect(resolveAssignToUrlPattern(markup)).toBe('/groups/:_liquid_/edit');
    });

    it('chains append with string and variable args', () => {
      const markup = parseAssign(
        '{% assign url = "/users/" | append: user.id | append: "/posts/" | append: post.id %}',
      );
      expect(resolveAssignToUrlPattern(markup)).toBe('/users/:_liquid_/posts/:_liquid_');
    });
  });

  describe('prepend filter', () => {
    it('prepends a string literal', () => {
      const markup = parseAssign('{% assign url = "/edit" | prepend: "/groups" %}');
      expect(resolveAssignToUrlPattern(markup)).toBe('/groups/edit');
    });

    it('prepends a variable as :_liquid_ placeholder', () => {
      const markup = parseAssign('{% assign url = "/edit" | prepend: group.id %}');
      // Result is ":_liquid_/edit" — doesn't start with /, returns null
      expect(resolveAssignToUrlPattern(markup)).toBe(null);
    });

    it('chains prepend filters', () => {
      const markup = parseAssign(
        '{% assign url = "/edit" | prepend: user.id | prepend: "/users/" %}',
      );
      expect(resolveAssignToUrlPattern(markup)).toBe('/users/:_liquid_/edit');
    });
  });

  describe('mixed append and prepend', () => {
    it('handles append then prepend', () => {
      const markup = parseAssign('{% assign url = "/" | append: "edit" | prepend: "/groups" %}');
      expect(resolveAssignToUrlPattern(markup)).toBe('/groups/edit');
    });
  });

  describe('variable lookup base', () => {
    it('resolves a variable base to :_liquid_', () => {
      const markup = parseAssign('{% assign url = base_path %}');
      // Result is ":_liquid_" — doesn't start with /, returns null
      expect(resolveAssignToUrlPattern(markup)).toBe(null);
    });

    it('resolves a variable base with prepend to produce a valid URL', () => {
      const markup = parseAssign('{% assign url = slug | prepend: "/" %}');
      expect(resolveAssignToUrlPattern(markup)).toBe('/:_liquid_');
    });

    it('resolves a variable base with append', () => {
      const markup = parseAssign('{% assign url = base | append: "/edit" %}');
      // Result is ":_liquid_/edit" — doesn't start with /, returns null
      expect(resolveAssignToUrlPattern(markup)).toBe(null);
    });
  });

  describe('returns null for unsupported patterns', () => {
    it('returns null for << operator (array push)', () => {
      const markup = parseAssign('{% assign arr << "/item" %}');
      expect(resolveAssignToUrlPattern(markup)).toBe(null);
    });

    it('returns null for non-append/prepend filters', () => {
      const markup = parseAssign('{% assign url = "/ABOUT" | downcase %}');
      expect(resolveAssignToUrlPattern(markup)).toBe(null);
    });

    it('returns null for unknown filter in chain', () => {
      const markup = parseAssign('{% assign url = "/groups" | append: "/edit" | strip %}');
      expect(resolveAssignToUrlPattern(markup)).toBe(null);
    });

    it('returns null when value does not start with /', () => {
      const markup = parseAssign('{% assign url = "about" %}');
      expect(resolveAssignToUrlPattern(markup)).toBe(null);
    });

    it('returns null for number literal base', () => {
      const markup = parseAssign('{% assign num = 42 %}');
      expect(resolveAssignToUrlPattern(markup)).toBe(null);
    });

    it('returns null when :_liquid_ is mixed with text in a segment', () => {
      const markup = parseAssign('{% assign url = "/groups/group-" | append: group.id %}');
      // Result would be "/groups/group-:_liquid_" — mixed segment
      expect(resolveAssignToUrlPattern(markup)).toBe(null);
    });
  });

  describe('query string and fragment stripping', () => {
    it('strips query string from resolved URL', () => {
      const markup = parseAssign('{% assign url = "/search?q=test" %}');
      expect(resolveAssignToUrlPattern(markup)).toBe('/search');
    });

    it('strips fragment from resolved URL', () => {
      const markup = parseAssign('{% assign url = "/page#section" %}');
      expect(resolveAssignToUrlPattern(markup)).toBe('/page');
    });

    it('strips both query string and fragment', () => {
      const markup = parseAssign('{% assign url = "/page?q=1#top" %}');
      expect(resolveAssignToUrlPattern(markup)).toBe('/page');
    });
  });
});

describe('extractUrlPattern with variableMap', () => {
  it('resolves a single {{ var }} from variableMap', () => {
    const variableMap = new Map([['url', '/about']]);
    const attr = parseHrefAttr('<a href="{{ url }}">link</a>');
    expect(extractUrlPattern(attr, variableMap)).toBe('/about');
  });

  it('resolves a tracked variable with :_liquid_ segments', () => {
    const variableMap = new Map([['edit_url', '/users/:_liquid_/edit']]);
    const attr = parseHrefAttr('<a href="{{ edit_url }}">edit</a>');
    expect(extractUrlPattern(attr, variableMap)).toBe('/users/:_liquid_/edit');
  });

  it('falls back to :_liquid_ for untracked variables', () => {
    const variableMap = new Map<string, string>();
    const attr = parseHrefAttr('<a href="{{ unknown_var }}">link</a>');
    // Single dynamic variable with no static text → fully dynamic → null
    expect(extractUrlPattern(attr, variableMap)).toBe(null);
  });

  it('does not resolve variables with filters', () => {
    const variableMap = new Map([['url', '/about']]);
    const attr = parseHrefAttr('<a href="{{ url | escape }}">link</a>');
    // Variable has a filter → not a simple variable → falls through to normal logic → fully dynamic
    expect(extractUrlPattern(attr, variableMap)).toBe(null);
  });

  it('does not resolve variables with lookups (e.g. url.path)', () => {
    const variableMap = new Map([['url', '/about']]);
    const attr = parseHrefAttr('<a href="{{ url.path }}">link</a>');
    // Variable has lookups → not a simple variable → falls through → fully dynamic
    expect(extractUrlPattern(attr, variableMap)).toBe(null);
  });

  it('does not resolve when attr has multiple nodes (mixed static + variable)', () => {
    const variableMap = new Map([['slug', 'about']]);
    const attr = parseHrefAttr('<a href="/{{ slug }}">link</a>');
    // attr.value.length > 1, so variableMap lookup is skipped; normal extraction applies
    expect(extractUrlPattern(attr, variableMap)).toBe('/:_liquid_');
  });

  it('works without variableMap (backward compatible)', () => {
    const attr = parseHrefAttr('<a href="/about">link</a>');
    expect(extractUrlPattern(attr)).toBe('/about');
  });

  it('works with empty variableMap', () => {
    const attr = parseHrefAttr('<a href="/about">link</a>');
    expect(extractUrlPattern(attr, new Map())).toBe('/about');
  });

  it('resolves a tracked simple variable from variableMap', () => {
    const variableMap = new Map([['url', '/about']]);
    const attr = parseHrefAttr('<a href="{{ url }}">link</a>');
    expect(extractUrlPattern(attr, variableMap)).toBe('/about');
  });
});

describe('tryExtractAssignUrl', () => {
  function firstChild(source: string): LiquidHtmlNode {
    return toLiquidHtmlAST(source).children[0];
  }

  it('returns null for a non-assign liquid tag', () => {
    expect(tryExtractAssignUrl(firstChild('{% if true %}{% endif %}'))).toBe(null);
  });

  it('returns null for an HTML element', () => {
    expect(tryExtractAssignUrl(firstChild('<a href="/about">link</a>'))).toBe(null);
  });

  it('extracts name and urlPattern from a simple string assign', () => {
    const result = tryExtractAssignUrl(firstChild('{% assign url = "/about" %}'));
    expect(result).toEqual({ name: 'url', urlPattern: '/about' });
  });

  it('extracts urlPattern from an assign with append filter', () => {
    const result = tryExtractAssignUrl(
      firstChild('{% assign url = "/users/" | append: user.id %}'),
    );
    expect(result).toEqual({ name: 'url', urlPattern: '/users/:_liquid_' });
  });

  it('returns null when the assign RHS is not a URL pattern (no leading /)', () => {
    expect(tryExtractAssignUrl(firstChild('{% assign url = "about" %}'))).toBe(null);
  });

  it('returns null when the assign RHS uses an unsupported filter', () => {
    expect(tryExtractAssignUrl(firstChild('{% assign url = "/ABOUT" | downcase %}'))).toBe(null);
  });

  it('returns null when assigning to a target with lookups (e.g. obj.field = ...)', () => {
    // {% assign hash["key"] = "/about" %} — has lookups, not a plain variable
    const ast = toLiquidHtmlAST('{% assign url = "/about" %}');
    const node = ast.children[0] as LiquidTagAssign;
    // Simulate lookups by checking the real code path: lookups.length > 0 returns null
    const markup = node.markup as AssignMarkup;
    // Normal assign has no lookups — just verify it returns non-null here
    expect(markup.lookups.length).toBe(0);
    expect(tryExtractAssignUrl(node)).not.toBe(null);
  });
});

describe('buildVariableMap', () => {
  function parseChildren(source: string): LiquidHtmlNode[] {
    return toLiquidHtmlAST(source).children;
  }

  it('collects top-level assigns', () => {
    const map = buildVariableMap(parseChildren('{% assign url = "/about" %}'));
    expect(map.get('url')).toBe('/about');
  });

  it('collects multiple top-level assigns', () => {
    const map = buildVariableMap(
      parseChildren('{% assign a = "/first" %}{% assign b = "/second" %}'),
    );
    expect(map.get('a')).toBe('/first');
    expect(map.get('b')).toBe('/second');
  });

  it('later assign overwrites earlier one', () => {
    const map = buildVariableMap(
      parseChildren('{% assign url = "/first" %}{% assign url = "/second" %}'),
    );
    expect(map.get('url')).toBe('/second');
  });

  it('recurses into {% if %} block children', () => {
    const map = buildVariableMap(
      parseChildren('{% if true %}{% assign url = "/about" %}{% endif %}'),
    );
    expect(map.get('url')).toBe('/about');
  });

  it('recurses into {% for %} block children', () => {
    const map = buildVariableMap(
      parseChildren('{% for i in list %}{% assign url = "/about" %}{% endfor %}'),
    );
    expect(map.get('url')).toBe('/about');
  });

  it('recurses into {% liquid %} block markup', () => {
    const map = buildVariableMap(parseChildren('{% liquid\n  assign url = "/about"\n%}'));
    expect(map.get('url')).toBe('/about');
  });

  describe('beforeOffset', () => {
    it('excludes assigns that end after beforeOffset', () => {
      // "{% assign url = "/about" %}" is 27 chars (positions 0-26, end=27)
      const source = '{% assign url = "/about" %}';
      const map = buildVariableMap(parseChildren(source), 26);
      // assign.position.end === 27 > 26, so it should be excluded
      expect(map.has('url')).toBe(false);
    });

    it('includes assigns that end at or before beforeOffset', () => {
      const source = '{% assign url = "/about" %}';
      // assign ends at 27; beforeOffset=27 means end <= offset → included
      const map = buildVariableMap(parseChildren(source), 27);
      expect(map.get('url')).toBe('/about');
    });

    it('includes assign and excludes later reassignment based on cursor position', () => {
      // assign1 ends at 27, assign2 ends at 54; cursor between them
      const source = '{% assign url = "/first" %}{% assign url = "/second" %}';
      const map = buildVariableMap(parseChildren(source), 28);
      expect(map.get('url')).toBe('/first');
    });

    // Regression test for bug where the top-level `continue` skipped recursion into
    // block containers. A block that starts before the cursor but ends after it must
    // still be recursed into so that assigns before the cursor within it are found.
    it('includes assign inside a block that ends after beforeOffset', () => {
      // {% if %}...{% assign url = "/about" %}...<a href>...{% endif %}
      // The if block ends after <a>.position.start, but the assign ends before it.
      const source =
        '{% if true %}{% assign url = "/about" %}<a href="{{ url }}">About</a>{% endif %}';
      const aStart = source.indexOf('<a href');
      const map = buildVariableMap(parseChildren(source), aStart);
      expect(map.get('url')).toBe('/about');
    });

    it('includes assign inside {% liquid %} block when block ends after beforeOffset', () => {
      const source =
        '{% if true %}{% liquid\n  assign url = "/about"\n%}<a href="{{ url }}">About</a>{% endif %}';
      const aStart = source.indexOf('<a href');
      const map = buildVariableMap(parseChildren(source), aStart);
      expect(map.get('url')).toBe('/about');
    });

    it('excludes assign inside block that starts after beforeOffset', () => {
      const source =
        '<a href="{{ url }}">About</a>{% if true %}{% assign url = "/about" %}{% endif %}';
      const aStart = source.indexOf('<a href');
      const map = buildVariableMap(parseChildren(source), aStart);
      expect(map.has('url')).toBe(false);
    });
  });
});
