/**
 * Bridge rules onto late-push diagnostics.
 *
 * Structural warnings, schema validators, diff-aware checks, and the
 * new-partial caller check are pushed into `result.errors/warnings` AFTER
 * `enrichAll` returns. Their rule modules never fire unless something runs
 * the engine on them again. `bridgeRulesOntoUnattributed` is that bridge.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { clearRules, registerRule, registerRules } from './rules/engine';
import {
  bridgeRulesOntoUnattributed,
  type EnrichContext,
  type BridgeResult,
} from './error-enricher';
import { rules as NonGetRenderingPageRules } from './rules/NonGetRenderingPage';
import { buildFactGraph } from './project-fact-graph';
import type { FiltersIndex } from './filters-index';
import type { ObjectsIndex } from './objects-index';
import type { TagsIndex } from './tags-index';
import type { ProjectMap } from './project-scanner';

function resetEngine() {
  // `clearRules()` resets both the registry AND the force-disable set —
  // matches the destination engine's documented "safe default" semantics.
  clearRules();
}

beforeEach(resetEngine);
afterEach(resetEngine);

function emptyProjectMap(): ProjectMap {
  return {
    project: { directory: '/tmp/empty', environments: [], modules: [], has_config: false },
    pages: {},
    partials: {},
    commands: {},
    queries: {},
    graphql: {},
    schema: {},
    layouts: {},
    translations: {},
    assets: [],
    summary: {
      file_counts: {},
      resources: {},
    },
  };
}

const ctx: EnrichContext = {
  uri: 'file:///tmp/x.liquid',
  filePath: 'app/views/pages/x.liquid',
  content: '',
  factGraph: buildFactGraph(emptyProjectMap()),
  filtersIndex: {
    loaded: true,
    lookup: () => null,
    closestMatch: () => null,
  } as unknown as FiltersIndex,
  objectsIndex: { loaded: true, lookup: () => null } as unknown as ObjectsIndex,
  tagsIndex: { isTag: () => false } as unknown as TagsIndex,
};

describe('bridgeRulesOntoUnattributed', () => {
  test('applies registered rule to a structural diagnostic with no prior rule_id', () => {
    registerRules(NonGetRenderingPageRules);
    const result: BridgeResult = {
      errors: [],
      warnings: [
        {
          check: 'pos-supervisor:NonGetRenderingPage',
          severity: 'warning',
          message:
            'Page has `method: post` but renders HTML (layout, partials, or `{{ ... }}` output).',
          line: 1,
        },
      ],
      infos: [],
    };
    bridgeRulesOntoUnattributed(result, ctx);
    const w = result.warnings[0]!;
    expect(w.rule_id).toBe('NonGetRenderingPage.html_on_post');
    expect(w.confidence).toBe(0.9);
    expect(w.hint).toMatch(/method: post/i);
  });

  test('skips diagnostics that already carry a rule_id (idempotent)', () => {
    registerRules(NonGetRenderingPageRules);
    const result: BridgeResult = {
      errors: [],
      warnings: [
        {
          check: 'pos-supervisor:NonGetRenderingPage',
          severity: 'warning',
          message: 'already stamped',
          rule_id: 'explicit.override',
          hint: 'explicit hint',
        },
      ],
      infos: [],
    };
    bridgeRulesOntoUnattributed(result, ctx);
    expect(result.warnings[0]!.rule_id).toBe('explicit.override');
    expect(result.warnings[0]!.hint).toBe('explicit hint');
  });

  test('no-op when check has no registered rule module', () => {
    const result: BridgeResult = {
      errors: [],
      warnings: [
        { check: 'pos-supervisor:SomeCheckWithNoRule', severity: 'warning', message: '...' },
      ],
      infos: [],
    };
    bridgeRulesOntoUnattributed(result, ctx);
    expect(result.warnings[0]!.rule_id).toBeUndefined();
  });

  test('no-op when factGraph is missing (guard against partial boot)', () => {
    registerRules(NonGetRenderingPageRules);
    const result: BridgeResult = {
      errors: [],
      warnings: [
        { check: 'pos-supervisor:NonGetRenderingPage', severity: 'warning', message: '...' },
      ],
      infos: [],
    };
    bridgeRulesOntoUnattributed(result, { ...ctx, factGraph: undefined });
    expect(result.warnings[0]!.rule_id).toBeUndefined();
  });

  test('applies to errors and infos too, not just warnings', () => {
    registerRule({
      id: 'SampleRule.default',
      check: 'SampleCheck',
      priority: 100,
      when: () => true,
      apply: () => ({ rule_id: 'SampleRule.default', hint_md: 'hi', fixes: [], confidence: 0.5 }),
    });
    const result: BridgeResult = {
      errors: [{ check: 'SampleCheck', severity: 'error', message: 'boom' }],
      warnings: [{ check: 'SampleCheck', severity: 'warning', message: 'boom' }],
      infos: [{ check: 'SampleCheck', severity: 'info', message: 'boom' }],
    };
    bridgeRulesOntoUnattributed(result, ctx);
    expect(result.errors[0]!.rule_id).toBe('SampleRule.default');
    expect(result.warnings[0]!.rule_id).toBe('SampleRule.default');
    expect(result.infos[0]!.rule_id).toBe('SampleRule.default');
  });

  test('rule that throws does not crash the bridge (non-fatal)', () => {
    registerRule({
      id: 'Explosive.default',
      check: 'Explosive',
      priority: 100,
      when: () => true,
      apply: () => {
        throw new Error('boom');
      },
    });
    const result: BridgeResult = {
      errors: [],
      warnings: [{ check: 'Explosive', severity: 'warning', message: '...' }],
      infos: [],
    };
    // Must not throw.
    bridgeRulesOntoUnattributed(result, ctx);
    // Diagnostic stays unattributed — safer than half-attributed.
    expect(result.warnings[0]!.rule_id).toBeUndefined();
  });
});
