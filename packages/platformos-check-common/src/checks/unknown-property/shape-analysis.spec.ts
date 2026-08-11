import { LiquidHtmlNode, LiquidTag, toLiquidHtmlAST } from '@platformos/liquid-html-parser';
import { App } from '@platformos/platformos-common';
import { describe, expect, it } from 'vitest';

import { MockFileSystem } from '../../test/MockFileSystem';
import { sourceParsers } from '../../to-source-code';
import { SourceCodeType } from '../../types';
import { visit } from '../../visitor';
import { PropertyShape, getAvailableProperties } from './property-shape';
import { ShapeAnalyzerDeps, createShapeAnalyzer } from './shape-analysis';

/**
 * The partial-analysis memo, at the seam where its two consumers meet.
 *
 * It is a MODULE-LEVEL cache shared by every analyzer in the process, and there are two of
 * them: `UnknownProperty` builds one with no `resolveExternalShape`, and the language server
 * builds one with it. Neither package can see the other's analyzer, so the only place the
 * hazard is testable is here, against the deps interface both of them implement.
 *
 * Both halves of its freshness rule live here too, because they are alternatives on one code
 * path: an entry whose reads are app-backed revalidates by comparing `AppFile.revision`, and
 * one whose reads are not re-reads their content.
 */

/** A partial whose returned shape depends on a name only an external resolver can explain. */
const PARTIAL_SOURCE = `{% liquid
  assign out = {"u": context.current_user}
  return out
%}`;

/** What the docset knows about `context.current_user`, which no diagnostic is told. */
const CURRENT_USER_SHAPE: PropertyShape = {
  kind: 'object',
  properties: new Map<string, PropertyShape>([
    ['id', { kind: 'primitive', primitiveType: 'number' }],
    ['email', { kind: 'primitive', primitiveType: 'string' }],
  ]),
};

/** The shape `{% function result = '<partial>' %}` leaves on `result`. */
async function callerShape(
  deps: ShapeAnalyzerDeps,
  partial: string,
): Promise<PropertyShape | undefined> {
  const source = `{% function result = '${partial}' %}{{ result }}`;
  const analyzer = createShapeAnalyzer(deps);

  await visit<SourceCodeType.LiquidHtml, void>(toLiquidHtmlAST(source), {
    async LiquidTag(node: LiquidTag, ancestors: LiquidHtmlNode[]) {
      await analyzer.handleLiquidTag(node, ancestors);
    },
  });

  return analyzer.shapeAt('result', source.length);
}

/** What a consumer would offer or verify at `result.u.` — the difference the memo can lose. */
function propertiesUnderU(shape: PropertyShape | undefined): string[] {
  const u = shape?.properties?.get('u');
  return u ? getAvailableProperties(u) : [];
}

describe('Module: the partial-analysis memo', () => {
  interface Deps extends ShapeAnalyzerDeps {
    /** How many times a cache HIT revalidated — `isStale` is the only caller of `readContent`. */
    revalidations: number;
  }

  function depsFor(
    analysisIdentity: string,
    uri: string,
    resolveExternalShape?: ShapeAnalyzerDeps['resolveExternalShape'],
  ): Deps {
    const deps: Deps = {
      analysisIdentity,
      revalidations: 0,
      async readGraphQL() {
        return undefined;
      },
      async readPartial() {
        return { uri, source: PARTIAL_SOURCE, ast: toLiquidHtmlAST(PARTIAL_SOURCE) };
      },
      async readContent() {
        deps.revalidations++;
        return PARTIAL_SOURCE;
      },
      async getSchema() {
        return undefined;
      },
      resolveExternalShape,
    };
    return deps;
  }

  /**
   * The two consumers share ONE `analysisIdentity` on purpose, so the pair of tests below can
   * only pass on the segment of the key the cache folds in ITSELF — the presence of a
   * `resolveExternalShape`. Give them different identities and both pass with that segment
   * deleted, which is what the interface's "an invariant it enforces is one no consumer has to
   * remember" would then be promising with nothing behind it.
   *
   * The other direction — a differing `analysisIdentity` separating deps that are otherwise
   * identical — is pinned separately below.
   */
  const SHARED_IDENTITY = 'spec/analyzer';

  /**
   * The deps the editor builds: it can explain `context.current_user`. The resolver answers for
   * the WHOLE read, which is the seam's contract.
   */
  const editorDeps = (uri: string) =>
    depsFor(SHARED_IDENTITY, uri, (read) =>
      read.name === 'context' && read.lookups.length === 1 ? CURRENT_USER_SHAPE : undefined,
    );

  /** The deps a check builds: no resolver, so `context.current_user` is nothing it can see. */
  const checkDeps = (uri: string) => depsFor(SHARED_IDENTITY, uri);

  /**
   * Editor deps whose partial can be EDITED between calls, with both reads answering from the
   * one `source` — which is the freshness rule this cache runs on, since its key holds the
   * partial's URI and not its text.
   */
  function editableDeps(uri: string): Deps & { source: string } {
    const deps = {
      ...editorDeps(uri),
      source: PARTIAL_SOURCE,
      async readPartial() {
        return { uri, source: deps.source, ast: toLiquidHtmlAST(deps.source) };
      },
      async readContent() {
        deps.revalidations++;
        return deps.source;
      },
    };
    return deps;
  }

  const shapeOfShared = (deps: ShapeAnalyzerDeps) => callerShape(deps, 'queries/shared');

  /**
   * The same partial, the same URI, the same (absent) bindings, and no file changed between
   * the two calls — so `isStale` says nothing is stale and the entry is reused. What it may
   * NOT do is answer the second consumer with the first one's analysis.
   *
   * Asserted in BOTH orders, because the defect was order-dependent: whichever consumer ran
   * first won, so a fix that happened to suit one direction would pass a single-order test.
   * Each order gets its own URI, so the second pair starts from a cold entry rather than the
   * one the first pair left.
   */
  it('does not serve the check an analysis the editor computed', async () => {
    const uri = 'file:///app/lib/queries/editor-first.liquid';

    const editorFirst = await shapeOfShared(editorDeps(uri));
    const checkSecond = await shapeOfShared(checkDeps(uri));

    expect({
      editorFirst: propertiesUnderU(editorFirst),
      checkSecond: propertiesUnderU(checkSecond),
    }).toEqual({
      editorFirst: ['id', 'email'],
      checkSecond: [],
    });
  });

  it('does not serve the editor an analysis the check computed', async () => {
    const uri = 'file:///app/lib/queries/check-first.liquid';

    const checkFirst = await shapeOfShared(checkDeps(uri));
    const editorSecond = await shapeOfShared(editorDeps(uri));

    expect({
      checkFirst: propertiesUnderU(checkFirst),
      editorSecond: propertiesUnderU(editorSecond),
    }).toEqual({
      checkFirst: [],
      editorSecond: ['id', 'email'],
    });
  });

  /**
   * The control for both. One consumer asking TWICE must still hit the entry it left — and a
   * key that separated every call, which is the trivial way to pass the two tests above,
   * would make the memo dead code with nothing to notice.
   *
   * Counted through `readContent`, which only `isStale` calls and only on a HIT: two calls,
   * one revalidation, so exactly one of them was answered from the cache.
   */
  it('still reuses an entry for the same consumer, so the key is not merely unique', async () => {
    const deps = checkDeps('file:///app/lib/queries/reused.liquid');

    await shapeOfShared(deps);
    await shapeOfShared(deps);

    expect(deps.revalidations).toEqual(1);
  });

  /**
   * The OTHER half of `analysisIdentity`'s contract: a consumer-supplied string separates two
   * deps that the cache cannot tell apart by itself.
   *
   * Both of these have no resolver, so the segment the pair above exercises is identical —
   * only the identity differs. Counted through `readContent` rather than through the shape,
   * because two deps that answer alike produce the same shape whether they shared an entry or
   * not: the first call computes and revalidates nothing, so a second consumer that got its own
   * entry revalidates nothing either, and one that was served the first's revalidates once.
   */
  it('separates two consumers by analysisIdentity alone', async () => {
    const uri = 'file:///app/lib/queries/by-identity.liquid';
    const first = depsFor('spec/consumer-a', uri);
    const second = depsFor('spec/consumer-b', uri);

    await shapeOfShared(first);
    await shapeOfShared(second);

    expect({ first: first.revalidations, second: second.revalidations }).toEqual({
      first: 0,
      second: 0,
    });
  });

  /**
   * The key does not carry the partial's TEXT — deliberately, because `isStale` re-reads what
   * the analysis touched on every hit. That makes the re-read load-bearing rather than
   * belt-and-braces, and nothing pinned it: the two tests above hold a partial whose source
   * never changes, so both pass with the whole revalidation deleted.
   *
   * Edited HERE and not through an `App`, because this half of the freshness rule is exactly
   * that `readContent` and `readPartial` answer from the same place. A probe that edited a
   * file and let both reads find it would confirm the edit, not the rule; moving one and not
   * the other is what a stale answer actually looks like.
   */
  it('re-analyzes after the partial is edited, so the entry the key cannot see is not trusted', async () => {
    const deps = editableDeps('file:///app/lib/queries/edited.liquid');

    const before = await shapeOfShared(deps);
    deps.source = `{% liquid
  assign out = {"u": {"handle": "x"}}
  return out
%}`;
    const after = await shapeOfShared(deps);

    expect({
      before: propertiesUnderU(before),
      after: propertiesUnderU(after),
    }).toEqual({ before: ['id', 'email'], after: ['handle'] });
  });
});

/**
 * The other half: an entry whose reads are app-backed is revalidated by `AppFile.revision`
 * instead of by re-reading every file the analysis touched.
 *
 * The rule that replaces was a comment — "`readContent` MUST read from the same place
 * `readPartial` does" — and it had already been broken once, by a memo that revalidated from
 * disk while the analysis read the open editor buffer. A revision is compared, never read, so
 * there is no second read path left to disagree.
 */
describe('Module: the partial-analysis memo, revalidated by AppFile.revision', () => {
  const ROOT = 'file:///project';
  const PARTIAL = 'app/lib/queries/card.liquid';
  const PARTIAL_URI = `${ROOT}/${PARTIAL}`;

  const withEmail = `{% liquid
  assign out = {"u": {"email": "e"}}
  return out
%}`;

  const withHandle = `{% liquid
  assign out = {"u": {"handle": "h"}}
  return out
%}`;

  interface Deps extends ShapeAnalyzerDeps {
    /** Reads that went to CONTENT — the path a revision is supposed to make unnecessary. */
    contentReads: number;
  }

  /**
   * Deps backed by a real `App`, the way both consumers build them.
   *
   * `identity` is per TEST, because the memo is module-level and outlives each one: a test
   * that inherited the entry an earlier test left would be measuring that entry's history
   * rather than its own edit. One of these was written without it and passed with the
   * process-wide clock sabotaged into a per-file counter — it had nothing to detect.
   */
  function appDeps(app: App, identity: string): Deps {
    const deps: Deps = {
      analysisIdentity: `spec/revision/${identity}`,
      contentReads: 0,
      async readGraphQL() {
        return undefined;
      },
      async readPartial() {
        const file = app.get(PARTIAL_URI)!;
        await file.load();
        return { uri: file.uri, source: file.source, ast: file.ast as LiquidHtmlNode };
      },
      async readContent(uri: string) {
        deps.contentReads++;
        const file = app.get(uri);
        await file?.load();
        return file?.loadedSource;
      },
      revisionOf: (uri: string) => app.get(uri)?.revision,
      async getSchema() {
        return undefined;
      },
    };
    return deps;
  }

  const namesUnderU = async (deps: ShapeAnalyzerDeps) =>
    propertiesUnderU(await callerShape(deps, 'queries/card'));

  function appWith(source: string): App {
    const files = { [PARTIAL]: source };
    return App.fromSources(ROOT, files, new MockFileSystem(files, ROOT), sourceParsers);
  }

  it('re-analyzes after the partial is edited, without reading the file to find out', async () => {
    const app = appWith(withEmail);
    const deps = appDeps(app, 'edited');

    const before = await namesUnderU(deps);
    app.setSource(PARTIAL_URI, withHandle, 1);
    const after = await namesUnderU(deps);

    expect({ before, after, contentReads: deps.contentReads }).toEqual({
      before: ['email'],
      after: ['handle'],
      // The whole point: staleness was detected by comparing two numbers.
      contentReads: 0,
    });
  });

  /**
   * The control. A memo that recomputed every time would pass the test above, and would
   * make the cache dead code with nothing to notice — so an UNCHANGED file must still be
   * answered from the entry, and still without a read.
   */
  it('still answers an unchanged file from the entry, and still reads nothing', async () => {
    const app = appWith(withEmail);
    const deps = appDeps(app, 'unchanged');
    let parses = 0;
    const counting: Deps = {
      ...deps,
      async readPartial() {
        parses++;
        return deps.readPartial('');
      },
    };

    await namesUnderU(counting);
    await namesUnderU(counting);

    // Two calls, one analysis: the second was served by the memo. `readPartial` is called
    // per CALL SITE (it is what resolves the name), so it is not the counter for that —
    // the counter is that nothing was re-read to revalidate.
    expect({ parses, contentReads: deps.contentReads }).toEqual({ parses: 2, contentReads: 0 });
  });

  /**
   * `App.update` REPLACES the file object, and a per-file counter would restart at zero on
   * the replacement — so a recording made against the old file would compare equal to the
   * new one and be trusted. This is why the clock is process-wide.
   */
  it('treats a file replaced by App.update as changed, not as the same revision', async () => {
    const files: Record<string, string> = { [PARTIAL]: withEmail };
    const fs = new MockFileSystem(files, ROOT);
    const app = App.fromSources(ROOT, files, fs, sourceParsers);
    const deps = appDeps(app, 'replaced');

    const before = await namesUnderU(deps);
    files[PARTIAL] = withHandle;
    app.update([PARTIAL_URI]);
    const after = await namesUnderU(deps);

    expect({ before, after }).toEqual({ before: ['email'], after: ['handle'] });
  });
});
