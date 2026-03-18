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
