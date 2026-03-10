# Upstream Proposals Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement 7 developer-tooling improvements across `platformos-check-common` and `platformos-language-server-common` in priority order.

**Architecture:** Sequential independent tasks — each item is a self-contained new check or LSP feature. Shared utilities (`levenshtein`, `flattenTranslationKeys`) are introduced in Task 1 and reused in Task 5. New `graphql-language-service` dependency added in Task 6.

**Tech Stack:** TypeScript, Vitest, Ohm.js AST, vscode-languageserver protocol, graphql-language-service

**Design doc:** `docs/plans/2026-03-10-upstream-proposals-design.md`

---

## Task 1: TranslationKeyExists — nearest-key suggestion (#4)

**Files:**
- Create: `packages/platformos-check-common/src/utils/levenshtein.ts`
- Modify: `packages/platformos-check-common/src/checks/translation-key-exists/index.ts`
- Modify: `packages/platformos-check-common/src/checks/translation-key-exists/index.spec.ts`

### Step 1: Write the failing test

Add to `packages/platformos-check-common/src/checks/translation-key-exists/index.spec.ts`:

```ts
it('should suggest nearest key when the key is a typo', async () => {
  const offenses = await check(
    {
      'app/translations/en.yml': 'en:\n  general:\n    title: Hello',
      'code.liquid': `{{"general.titel" | t}}`,
    },
    [TranslationKeyExists],
  );

  expect(offenses).to.have.length(1);
  expect(offenses[0].suggest).to.have.length(1);
  expect(offenses[0].suggest![0].message).to.include('general.title');
});

it('should not add suggestions when there is no close key', async () => {
  const offenses = await check(
    {
      'app/translations/en.yml': 'en:\n  general:\n    title: Hello',
      'code.liquid': `{{"completely.different.xyz" | t}}`,
    },
    [TranslationKeyExists],
  );

  expect(offenses).to.have.length(1);
  expect(offenses[0].suggest ?? []).to.have.length(0);
});
```

### Step 2: Run test to verify it fails

```bash
yarn workspace @platformos/platformos-check-common test src/checks/translation-key-exists/index.spec.ts
```

Expected: FAIL — `offenses[0].suggest` is undefined.

### Step 3: Create levenshtein utility

Create `packages/platformos-check-common/src/utils/levenshtein.ts`:

```ts
export function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

export function flattenTranslationKeys(
  obj: Record<string, any>,
  prefix = '',
): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) {
      keys.push(...flattenTranslationKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

export function findNearestKeys(
  missingKey: string,
  allKeys: string[],
  maxDistance = 3,
  maxResults = 3,
): string[] {
  return allKeys
    .map((key) => ({ key, distance: levenshtein(missingKey, key) }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxResults)
    .map(({ key }) => key);
}
```

### Step 4: Modify TranslationKeyExists check

In `packages/platformos-check-common/src/checks/translation-key-exists/index.ts`, add these imports at the top:

```ts
import { Utils } from 'vscode-uri';
import { flattenTranslationKeys, findNearestKeys } from '../../utils/levenshtein';
```

Replace the `onCodePathEnd` method with:

```ts
async onCodePathEnd() {
  let allDefinedKeys: string[] | null = null;

  for (const { translationKey, startIndex, endIndex } of nodes) {
    const translation = await translationProvider.translate(
      URI.parse(context.config.rootUri),
      translationKey,
    );

    if (!!translation) {
      continue;
    }

    // Lazy-load all keys once per file
    if (allDefinedKeys === null) {
      const baseUri = Utils.joinPath(URI.parse(context.config.rootUri), 'app/translations');
      const allTranslations = await translationProvider.loadAllTranslationsForBase(
        baseUri,
        'en',
      );
      allDefinedKeys = flattenTranslationKeys(allTranslations);
    }

    const nearest = findNearestKeys(translationKey, allDefinedKeys);

    context.report({
      message: `'${translationKey}' does not have a matching translation entry`,
      startIndex,
      endIndex,
      suggest: nearest.map((key) => ({
        message: `Did you mean '${key}'?`,
        fix: (fixer: any) => fixer.replace(startIndex, endIndex, `'${key}'`),
      })),
    });
  }
},
```

### Step 5: Run test to verify it passes

```bash
yarn workspace @platformos/platformos-check-common test src/checks/translation-key-exists/index.spec.ts
```

Expected: PASS

### Step 6: Type-check

```bash
yarn workspace @platformos/platformos-check-common type-check
```

Expected: no errors.

### Step 7: Commit

```bash
git add packages/platformos-check-common/src/utils/levenshtein.ts \
        packages/platformos-check-common/src/checks/translation-key-exists/index.ts \
        packages/platformos-check-common/src/checks/translation-key-exists/index.spec.ts
git commit -m "feat(check): add nearest-key suggestions to TranslationKeyExists

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: NestedGraphQLQuery — new check (#1)

**Files:**
- Create: `packages/platformos-check-common/src/checks/nested-graphql-query/index.ts`
- Create: `packages/platformos-check-common/src/checks/nested-graphql-query/index.spec.ts`
- Modify: `packages/platformos-check-common/src/checks/index.ts`

### Step 1: Write the failing tests

Create `packages/platformos-check-common/src/checks/nested-graphql-query/index.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runLiquidCheck } from '../../test';
import { NestedGraphQLQuery } from '.';

describe('Module: NestedGraphQLQuery', () => {
  it('should not report graphql outside a loop', async () => {
    const offenses = await runLiquidCheck(
      NestedGraphQLQuery,
      `{% graphql result = 'products/list' %}`,
    );
    expect(offenses).to.have.length(0);
  });

  it('should report graphql inside a for loop', async () => {
    const offenses = await runLiquidCheck(
      NestedGraphQLQuery,
      `{% for item in items %}{% graphql result = 'products/get' %}{% endfor %}`,
    );
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.include('N+1');
    expect(offenses[0].message).to.include('for');
  });

  it('should report graphql inside a tablerow loop', async () => {
    const offenses = await runLiquidCheck(
      NestedGraphQLQuery,
      `{% tablerow item in items %}{% graphql result = 'products/get' %}{% endtablerow %}`,
    );
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.include('tablerow');
  });

  it('should report graphql inside nested loops', async () => {
    const offenses = await runLiquidCheck(
      NestedGraphQLQuery,
      `{% for a in items %}{% for b in a.children %}{% graphql result = 'foo' %}{% endfor %}{% endfor %}`,
    );
    expect(offenses).to.have.length(1);
  });

  it('should report INFO (not WARNING) when inside both a loop and cache', async () => {
    const offenses = await runLiquidCheck(
      NestedGraphQLQuery,
      `{% for item in items %}{% cache 'key' %}{% graphql result = 'foo' %}{% endcache %}{% endfor %}`,
    );
    expect(offenses).to.have.length(1);
    expect(offenses[0].severity).to.equal(1); // Severity.INFO = 1
  });

  it('should not report background tag inside a loop', async () => {
    const offenses = await runLiquidCheck(
      NestedGraphQLQuery,
      `{% for item in items %}{% background %}{% graphql result = 'foo' %}{% endbackground %}{% endfor %}`,
    );
    // background tag is async — not flagged
    expect(offenses).to.have.length(0);
  });
});
```

### Step 2: Run tests to verify they fail

```bash
yarn workspace @platformos/platformos-check-common test src/checks/nested-graphql-query/index.spec.ts
```

Expected: FAIL — module not found.

### Step 3: Create the check

Create `packages/platformos-check-common/src/checks/nested-graphql-query/index.ts`:

```ts
import { NamedTags, NodeTypes, LiquidTag, LiquidHtmlNode } from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';

export const NestedGraphQLQuery: LiquidCheckDefinition = {
  meta: {
    code: 'NestedGraphQLQuery',
    name: 'GraphQL query inside a loop',
    docs: {
      description:
        'A {% graphql %} tag inside a {% for %} or {% tablerow %} loop executes one database request per iteration (N+1 pattern). Move the query before the loop and pass results as a variable.',
      recommended: true,
      url: 'https://documentation.platformos.com/best-practices/performance/graphql-in-loops',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    const loopStack: string[] = [];

    function isInsideBackgroundTag(ancestors: LiquidHtmlNode[]): boolean {
      return ancestors.some(
        (a) => a.type === NodeTypes.LiquidTag && (a as LiquidTag).name === 'background',
      );
    }

    function isInsideCacheTag(ancestors: LiquidHtmlNode[]): boolean {
      return ancestors.some(
        (a) => a.type === NodeTypes.LiquidTag && (a as LiquidTag).name === 'cache',
      );
    }

    return {
      async LiquidTag(node: LiquidTag, ancestors: LiquidHtmlNode[]) {
        if (node.name === NamedTags.for || node.name === NamedTags.tablerow) {
          loopStack.push(node.name);
          return;
        }

        if (node.name !== NamedTags.graphql) return;
        if (loopStack.length === 0) return;
        if (isInsideBackgroundTag(ancestors)) return;

        const outerLoop = loopStack[loopStack.length - 1];
        const markup = node.markup;
        const resultVar =
          typeof markup === 'object' && markup.type === NodeTypes.GraphQLMarkup
            ? markup.name
            : null;

        const severity = isInsideCacheTag(ancestors) ? Severity.INFO : Severity.WARNING;

        context.report({
          message:
            `N+1 pattern: {% graphql ${resultVar ? resultVar + ' = ' : ''}... %} ` +
            `is inside a {% ${outerLoop} %} loop. ` +
            `This executes one database request per iteration. ` +
            `Move the query before the loop and pass data as a variable.`,
          startIndex: node.position.start,
          endIndex: node.position.end,
          severity,
        });
      },

      async 'LiquidTag:exit'(node: LiquidTag) {
        if (node.name === NamedTags.for || node.name === NamedTags.tablerow) {
          loopStack.pop();
        }
      },
    };
  },
};
```

### Step 4: Register in allChecks

In `packages/platformos-check-common/src/checks/index.ts`, add:

```ts
import { NestedGraphQLQuery } from './nested-graphql-query';
```

And add `NestedGraphQLQuery` to the `allChecks` array.

### Step 5: Run tests to verify they pass

```bash
yarn workspace @platformos/platformos-check-common test src/checks/nested-graphql-query/index.spec.ts
```

Expected: PASS

### Step 6: Type-check

```bash
yarn workspace @platformos/platformos-check-common type-check
```

Expected: no errors. Fix any type issues around `LiquidTag` node casting.

### Step 7: Commit

```bash
git add packages/platformos-check-common/src/checks/nested-graphql-query/ \
        packages/platformos-check-common/src/checks/index.ts
git commit -m "feat(check): add NestedGraphQLQuery check for N+1 detection

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Circular render detection — LSP diagnostic (#8)

**Files:**
- Modify: `packages/platformos-language-server-common/src/server/AppGraphManager.ts`
- Modify: `packages/platformos-language-server-common/src/server/startServer.spec.ts`

### Step 1: Write the failing test

Read `packages/platformos-language-server-common/src/server/startServer.spec.ts` first to understand the `MockApp` / `MockConnection` / `startServer` test scaffolding. Then add a new `describe` block for cycle detection:

```ts
describe('circular render detection', () => {
  it('should publish an error diagnostic when a render cycle is detected', async () => {
    fileTree = {
      '.pos': '',
      'app/views/partials/a.liquid': `{% render 'b' %}`,
      'app/views/partials/b.liquid': `{% render 'a' %}`,
    };
    dependencies = getDependencies(logger, fileTree);
    startServer(connection, dependencies);
    connection.setup();
    await flushAsync();

    // Open a file to trigger graph build
    connection.openDocument('app/views/partials/a.liquid', `{% render 'b' %}`);
    await flushAsync();
    vi.runAllTimers();
    await flushAsync();

    const diagCalls = connection.spies.sendNotification.mock.calls.filter(
      ([method]: [string]) => method === PublishDiagnosticsNotification.method,
    );
    const cycleDiag = diagCalls.find(([, params]: [string, any]) =>
      params.diagnostics?.some((d: any) => d.message?.includes('Circular render')),
    );
    expect(cycleDiag).toBeDefined();
  });

  it('should clear cycle diagnostics when the cycle is resolved', async () => {
    // Start with a cycle
    fileTree = {
      '.pos': '',
      'app/views/partials/a.liquid': `{% render 'b' %}`,
      'app/views/partials/b.liquid': `{% render 'a' %}`,
    };
    dependencies = getDependencies(logger, fileTree);
    startServer(connection, dependencies);
    connection.setup();
    await flushAsync();

    connection.openDocument('app/views/partials/a.liquid', `{% render 'b' %}`);
    await flushAsync();
    vi.runAllTimers();
    await flushAsync();

    // Resolve the cycle
    connection.changeDocument('app/views/partials/b.liquid', `<p>no render</p>`, 1);
    await flushAsync();
    vi.runAllTimers();
    await flushAsync();

    const diagCalls = connection.spies.sendNotification.mock.calls.filter(
      ([method]: [string]) => method === PublishDiagnosticsNotification.method,
    );
    // Last diagnostic publish for b.liquid should have empty diagnostics
    const lastBDiag = [...diagCalls]
      .reverse()
      .find(([, params]: [string, any]) =>
        params.uri?.includes('b.liquid'),
      );
    expect(lastBDiag?.[1].diagnostics).toHaveLength(0);
  });
});
```

### Step 2: Run test to verify it fails

```bash
yarn workspace @platformos/platformos-language-server-common test src/server/startServer.spec.ts
```

Expected: FAIL — no cycle diagnostics published.

### Step 3: Add cycle detection to AppGraphManager

In `packages/platformos-language-server-common/src/server/AppGraphManager.ts`, add the private cycle detection method and call it at the end of `processQueue`:

```ts
private detectCycles(modules: Record<string, { dependencies: { target: { uri: string } }[] }>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  const dfs = (node: string, path: string[]) => {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      cycles.push(path.slice(cycleStart).concat(node));
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    for (const dep of (modules[node]?.dependencies ?? [])) {
      dfs(dep.target.uri, path);
    }

    path.pop();
    inStack.delete(node);
  };

  for (const uri of Object.keys(modules)) {
    if (!visited.has(uri)) dfs(uri, []);
  }

  return cycles;
}

private async detectAndPublishCycles(rootUri: string) {
  const graph = await this.graphs.get(rootUri);
  if (!graph) return;

  const cycles = this.detectCycles(graph.modules);

  // Clear previous cycle diagnostics if no cycles
  if (cycles.length === 0) {
    // Clearing is handled by normal diagnostics flow
    return;
  }

  for (const cycle of cycles) {
    // The closing edge is the last URI in the cycle — find its render tag back to cycle[0]
    const closingUri = cycle[cycle.length - 2]; // last file before the cycle wraps
    const cyclePath = cycle
      .slice(0, -1) // remove duplicate tail
      .map((uri) => uri.split('/').slice(-2).join('/'))
      .join(' → ');

    this.connection.sendDiagnostics({
      uri: closingUri,
      diagnostics: [
        {
          severity: 1, // DiagnosticSeverity.Error
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          message: `Circular render detected: ${cyclePath}\nThis will cause an infinite loop at runtime.`,
          source: 'platformos-check',
        },
      ],
    });
  }
}
```

Then at the end of the `processQueue` debounced function, after the graph is rebuilt, add:

```ts
await this.detectAndPublishCycles(rootUri);
```

**Note:** `connection.sendDiagnostics` is `connection.sendNotification(PublishDiagnosticsNotification.method, params)` under the hood — check the exact API on the `Connection` type and use whichever is available (`sendDiagnostics` or `sendNotification`).

### Step 4: Run tests to verify they pass

```bash
yarn workspace @platformos/platformos-language-server-common test src/server/startServer.spec.ts
```

Expected: PASS. If the API surface for `sendDiagnostics` is wrong, inspect the `Connection` type and adjust.

### Step 5: Type-check

```bash
yarn workspace @platformos/platformos-language-server-common type-check
```

Expected: no errors.

### Step 6: Commit

```bash
git add packages/platformos-language-server-common/src/server/AppGraphManager.ts \
        packages/platformos-language-server-common/src/server/startServer.spec.ts
git commit -m "feat(lsp): detect and publish circular render diagnostics

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: MissingRenderPartialArguments — new check (#2)

**Files:**
- Create: `packages/platformos-check-common/src/checks/missing-render-partial-arguments/index.ts`
- Create: `packages/platformos-check-common/src/checks/missing-render-partial-arguments/index.spec.ts`
- Modify: `packages/platformos-check-common/src/checks/index.ts`

### Step 1: Write the failing tests

Create `packages/platformos-check-common/src/checks/missing-render-partial-arguments/index.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applySuggestions, runLiquidCheck } from '../../test';
import { MissingRenderPartialArguments } from '.';

function check(partial: string, source: string) {
  return runLiquidCheck(
    MissingRenderPartialArguments,
    source,
    undefined,
    {},
    { 'app/views/partials/card.liquid': partial },
  );
}

const partialWithRequiredParams = `
{% doc %}
  @param {string} title - The card title
  @param {string} [subtitle] - Optional subtitle
{% enddoc %}
`;

describe('Module: MissingRenderPartialArguments', () => {
  it('should not report when partial has no LiquidDoc', async () => {
    const offenses = await check('<h1>card</h1>', `{% render 'card' %}`);
    expect(offenses).to.have.length(0);
  });

  it('should not report when all required params are provided', async () => {
    const offenses = await check(
      partialWithRequiredParams,
      `{% render 'card', title: 'Hello' %}`,
    );
    expect(offenses).to.have.length(0);
  });

  it('should not report for missing optional params', async () => {
    const offenses = await check(
      partialWithRequiredParams,
      `{% render 'card', title: 'Hello' %}`,
    );
    expect(offenses).to.have.length(0);
  });

  it('should report ERROR when a required param is missing', async () => {
    const offenses = await check(partialWithRequiredParams, `{% render 'card' %}`);
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.include("title");
    expect(offenses[0].message).to.include("card");
  });

  it('should suggest adding the missing required param', async () => {
    const source = `{% render 'card' %}`;
    const offenses = await check(partialWithRequiredParams, source);
    expect(offenses[0].suggest).to.have.length(1);
    expect(offenses[0].suggest![0].message).to.include("title");
    const fixed = applySuggestions(source, offenses[0]);
    expect(fixed[0]).to.include('title');
  });

  it('should report one ERROR per missing required param', async () => {
    const partial = `
      {% doc %}
        @param {string} title - title
        @param {string} body - body
      {% enddoc %}
    `;
    const offenses = await check(partial, `{% render 'card' %}`);
    expect(offenses).to.have.length(2);
  });

  it('should not report for dynamic partials', async () => {
    const offenses = await runLiquidCheck(
      MissingRenderPartialArguments,
      `{% render partial_name %}`,
    );
    expect(offenses).to.have.length(0);
  });
});
```

### Step 2: Run tests to verify they fail

```bash
yarn workspace @platformos/platformos-check-common test src/checks/missing-render-partial-arguments/index.spec.ts
```

Expected: FAIL — module not found.

### Step 3: Create the check

Create `packages/platformos-check-common/src/checks/missing-render-partial-arguments/index.ts`:

```ts
import { RenderMarkup } from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import {
  getLiquidDocParams,
  getPartialName,
  reportMissingArguments,
} from '../../liquid-doc/arguments';

export const MissingRenderPartialArguments: LiquidCheckDefinition = {
  meta: {
    code: 'MissingRenderPartialArguments',
    name: 'Missing Required Render Partial Arguments',
    aliases: ['MissingRenderPartialParams'],
    docs: {
      description:
        'This check ensures that all required @param arguments declared by a partial are provided at the call site.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/missing-render-partial-arguments',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async RenderMarkup(node: RenderMarkup) {
        const partialName = getPartialName(node);
        if (!partialName) return;

        const liquidDocParameters = await getLiquidDocParams(context, partialName);
        if (!liquidDocParameters) return;

        const providedNames = new Set(node.args.map((a) => a.name));
        const missingRequired = [...liquidDocParameters.values()].filter(
          (p) => p.required && !providedNames.has(p.name),
        );

        reportMissingArguments(context, node, missingRequired, partialName);
      },
    };
  },
};
```

### Step 4: Register in allChecks

In `packages/platformos-check-common/src/checks/index.ts`, add:

```ts
import { MissingRenderPartialArguments } from './missing-render-partial-arguments';
```

Add `MissingRenderPartialArguments` to the `allChecks` array.

### Step 5: Run tests to verify they pass

```bash
yarn workspace @platformos/platformos-check-common test src/checks/missing-render-partial-arguments/index.spec.ts
```

Expected: PASS

### Step 6: Type-check

```bash
yarn workspace @platformos/platformos-check-common type-check
```

Expected: no errors.

### Step 7: Commit

```bash
git add packages/platformos-check-common/src/checks/missing-render-partial-arguments/ \
        packages/platformos-check-common/src/checks/index.ts
git commit -m "feat(check): add MissingRenderPartialArguments check

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: UnusedTranslationKey — new check (#3)

**Files:**
- Create: `packages/platformos-check-common/src/checks/unused-translation-key/index.ts`
- Create: `packages/platformos-check-common/src/checks/unused-translation-key/index.spec.ts`
- Modify: `packages/platformos-check-common/src/checks/index.ts`

### Step 1: Write the failing tests

Create `packages/platformos-check-common/src/checks/unused-translation-key/index.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { check } from '../../test';
import { UnusedTranslationKey } from '.';

describe('Module: UnusedTranslationKey', () => {
  it('should not report a key that is used in a template', async () => {
    const offenses = await check(
      {
        'app/translations/en.yml': 'en:\n  general:\n    title: Hello',
        'app/views/pages/home.liquid': `{{"general.title" | t}}`,
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(0);
  });

  it('should report a key that is defined but never used', async () => {
    const offenses = await check(
      {
        'app/translations/en.yml': 'en:\n  general:\n    title: Hello\n    unused: Bye',
        'app/views/pages/home.liquid': `{{"general.title" | t}}`,
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.include('general.unused');
  });

  it('should not report keys used with dynamic variable', async () => {
    const offenses = await check(
      {
        'app/translations/en.yml': 'en:\n  general:\n    title: Hello',
        'app/views/pages/home.liquid': `{{ some_key | t }}`,
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(1); // general.title is still unused
  });

  it('should accumulate used keys across multiple liquid files', async () => {
    const offenses = await check(
      {
        'app/translations/en.yml': 'en:\n  a: A\n  b: B',
        'app/views/pages/page1.liquid': `{{"a" | t}}`,
        'app/views/pages/page2.liquid': `{{"b" | t}}`,
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(0);
  });

  it('should not report when no translation files exist', async () => {
    const offenses = await check(
      {
        'app/views/pages/home.liquid': `{{"general.title" | t}}`,
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(0);
  });
});
```

### Step 2: Run tests to verify they fail

```bash
yarn workspace @platformos/platformos-check-common test src/checks/unused-translation-key/index.spec.ts
```

Expected: FAIL — module not found.

### Step 3: Create the check

Create `packages/platformos-check-common/src/checks/unused-translation-key/index.ts`:

```ts
import { URI, Utils } from 'vscode-uri';
import { TranslationProvider } from '@platformos/platformos-common';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { flattenTranslationKeys } from '../../utils/levenshtein';

export const UnusedTranslationKey: LiquidCheckDefinition = {
  meta: {
    code: 'UnusedTranslationKey',
    name: 'Translation key defined but never used',
    docs: {
      description:
        'Reports translation keys defined in app/translations/en.yml that are never referenced in any Liquid template.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/unused-translation-key',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.INFO,
    schema: {},
    targets: [],
  },

  create(context) {
    const usedKeys = new Set<string>();
    let reported = false;

    return {
      async LiquidVariable(node) {
        if (node.expression.type !== 'String') return;
        if (!node.filters.some((f) => f.name === 't' || f.name === 'translate')) return;
        usedKeys.add(node.expression.value);
      },

      async onCodePathEnd() {
        if (reported) return;
        reported = true;

        const rootUri = URI.parse(context.config.rootUri);
        const baseUri = Utils.joinPath(rootUri, 'app/translations');
        const provider = new TranslationProvider(context.fs);

        let allTranslations: Record<string, any>;
        try {
          allTranslations = await provider.loadAllTranslationsForBase(baseUri, 'en');
        } catch {
          return;
        }

        const definedKeys = flattenTranslationKeys(allTranslations);

        for (const key of definedKeys) {
          if (!usedKeys.has(key)) {
            context.report({
              message: `Translation key '${key}' is defined but never used in any template.`,
              startIndex: 0,
              endIndex: 0,
            });
          }
        }
      },
    };
  },
};
```

### Step 4: Register in allChecks

In `packages/platformos-check-common/src/checks/index.ts`, add:

```ts
import { UnusedTranslationKey } from './unused-translation-key';
```

Add `UnusedTranslationKey` to the `allChecks` array.

### Step 5: Run tests to verify they pass

```bash
yarn workspace @platformos/platformos-check-common test src/checks/unused-translation-key/index.spec.ts
```

Expected: PASS. The `reported` guard ensures `onCodePathEnd` fires only once despite being called per file.

### Step 6: Type-check

```bash
yarn workspace @platformos/platformos-check-common type-check
```

Expected: no errors.

### Step 7: Commit

```bash
git add packages/platformos-check-common/src/checks/unused-translation-key/ \
        packages/platformos-check-common/src/checks/index.ts
git commit -m "feat(check): add UnusedTranslationKey check

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: GraphQL field listing in hover and completions (#7)

**Files:**
- Modify: `packages/platformos-language-server-common/package.json`
- Create: `packages/platformos-language-server-common/src/hover/providers/GraphQLFieldHoverProvider.ts`
- Create: `packages/platformos-language-server-common/src/hover/providers/GraphQLFieldHoverProvider.spec.ts`
- Create: `packages/platformos-language-server-common/src/completions/providers/GraphQLFieldCompletionProvider.ts`
- Create: `packages/platformos-language-server-common/src/completions/providers/GraphQLFieldCompletionProvider.spec.ts`
- Modify: `packages/platformos-language-server-common/src/hover/HoverProvider.ts`
- Modify: `packages/platformos-language-server-common/src/hover/providers/index.ts`
- Modify: `packages/platformos-language-server-common/src/completions/providers/index.ts`

### Step 1: Add the dependency

```bash
yarn workspace @platformos/platformos-language-server-common add graphql-language-service
```

Verify it appears in `packages/platformos-language-server-common/package.json`.

### Step 2: Write the failing hover test

Before writing, read `packages/platformos-language-server-common/src/hover/providers/TranslationHoverProvider.spec.ts` to understand the `HoverProvider` constructor signature and the `hover` custom matcher.

Create `packages/platformos-language-server-common/src/hover/providers/GraphQLFieldHoverProvider.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DocumentManager } from '../../documents';
import { HoverProvider } from '../HoverProvider';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { TranslationProvider } from '@platformos/platformos-common';

const SCHEMA = `
  type Query {
    records(filter: String): RecordConnection
  }
  type RecordConnection {
    results: [Record]
    total_entries: Int
    total_pages: Int
  }
  type Record {
    id: ID
    table: String
    created_at: String
  }
`;

describe('Module: GraphQLFieldHoverProvider', () => {
  let provider: HoverProvider;

  beforeEach(() => {
    provider = new HoverProvider(
      new DocumentManager(),
      {
        graphQL: async () => SCHEMA,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [],
      },
      new TranslationProvider(new MockFileSystem({})),
      undefined,
      undefined,
      async () => '.',
    );
  });

  it('should return hover for a field name in a graphql file', async () => {
    await expect(provider).to.hover(
      // cursor on 'records' field — use █ to mark cursor position
      // Note: hover in .graphql files needs a .graphql URI
      // Read existing hover specs to understand how to pass a non-.liquid URI
      // and adjust accordingly.
      `query { re█cords { results { id } } }`,
      expect.stringContaining('RecordConnection'),
      'app/graphql/test.graphql',
    );
  });

  it('should return null for a .graphql file when schema is unavailable', async () => {
    const noSchemaProvider = new HoverProvider(
      new DocumentManager(),
      {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [],
      },
      new TranslationProvider(new MockFileSystem({})),
    );
    await expect(noSchemaProvider).to.hover(
      `query { re█cords { id } }`,
      null,
      'app/graphql/test.graphql',
    );
  });
});
```

### Step 3: Run test to verify it fails

```bash
yarn workspace @platformos/platformos-language-server-common test src/hover/providers/GraphQLFieldHoverProvider.spec.ts
```

Expected: FAIL — provider not found / returns null.

### Step 4: Create the hover provider

Create `packages/platformos-language-server-common/src/hover/providers/GraphQLFieldHoverProvider.ts`:

```ts
import { buildSchema } from 'graphql';
import { getHoverInformation } from 'graphql-language-service';
import { Hover, HoverParams } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { PlatformOSDocset } from '@platformos/platformos-check-common';
import { DocumentManager } from '../../documents';
import { BaseHoverProvider } from '../BaseHoverProvider';
import { LiquidHtmlNode } from '@platformos/platformos-check-common';

export class GraphQLFieldHoverProvider implements BaseHoverProvider {
  constructor(
    private documentManager: DocumentManager,
    private platformosDocset: PlatformOSDocset,
  ) {}

  async hover(
    _currentNode: LiquidHtmlNode,
    _ancestors: LiquidHtmlNode[],
    params: HoverParams,
  ): Promise<Hover | null> {
    const uri = params.textDocument.uri;
    if (!uri.endsWith('.graphql')) return null;

    const schemaString = await this.platformosDocset.graphQL();
    if (!schemaString) return null;

    let schema;
    try {
      schema = buildSchema(schemaString);
    } catch {
      return null;
    }

    const document = this.documentManager.get(uri);
    if (!document) return null;

    const content = document.source;
    const position = params.position;

    try {
      const hoverInfo = getHoverInformation(schema, content, position);
      if (!hoverInfo) return null;
      return {
        contents: { kind: 'markdown', value: String(hoverInfo) },
      };
    } catch {
      return null;
    }
  }
}
```

**Note:** `getHoverInformation` from `graphql-language-service` takes a `Position` compatible with `{ line, character }` — the LSP `params.position` is compatible. However, the `HoverProvider` normally only handles `.liquid` files — read the `HoverProvider.hover()` method to see where to bypass the liquid-only guard for `.graphql` URIs. You may need to add an early-exit path for graphql files that skips AST traversal and calls `GraphQLFieldHoverProvider` directly.

### Step 5: Register the hover provider

In `packages/platformos-language-server-common/src/hover/HoverProvider.ts`, add `GraphQLFieldHoverProvider` to the `providers` array in the constructor. Export it from `packages/platformos-language-server-common/src/hover/providers/index.ts`.

Also update `HoverProvider.hover()` to handle `.graphql` URIs — they have no liquid AST, so the node traversal will not work. Add a guard at the top:

```ts
if (uri.endsWith('.graphql')) {
  // For graphql files, skip liquid AST traversal and try graphql-specific providers
  for (const provider of this.providers) {
    if (provider instanceof GraphQLFieldHoverProvider) {
      const result = await provider.hover({} as any, [], params);
      if (result) return result;
    }
  }
  return null;
}
```

### Step 6: Write and wire the completion provider

Create `packages/platformos-language-server-common/src/completions/providers/GraphQLFieldCompletionProvider.ts` following the same pattern as the hover provider but using `getAutocompleteSuggestions(schema, content, position)` from `graphql-language-service`. Return `CompletionItem[]`.

Read `packages/platformos-language-server-common/src/completions/providers/PartialCompletionProvider.ts` or `FilterCompletionProvider.ts` for the `Provider` base class interface, then implement accordingly.

Register in the `CompletionProvider` similarly to how `GraphQLFieldHoverProvider` is registered — with a `.graphql` URI guard.

### Step 7: Run all tests to verify they pass

```bash
yarn workspace @platformos/platformos-language-server-common test
```

Expected: PASS (or investigate failures and fix).

### Step 8: Type-check

```bash
yarn workspace @platformos/platformos-language-server-common type-check
```

Expected: no errors.

### Step 9: Commit

```bash
git add packages/platformos-language-server-common/package.json \
        packages/platformos-language-server-common/src/hover/providers/GraphQLFieldHoverProvider.ts \
        packages/platformos-language-server-common/src/hover/providers/GraphQLFieldHoverProvider.spec.ts \
        packages/platformos-language-server-common/src/completions/providers/GraphQLFieldCompletionProvider.ts \
        packages/platformos-language-server-common/src/completions/providers/GraphQLFieldCompletionProvider.spec.ts \
        packages/platformos-language-server-common/src/hover/HoverProvider.ts \
        packages/platformos-language-server-common/src/hover/providers/index.ts \
        packages/platformos-language-server-common/src/completions/providers/index.ts \
        yarn.lock
git commit -m "feat(lsp): add GraphQL field hover and completions using graphql-language-service

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: GraphQL result shape hover (#6)

**Files:**
- Create: `packages/platformos-language-server-common/src/hover/providers/GraphQLResultHoverProvider.ts`
- Create: `packages/platformos-language-server-common/src/hover/providers/GraphQLResultHoverProvider.spec.ts`
- Modify: `packages/platformos-language-server-common/src/hover/HoverProvider.ts`
- Modify: `packages/platformos-language-server-common/src/hover/providers/index.ts`

### Step 1: Write the failing test

Read `packages/platformos-language-server-common/src/hover/providers/RenderPartialHoverProvider.spec.ts` for the pattern of testing hover providers that need to resolve files.

Create `packages/platformos-language-server-common/src/hover/providers/GraphQLResultHoverProvider.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DocumentManager } from '../../documents';
import { HoverProvider } from '../HoverProvider';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { TranslationProvider } from '@platformos/platformos-common';
import { path } from '@platformos/platformos-check-common';

const mockRoot = path.normalize('browser:/');

describe('Module: GraphQLResultHoverProvider', () => {
  let provider: HoverProvider;

  beforeEach(() => {
    const fs = new MockFileSystem({
      'app/graphql/records/list.graphql': `
        query GetRecords {
          records {
            results {
              id
              table
              created_at
            }
            total_entries
            total_pages
          }
        }
      `,
    }, mockRoot);

    provider = new HoverProvider(
      new DocumentManager(),
      {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [],
      },
      new TranslationProvider(fs),
      undefined,
      undefined,
      async () => mockRoot,
    );

    // Inject the fs into the provider for file resolution
    // (read HoverProvider constructor — you may need to add an fs parameter)
  });

  it('should return access pattern when hovering the graphql result variable', async () => {
    await expect(provider).to.hover(
      `{% graphql g = 'records/list' %}{{ █g.records }}`,
      expect.stringContaining('g.records.results'),
    );
  });

  it('should list fields selected in the query', async () => {
    await expect(provider).to.hover(
      `{% graphql g = 'records/list' %}{{ █g.records }}`,
      expect.stringContaining('id'),
    );
  });

  it('should return null when hovering a non-graphql-result variable', async () => {
    await expect(provider).to.hover(
      `{% assign foo = 'bar' %}{{ █foo }}`,
      null,
    );
  });

  it('should return null when the query file does not exist', async () => {
    await expect(provider).to.hover(
      `{% graphql g = 'does/not/exist' %}{{ █g }}`,
      null,
    );
  });
});
```

### Step 2: Run test to verify it fails

```bash
yarn workspace @platformos/platformos-language-server-common test src/hover/providers/GraphQLResultHoverProvider.spec.ts
```

Expected: FAIL.

### Step 3: Create the provider

Create `packages/platformos-language-server-common/src/hover/providers/GraphQLResultHoverProvider.ts`:

```ts
import { parse, OperationDefinitionNode, FieldNode, SelectionSetNode } from 'graphql';
import { Hover, HoverParams } from 'vscode-languageserver';
import { AbstractFileSystem } from '@platformos/platformos-common';
import { DocumentsLocator } from '@platformos/platformos-common';
import { LiquidHtmlNode, NodeTypes, findCurrentNode } from '@platformos/platformos-check-common';
import { LiquidTag, NamedTags } from '@platformos/liquid-html-parser';
import { URI } from 'vscode-uri';
import { DocumentManager } from '../../documents';
import { BaseHoverProvider } from '../BaseHoverProvider';
import { FindAppRootURI } from '../../internal-types';

interface GraphQLBinding {
  resultVar: string;
  queryPath: string;
}

function extractGraphQLBindings(ast: LiquidHtmlNode): GraphQLBinding[] {
  const bindings: GraphQLBinding[] = [];
  // Walk the AST looking for {% graphql varName = 'path' %} tags
  // Use the visit() utility from platformos-check-common
  // Each LiquidTag with name === 'graphql' and markup.type === NodeTypes.GraphQLMarkup
  // gives markup.name (result var) and markup.graphql.value (query path)
  function walk(node: any) {
    if (node?.type === NodeTypes.LiquidTag && node.name === NamedTags.graphql) {
      const markup = node.markup;
      if (markup?.type === NodeTypes.GraphQLMarkup && markup.name && markup.graphql?.type === 'String') {
        bindings.push({ resultVar: markup.name, queryPath: markup.graphql.value });
      }
    }
    for (const key of ['children', 'body', 'markup']) {
      const child = node?.[key];
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === 'object') walk(child);
    }
  }
  walk(ast);
  return bindings;
}

function getSelectedFields(selectionSet: SelectionSetNode | undefined): string[] {
  if (!selectionSet) return [];
  return selectionSet.selections
    .filter((s): s is FieldNode => s.kind === 'Field')
    .map((f) => f.name.value);
}

function buildHoverMarkdown(resultVar: string, queryPath: string, rootField: string, selectedFields: string[]): string {
  const lines = [
    `**\`${resultVar}\`** ← \`${queryPath}\``,
    '',
    '**Access pattern:**',
    `- \`${resultVar}.${rootField}.results\` — array of results`,
    `- \`${resultVar}.${rootField}.total_entries\` — total count`,
    `- \`${resultVar}.${rootField}.total_pages\` — page count`,
  ];

  if (selectedFields.length > 0) {
    lines.push('', '**Selected fields on each result:**');
    lines.push(selectedFields.map((f) => `\`${f}\``).join(' · '));
  }

  return lines.join('\n');
}

export class GraphQLResultHoverProvider implements BaseHoverProvider {
  constructor(
    private documentManager: DocumentManager,
    private fs: AbstractFileSystem,
    private findAppRootURI: FindAppRootURI,
  ) {}

  async hover(
    currentNode: LiquidHtmlNode,
    ancestors: LiquidHtmlNode[],
    params: HoverParams,
  ): Promise<Hover | null> {
    const uri = params.textDocument.uri;
    if (uri.endsWith('.graphql')) return null;

    // Resolve hovered token name
    if (currentNode.type !== NodeTypes.VariableLookup) return null;
    const hoveredName = (currentNode as any).name;
    if (!hoveredName) return null;

    // Find graphql bindings in the document
    const document = this.documentManager.get(uri);
    if (!document || document.ast instanceof Error) return null;

    const bindings = extractGraphQLBindings(document.ast as LiquidHtmlNode);
    const binding = bindings.find((b) => b.resultVar === hoveredName);
    if (!binding) return null;

    // Resolve the query file
    const rootUri = await this.findAppRootURI(uri);
    if (!rootUri) return null;

    const locator = new DocumentsLocator(this.fs);
    const queryFileUri = await locator.locate(URI.parse(rootUri), 'graphql', binding.queryPath);
    if (!queryFileUri) return null;

    // Parse the query
    let querySource: string;
    try {
      querySource = await this.fs.readFile(queryFileUri);
    } catch {
      return null;
    }

    let queryDoc;
    try {
      queryDoc = parse(querySource);
    } catch {
      return null;
    }

    // Extract root field and results fields
    const operation = queryDoc.definitions.find(
      (d): d is OperationDefinitionNode => d.kind === 'OperationDefinition',
    );
    if (!operation) return null;

    const rootField = operation.selectionSet.selections.find(
      (s): s is FieldNode => s.kind === 'Field',
    );
    if (!rootField) return null;

    const rootFieldName = rootField.name.value;
    const resultsField = rootField.selectionSet?.selections
      .filter((s): s is FieldNode => s.kind === 'Field')
      .find((f) => f.name.value === 'results');

    const selectedFields = getSelectedFields(resultsField?.selectionSet);

    return {
      contents: {
        kind: 'markdown',
        value: buildHoverMarkdown(binding.resultVar, binding.queryPath, rootFieldName, selectedFields),
      },
    };
  }
}
```

**Note:** The `HoverProvider` constructor currently doesn't receive an `AbstractFileSystem`. You will need to:
1. Add an optional `fs?: AbstractFileSystem` parameter to `HoverProvider`'s constructor
2. Pass it through from `startServer.ts` where `HoverProvider` is instantiated
3. Pass `fs` to `GraphQLResultHoverProvider` in the providers array

Read `packages/platformos-language-server-common/src/server/startServer.ts` to see how `HoverProvider` is currently constructed, and trace back where `AbstractFileSystem` is available.

### Step 4: Register the provider

In `packages/platformos-language-server-common/src/hover/HoverProvider.ts`, add `GraphQLResultHoverProvider` to the providers array (near the end, before `LiquidDocTagHoverProvider`). Export from `providers/index.ts`.

### Step 5: Run tests to verify they pass

```bash
yarn workspace @platformos/platformos-language-server-common test src/hover/providers/GraphQLResultHoverProvider.spec.ts
```

Expected: PASS. Iterate on the `extractGraphQLBindings` traversal if the AST walk doesn't find the graphql tags — use the `visit()` utility from `platformos-check-common` instead of the manual walk above if needed.

### Step 6: Run the full test suite

```bash
yarn workspace @platformos/platformos-language-server-common test
```

Expected: all passing.

### Step 7: Type-check

```bash
yarn workspace @platformos/platformos-language-server-common type-check
```

Expected: no errors.

### Step 8: Commit

```bash
git add packages/platformos-language-server-common/src/hover/providers/GraphQLResultHoverProvider.ts \
        packages/platformos-language-server-common/src/hover/providers/GraphQLResultHoverProvider.spec.ts \
        packages/platformos-language-server-common/src/hover/HoverProvider.ts \
        packages/platformos-language-server-common/src/hover/providers/index.ts \
        packages/platformos-language-server-common/src/server/startServer.ts
git commit -m "feat(lsp): add GraphQL result shape hover for Liquid templates

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Final validation

After all 7 tasks are complete, run the full monorepo test suite and type-check:

```bash
yarn test
yarn type-check
```

Expected: all tests passing, no type errors.
