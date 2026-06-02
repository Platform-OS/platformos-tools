/**
 * Per-check enrichment pins. The enricher composes:
 *   - check-name → hint template (with `{{var}}` placeholders resolved)
 *   - per-check suggestion text (LSP / docset-driven)
 *   - rule-engine attributions (rule_id, confidence, hover_docs)
 *
 * These tests are pure-function unit-grade: no LSP, no project map, no
 * docset fetch. Indexes are constructed via plain object stubs typed against
 * the public surface of each index class (no `private` field access — source
 * tests poked at `_loaded` / `_byName`, which TS rejects in v1).
 */

import { describe, it, expect } from 'vitest';
import { enrichError, enrichAll } from './error-enricher';
import type { FiltersIndex } from './filters-index';
import type { ObjectsIndex } from './objects-index';
import type { TagsIndex } from './tags-index';

function stubFiltersIndex(entries: Record<string, { syntax?: string; summary?: string }>): FiltersIndex {
  const map = new Map(Object.entries(entries));
  return {
    loaded: true,
    lookup: (name: string | null | undefined) => {
      if (!name) return null;
      const e = map.get(name);
      return e ? { name, category: '', syntax: e.syntax ?? '', summary: e.summary ?? '', parameters: [], platformOS: false, deprecated: false } : null;
    },
    closestMatch: (name: string | null | undefined) => {
      if (!name) return null;
      // Tiny Levenshtein-ish: return first registered name whose lowercase
      // shares a prefix or is one edit away. Sufficient for "jsn" → "json".
      const target = name.toLowerCase();
      let best: { name: string; syntax: string; summary: string } | null = null;
      for (const [k, v] of map) {
        const kl = k.toLowerCase();
        if (kl === target) continue;
        if (kl.startsWith(target.slice(0, 2)) || kl.includes(target)) {
          if (!best) best = { name: k, syntax: v.syntax ?? '', summary: v.summary ?? '' };
        }
      }
      return best
        ? { name: best.name, category: '', syntax: best.syntax, summary: best.summary, parameters: [], platformOS: false, deprecated: false }
        : null;
    },
  } as unknown as FiltersIndex;
}

function stubObjectsIndex(entries: Record<string, { handle: string; properties: string[] }>): ObjectsIndex {
  const map = new Map(Object.entries(entries));
  return {
    loaded: true,
    lookup: (name: string | null | undefined) => {
      if (!name) return null;
      const e = map.get(name);
      if (!e) return null;
      if (!e.handle || e.handle === name) return null;
      return { name, handle: e.handle, properties: e.properties };
    },
  } as unknown as ObjectsIndex;
}

function stubTagsIndex(names: string[]): TagsIndex {
  const set = new Set(names);
  return {
    isTag: (n: string | null | undefined) => !!n && set.has(n),
  } as unknown as TagsIndex;
}

describe('enrichError', () => {
  it('adds hint for known check name', async () => {
    const diagnostic = {
      check: 'UndefinedObject',
      severity: 'warning' as const,
      message: 'Unknown object "params" used.',
    };
    const result = await enrichError(diagnostic, { uri: 'file:///test.liquid' });
    expect(result.hint).toBeDefined();
    expect(result.hint).toContain('context');
  });

  it('returns null hint for unknown check name', async () => {
    const diagnostic = {
      check: 'NonExistentCheck',
      severity: 'error' as const,
      message: 'Something went wrong',
    };
    const result = await enrichError(diagnostic, { uri: 'file:///test.liquid' });
    expect(result.hint).toBeNull();
  });

  it('adds variant hint for UndefinedObject in partials', async () => {
    const diagnostic = {
      check: 'UndefinedObject',
      severity: 'warning' as const,
      message: 'Unknown object "product" used.',
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/partials/card.liquid',
    });
    expect(result.hint).toBeDefined();
  });

  it('enriches UnknownFilter with closest match from index', async () => {
    const filtersIndex = stubFiltersIndex({
      json: { syntax: '{{ obj | json }}', summary: 'Convert to JSON' },
      jsonify: { syntax: '{{ obj | jsonify }}', summary: 'JSON encode' },
    });
    const diagnostic = {
      check: 'UnknownFilter',
      severity: 'error' as const,
      message: 'Unknown filter `jsn` used.',
    };
    const result = await enrichError(diagnostic, { uri: 'file:///test.liquid', filtersIndex });
    expect(result.suggestion).toBeDefined();
    expect(result.suggestion).toContain('json');
  });

  it('enriches UndefinedObject with context suggestion from index', async () => {
    const objectsIndex = stubObjectsIndex({
      params: { handle: 'context.params', properties: ['slug', 'format', 'id'] },
    });
    const diagnostic = {
      check: 'UndefinedObject',
      severity: 'warning' as const,
      message: 'Unknown object "params" used.',
    };
    const result = await enrichError(diagnostic, { uri: 'file:///test.liquid', objectsIndex });
    expect(result.suggestion).toBeDefined();
    expect(result.suggestion).toContain('context.params');
  });

  it('detects tag-used-as-filter mistake', async () => {
    const filtersIndex = stubFiltersIndex({});
    const tagsIndex = stubTagsIndex(['background']);
    const diagnostic = {
      check: 'UnknownFilter',
      severity: 'error' as const,
      message: 'Unknown filter `background` used.',
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///test.liquid',
      filtersIndex,
      tagsIndex,
    });
    expect(result.suggestion).toContain('tag, not a filter');
    expect(result.suggestion).toContain('{% background');
  });
});

describe('MissingPartial hint template resolution', () => {
  it('resolves {{object}}, {{name}}, {{create_path}}, {{tag}} for a missing partial', async () => {
    const diagnostic = {
      check: 'MissingPartial',
      severity: 'error' as const,
      message: "Missing partial 'blog_posts/indexa'",
      line: 3,
      column: 3,
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/pages/index.html.liquid',
      content: "---\nslug: test\n---\n{% render 'blog_posts/indexa' %}",
    });
    expect(result.hint).toBeDefined();
    expect(result.hint).toContain('partial');
    expect(result.hint).toContain('blog_posts/indexa');
    expect(result.hint).toContain('app/views/partials/blog_posts/indexa.liquid');
    expect(result.hint).toContain('render');
    expect(result.hint).not.toContain('{{');
  });

  it('detects command type and resolves correct path', async () => {
    const diagnostic = {
      check: 'MissingPartial',
      severity: 'error' as const,
      message: "Missing partial 'commands/products/create'",
      line: 3,
      column: 3,
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/pages/test.html.liquid',
      content:
        "---\nslug: test\n---\n{% function result = 'commands/products/create', params: context.params %}",
    });
    expect(result.hint).toContain('command');
    expect(result.hint).toContain('app/lib/commands/products/create.liquid');
    expect(result.hint).toContain('function');
    expect(result.hint).not.toContain('{{');
  });

  it('detects query type and resolves correct path', async () => {
    const diagnostic = {
      check: 'MissingPartial',
      severity: 'error' as const,
      message: "Missing partial 'queries/products/search'",
      line: 3,
      column: 3,
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/pages/test.html.liquid',
      content:
        "---\nslug: test\n---\n{% function result = 'queries/products/search', query_params: context.params %}",
    });
    expect(result.hint).toContain('query');
    expect(result.hint).toContain('app/lib/queries/products/search.liquid');
    expect(result.hint).toContain('function');
    expect(result.hint).not.toContain('{{');
  });

  it('flags `lib/` prefix as invalid and points at the corrected path', async () => {
    const diagnostic = {
      check: 'MissingPartial',
      severity: 'error' as const,
      message: "'lib/commands/products/create' does not exist",
      line: 3,
      column: 3,
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/pages/test.html.liquid',
      content:
        "---\nslug: test\n---\n{% function result = 'lib/commands/products/create', params: context.params %}",
    });
    expect(result.hint).toContain('lib/commands/products/create');
    expect(result.hint).toContain('commands/products/create');
    expect(result.hint).toContain('app/lib/commands/products/create.liquid');
    expect(result.hint).not.toMatch(/STEP 2 — Create/);
    expect(result.hint).toMatch(/lib\/[^\s]+ is not a valid path|drop the `lib\/` prefix/i);
    expect(result.hint).not.toContain('{{');
  });

  it('uses module variant hint for module paths — references project_map, no create path', async () => {
    const diagnostic = {
      check: 'MissingPartial',
      severity: 'error' as const,
      message: "Missing partial 'modules/payments/helpers/format_price'",
      line: 3,
      column: 3,
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/pages/test.html.liquid',
      content:
        "---\nslug: test\n---\n{% render 'modules/payments/helpers/format_price' %}",
    });
    expect(result.hint).toContain('modules/payments/helpers/format_price');
    expect(result.hint).toContain('project_map');
    expect(result.hint).not.toContain('Create');
    expect(result.hint).not.toMatch(/install (the )?module/);
    expect(result.hint).not.toMatch(/\{\{[a-z_]+\}\}/);
  });
});

describe('UndefinedObject hint template resolution', () => {
  it('resolves {{var_name}} in page context', async () => {
    const diagnostic = {
      check: 'UndefinedObject',
      severity: 'warning' as const,
      message: 'Unknown object "product" used.',
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/pages/index.html.liquid',
    });
    expect(result.hint).toBeDefined();
    expect(result.hint).toContain('product');
    expect(result.hint).not.toMatch(/\{\{[a-z_]+\}\}/);
  });

  it('resolves {{var_name}} in partial variant', async () => {
    const diagnostic = {
      check: 'UndefinedObject',
      severity: 'warning' as const,
      message: 'Unknown object "title" used.',
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/partials/card.html.liquid',
    });
    expect(result.hint).toBeDefined();
    expect(result.hint).toContain('title');
    expect(result.hint).not.toMatch(/\{\{[a-z_]+\}\}/);
  });
});

describe('TranslationKeyExists hint template resolution', () => {
  it('resolves {{key}}, {{yaml_snippet}}, {{yaml_path_comment}} for a scoped key', async () => {
    const diagnostic = {
      check: 'TranslationKeyExists',
      severity: 'error' as const,
      message: "Translation key 'products.create.title' not found.",
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/pages/products.html.liquid',
    });
    expect(result.hint).toBeDefined();
    expect(result.hint).toContain('products.create.title');
    expect(result.hint).toContain('products > create > title');
    expect(result.hint).toContain('en:');
    expect(result.hint).toContain('products:');
    expect(result.hint).toContain('create:');
    expect(result.hint).toContain('title:');
    expect(result.hint).not.toMatch(/\{\{[a-z_]+\}\}/);
  });

  it('resolves {{key}} and generates flat yaml snippet for top-level key', async () => {
    const diagnostic = {
      check: 'TranslationKeyExists',
      severity: 'error' as const,
      message: "Translation key 'welcome' not found.",
    };
    const result = await enrichError(diagnostic, {
      uri: 'file:///app/views/pages/index.html.liquid',
    });
    expect(result.hint).toContain('welcome');
    expect(result.hint).toContain('en:');
    expect(result.hint).not.toContain(' > '); // flat key has no path separator
    expect(result.hint).not.toMatch(/\{\{[a-z_]+\}\}/);
  });
});

describe('enrichAll', () => {
  it('enriches multiple diagnostics', async () => {
    const diagnostics = [
      { check: 'UndefinedObject', severity: 'warning' as const, message: 'Unknown object "params" used.' },
      { check: 'UnknownFilter', severity: 'error' as const, message: 'Unknown filter "bad" used.' },
    ];
    const results = await enrichAll(diagnostics, { uri: 'file:///test.liquid' });
    expect(results).toHaveLength(2);
    expect(results[0]!.hint).toBeDefined();
    expect(results[1]!.hint).toBeDefined();
  });
});

describe('conditional hint rendering', () => {
  it('resolves {{#if has_suggestion}} conditional in UndefinedObject hint', async () => {
    const objectsIndex = stubObjectsIndex({
      params: { handle: 'context.params', properties: ['slug', 'id'] },
    });
    const diagnostic = {
      check: 'UndefinedObject',
      severity: 'warning' as const,
      message: 'Unknown object "params" used.',
    };
    const result = await enrichError(diagnostic, { uri: 'file:///test.liquid', objectsIndex });
    expect(result.hint).toContain('APPLY'); // has_suggestion branch
    expect(result.hint).not.toContain('NO suggestion');
    expect(result.hint).not.toMatch(/\{\{[a-z_]+\}\}/);
  });

  it('resolves {{filter_name}} in UnknownFilter hint', async () => {
    const filtersIndex = stubFiltersIndex({});
    const diagnostic = {
      check: 'UnknownFilter',
      severity: 'error' as const,
      message: 'Unknown filter `badfilter` used.',
    };
    const result = await enrichError(diagnostic, { uri: 'file:///test.liquid', filtersIndex });
    expect(result.hint).toBeDefined();
    expect(result.hint).toContain('badfilter');
    expect(result.hint).not.toMatch(/\{\{[a-z_]+\}\}/);
  });
});
