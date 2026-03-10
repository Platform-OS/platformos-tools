# Upstream Feature Proposals — pos-cli check and pos-cli LSP

Features identified during plugin development that belong at the platform tooling layer
rather than in the agent plugin. Each proposal includes rationale for placement, full
implementation detail, and expected impact.

**Why layer placement matters:** features that detect code quality problems should live in
`pos-cli check` or the LSP so they fire universally — in CI, in editors, in the agent plugin
via auto-diagnostics — without requiring the plugin to re-implement analysis logic. The plugin
gets them for free via `pos-cli check` output. Features that exist only in the plugin are
invisible outside agent sessions.

---

## pos-cli check proposals

### 1. N+1 GraphQL query detection

**Check code:** `NestedGraphQLQuery` (or `GraphQLInLoop`)
**Severity:** WARNING
**Type:** `SourceCodeType.LiquidHtml`

#### The problem

A `{% graphql %}` tag inside a `{% for %}` or `{% tablerow %}` loop executes one database
request per loop iteration. With 100 records in the outer loop, that is 100 sequential
GraphQL requests instead of one batch query — a catastrophic performance footprint that is
completely invisible at the template level and produces no error at runtime. The page simply
loads slowly (or times out under load).

This is the single most damaging performance pattern in platformOS templates and it is not
currently detected by any tool.

#### Why it belongs in pos-cli check

This is a pure static analysis problem: detect a graphql tag whose AST ancestor chain
contains a `for` or `tablerow` tag. It requires no runtime information, no network calls,
and no session state. It should fire in CI, in the editor diagnostics panel, and during
`pos-cli check` runs — not only when an agent happens to be active. Putting it in the
plugin means it only fires in agent sessions and is invisible everywhere else.

#### Implementation

The check uses entry and exit visitors to maintain a for-loop nesting depth counter. When
a `graphql` tag is encountered at any nesting depth > 0, an offense is reported.

```js
import { SourceCodeType, Severity } from '@platformos/platformos-check-common';
import { NamedTags, NodeTypes } from '@platformos/liquid-html-parser';

export const NestedGraphQLQuery = {
  meta: {
    code: 'NestedGraphQLQuery',
    name: 'GraphQL query inside a loop',
    docs: {
      description: 'A {% graphql %} tag inside a {% for %} loop executes one ' +
        'database request per iteration (N+1 pattern). Move the query before ' +
        'the loop and pass results as a variable.',
      recommended: true,
      url: 'https://documentation.platformos.com/best-practices/performance/graphql-in-loops',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },
  create(context) {
    const loopStack = []; // tracks open for/tablerow nodes

    return {
      async LiquidTag(node) {
        if (node.name === NamedTags.for || node.name === NamedTags.tablerow) {
          loopStack.push(node.name);
          return;
        }

        if (node.name !== NamedTags.graphql) return;
        if (loopStack.length === 0) return;

        const outerLoop = loopStack[loopStack.length - 1];
        const markup = node.markup;
        const resultVar = markup.type === NodeTypes.GraphQLMarkup
          ? markup.name   // the 'result' in {% graphql result = 'path' %}
          : null;

        context.report({
          message:
            `N+1 pattern: {% graphql ${resultVar ? resultVar + ' = ' : ''}... %} ` +
            `is inside a {% ${outerLoop} %} loop. ` +
            `This executes one database request per iteration. ` +
            `Move the query before the loop and pass data as a variable.`,
          startIndex: node.position.start,
          endIndex: node.position.end,
        });
      },

      async 'LiquidTag:exit'(node) {
        if (node.name === NamedTags.for || node.name === NamedTags.tablerow) {
          loopStack.pop();
        }
      },
    };
  },
};
```

#### Edge cases to handle

- **Nested loops:** the `loopStack` correctly handles `{% for %}` inside `{% for %}` —
  depth > 1 is even more dangerous (exponential requests) and should still warn.
- **Dynamic graphql (inline):** `GraphQLInlineMarkup` (inline queries without a file
  reference) should also be detected — the markup type check handles both.
- **`background` tag:** a `{% background %}` tag inside a loop is less harmful (async)
  but still worth a separate INFO-level note. Could be a separate check or a branch here.
- **`cache` wrapping graphql:** if the `graphql` tag is inside both a `{% for %}` and a
  `{% cache %}` block, the severity could be downgraded to INFO since caching mitigates
  the repeated requests. Requires checking ancestors for `NamedTags.cache`.

#### Expected output

```
WARNING  NestedGraphQLQuery  app/views/pages/products.liquid:14
  N+1 pattern: {% graphql result = 'products/related' %} is inside a {% for %}
  loop. This executes one database request per iteration. Move the query before
  the loop and pass data as a variable.
```

---

### 2. Render parameter validation (`@param` contracts)

**Check code:** `UndeclaredRenderParameter` + `MissingRequiredParameter`
**Severity:** WARNING (unknown param) / ERROR (missing required param)
**Type:** `SourceCodeType.LiquidHtml`

#### The problem

LiquidDoc supports `@param` annotations that declare a partial's expected inputs:

```liquid
{% doc %}
  @param {string} title - The card heading (required)
  @param {string} subtitle - Secondary text (optional)
  @param {object} cta - Call-to-action object with url and label
{% enddoc %}
```

Currently there is no tool that validates whether a `{% render %}` call actually provides
the required parameters. A caller can omit `title` entirely and get a silent blank value
at runtime. A caller can pass `ttle: "typo"` and the typo is silently ignored. These
are two of the most common causes of "blank partial" bugs in platformOS templates.

#### Why it belongs in pos-cli check

This is cross-file static analysis: read the callee's declaration (`@param` nodes in the
partial), inspect the caller's argument list (the `{% render %}` tag's named arguments),
and compare. The check engine already provides `context.fs.readFile()` for reading
dependency files. This pattern is identical to how `MissingTemplate` works — it reads
the referenced file to verify it exists. Here we go one step further and read it to
verify the interface is respected.

As a check offense it fires in CI (preventing broken renders from reaching staging),
in the editor (inline annotations on the render tag), and in agent sessions without
any plugin-level logic.

#### Implementation

```js
import { SourceCodeType, Severity } from '@platformos/platformos-check-common';
import { NamedTags, NodeTypes, toLiquidHtmlAST, walk } from '@platformos/liquid-html-parser';
import path from 'node:path';

function resolvePartialPath(fileUri, partialName) {
  // partialName: "sections/hero"
  // resolved: <project-root>/app/views/partials/sections/hero.liquid
  const projectRoot = fileUri.replace(/\/app\/.*$/, '');
  return path.join(projectRoot, 'app', 'views', 'partials', partialName + '.liquid');
}

function extractParams(ast) {
  // Returns { name, required, type, description }[]
  // @param without a default or "optional" marker → required: true
  const params = [];
  walk(ast, (node) => {
    if (node.type === NodeTypes.LiquidDocParamNode) {
      params.push({
        name: node.name,
        type: node.paramType?.value ?? 'any',
        description: node.description?.value ?? '',
        // Convention: params without "(optional)" in description are required.
        // This matches the emerging LiquidDoc convention — adjust per pos-cli's
        // own @param semantics when they are formalised.
        required: !node.description?.value?.toLowerCase().includes('optional'),
      });
    }
  });
  return params;
}

export const RenderParameterValidation = {
  meta: {
    code: 'RenderParameterValidation',
    name: 'Render call violates @param contract',
    docs: {
      description: 'Validates that {% render %} calls provide all required ' +
        '@param arguments declared by the target partial and do not pass ' +
        'undeclared arguments.',
      recommended: true,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },
  create(context) {
    return {
      async LiquidTag(node) {
        if (node.name !== NamedTags.render) return;

        const markup = node.markup;

        // Skip dynamic partials: {% render variable %} — can't resolve statically
        if (!markup.partial || markup.partial.type !== NodeTypes.String) return;

        const partialName = markup.partial.value;
        const partialPath = resolvePartialPath(context.file.uri, partialName);

        if (!await context.fileExists(partialPath)) return; // MissingTemplate handles this

        const partialSource = await context.fs.readFile(partialPath);
        let partialAST;
        try {
          partialAST = toLiquidHtmlAST(partialSource, { mode: 'tolerant' });
        } catch {
          return; // malformed partial — other checks will catch it
        }

        const declaredParams = extractParams(partialAST);

        // If the partial declares no @param at all, skip validation.
        // Unannotated partials have an implicit "accept anything" interface.
        if (declaredParams.length === 0) return;

        const providedArgs = new Map(
          (markup.args ?? []).map(arg => [arg.name, arg])
        );
        const declaredNames = new Set(declaredParams.map(p => p.name));

        // Check 1: missing required params
        for (const param of declaredParams) {
          if (param.required && !providedArgs.has(param.name)) {
            context.report({
              message:
                `Missing required @param '${param.name}' ` +
                `(${param.type}) for partial '${partialName}'. ` +
                (param.description ? `Description: ${param.description}` : ''),
              startIndex: node.position.start,
              endIndex: node.position.end,
            });
          }
        }

        // Check 2: unknown params (caller passes something the partial doesn't declare)
        for (const [argName, argNode] of providedArgs) {
          if (!declaredNames.has(argName)) {
            context.report({
              message:
                `Unknown parameter '${argName}' passed to '${partialName}'. ` +
                `Declared @params: ${[...declaredNames].join(', ')}. ` +
                `Either add @param ${argName} to the partial's LiquidDoc or remove this argument.`,
              startIndex: argNode.position?.start ?? node.position.start,
              endIndex: argNode.position?.end ?? node.position.end,
            });
          }
        }
      },
    };
  },
};
```

#### Adoption path

For this check to be useful, the codebase needs to have `@param` annotations. It cannot
penalise render calls to unannotated partials (hence the early return when `declaredParams.length === 0`). The check is opt-in per partial: annotate a partial's interface
and callers are immediately validated. This creates a natural incremental adoption path —
annotate the most-called partials first.

A companion check `UnannotatedPartial` (INFO severity) could flag partials with no LiquidDoc
block at all, encouraging annotation coverage over time.

---

### 3. Dead translation keys

**Check code:** `UnusedTranslationKey`
**Severity:** INFO (or WARNING — configurable)
**Type:** cross-file, runs at `onCodePathEnd`

#### The problem

`TranslationKeyExists` already catches keys that are *used but not defined*. The inverse
problem — keys that are *defined but never used* — goes completely undetected. Translation
files accumulate dead keys every time a template is renamed, a UI element is removed, or
a feature is sunset. These dead keys:

- Bloat translation files, making them harder to maintain
- Create confusion when translators work on entries that are never displayed
- Make it impossible to know which translations actually need to be kept in sync
  across languages

#### Why it belongs in pos-cli check

This requires building two sets across the entire project:
1. All translation keys *used* in templates (`{{ 'key' | t }}` expressions)
2. All translation keys *defined* in `.yml` files

The difference (defined ∖ used) is the dead set. The check engine's cross-file lifecycle
(`onCodePathStart` / `onCodePathEnd`) is exactly designed for this pattern. The existing
`TranslationKeyExists` check already builds set 1; the machinery for set 2 would require
reading YAML files via `context.fs`.

#### Implementation sketch

```js
export const UnusedTranslationKey = {
  meta: {
    code: 'UnusedTranslationKey',
    name: 'Translation key defined but never used',
    type: SourceCodeType.LiquidHtml, // processes liquid files to build usage set
    severity: Severity.INFO,
    schema: {
      translationFiles: {
        type: 'string',
        default: 'app/translations/*.yml',
        description: 'Glob for translation files to analyse',
      },
    },
    targets: [],
  },
  create(context) {
    const usedKeys = new Set();

    return {
      async LiquidFilter(node) {
        // Detect: {{ 'some.key' | t }} — the filter named 't' applied to a string
        if (node.name !== 't') return;
        const variable = node.parent; // the LiquidVariable containing this filter
        if (variable?.expression?.type === NodeTypes.String) {
          usedKeys.add(variable.expression.value);
        }
      },

      async onCodePathEnd() {
        // After all .liquid files are processed, load and flatten all .yml files
        const projectRoot = context.file.uri.replace(/\/app\/.*$/, '');
        const translationDir = path.join(projectRoot, 'app', 'translations');

        const ymlFiles = await context.fs.readDirectory(translationDir);
        for (const ymlFile of ymlFiles.filter(f => f.endsWith('.yml'))) {
          const raw = await context.fs.readFile(ymlFile);
          const parsed = yaml.parse(raw); // js-yaml
          const definedKeys = flattenYamlKeys(parsed); // { key, value, line }[]

          for (const { key, line } of definedKeys) {
            if (!usedKeys.has(key)) {
              context.report({
                message: `Translation key '${key}' is defined but never used in any template.`,
                uri: ymlFile,
                startIndex: line, // approximate — YAML parser gives line, not index
                endIndex: line,
              });
            }
          }
        }
      },
    };
  },
};

function flattenYamlKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) {
      keys.push(...flattenYamlKeys(v, full));
    } else {
      keys.push({ key: full, value: v });
    }
  }
  return keys;
}
```

#### Caveats

- **Dynamic keys:** `{{ some_variable | t }}` — the key is not a string literal and
  cannot be statically resolved. The check must conservatively treat all non-literal
  `| t` usages as "might use any key" and exclude them from the dead-key analysis
  (or emit an INFO note that dynamic key usage prevents complete analysis).
- **Interpolated keys:** `{{ 'user.greeting' | t: name: current_user.name }}` —
  the key IS a literal and can be tracked normally.
- **Multi-language files:** the check should union keys across all language files
  (`en.yml`, `pl.yml`, etc.) — a key defined only in one language is not dead,
  just untranslated.

---

### 4. `TranslationKeyExists` — nearest-key suggestion

**Modification to:** existing `TranslationKeyExists` check
**Change:** add `suggest[]` entries with closest matching keys

#### The problem

When `TranslationKeyExists` fires today, the offense message is:

```
Translation key 'app.hero.titel' does not exist.
```

The developer (or agent) then has to manually open the translation file, search for
similar keys, and figure out the correct spelling. In the case above the key is obviously
`app.hero.title` — a one-character typo. The check already has all the information needed
to surface this suggestion.

#### Why it belongs in pos-cli check

The `Offense` type already has a `suggest[]` field specifically for this purpose. A
suggestion is additional information attached to an offense that editors and tools can
surface inline. This is zero-cost to add — the check already reads all translation keys
to verify existence; finding the nearest match is just a few more lines.

#### Implementation

```js
// Levenshtein distance — simple O(nm) implementation, keys are short strings
function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[a.length][b.length];
}

function findNearestKeys(missingKey, allKeys, maxDistance = 3, maxResults = 3) {
  return allKeys
    .map(key => ({ key, distance: levenshtein(missingKey, key) }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxResults)
    .map(({ key }) => key);
}

// In the existing TranslationKeyExists check, replace the bare context.report() with:
const nearest = findNearestKeys(missingKey, [...allDefinedKeys]);

context.report({
  message: `Translation key '${missingKey}' does not exist.`,
  startIndex: node.position.start,
  endIndex: node.position.end,
  suggest: nearest.map(key => ({
    message: `Did you mean '${key}'? (value: "${allDefinedKeys.get(key)}")`,
    fix: {
      startIndex: node.position.start,
      endIndex: node.position.end,
      newText: `'${key}'`,
    },
  })),
});
```

The `fix` on each suggestion means editors and `pos-cli check --fix` can apply the
correction automatically when the user picks a suggestion.

#### Segment-based fallback

For keys that have no close Levenshtein match (completely wrong key, not a typo), a
segment-based search is useful: split the missing key by `.` and find defined keys that
share at least one segment. For example, `app.header.titre` has no close match by edit
distance but shares `app.header` with several defined keys. This fallback catches
namespace errors vs typo errors.

---

### 5. `HardcodedRoutes` — autofix

**Modification to:** existing `HardcodedRoutes` check
**Change:** add `fix` to offenses so `pos-cli check --fix` can correct them

#### The problem

`HardcodedRoutes` fires when a literal path like `/products` or `/` appears in a template
context where `{{ routes.products_url }}` (or `{{ '/' | route_url }}`) should be used.
This is already detected. What is missing is an automatic fix.

The check already knows:
- The offending string (e.g. `"/products"` or just `"/"`)
- Its exact position in the source
- The platformOS routes object keys (via `context.platformosDocset`)

Everything needed to construct and apply the replacement is already present.

#### Why it belongs in pos-cli check

The `Offense.fix` field + `pos-cli check --fix` is the standard platformOS mechanism
for auto-correctable offenses. Adding autofix here means:
- Editors with pos-cli LSP integration can offer a one-click fix
- CI can run `pos-cli check --fix` to auto-correct before failing the build
- `pos-cli check --fix` in a batch migration can update an entire legacy codebase

Implementing "suggest the route_url replacement" in the plugin is a workaround for a
missing feature in the tool that owns the detection.

#### Implementation sketch

```js
// In the existing HardcodedRoutes check, determine the fix based on the offense type:

// Case 1: literal href="/products" — the path matches a known route slug
const matchingRouteKey = findRouteKey(literalPath, availableRoutes);
if (matchingRouteKey) {
  fix = {
    startIndex: literalValueStart, // the position of the string content (not the quotes)
    endIndex: literalValueEnd,
    newText: `{{ routes.${matchingRouteKey} }}`,
  };
}

// Case 2: literal href="/" — root URL
if (literalPath === '/') {
  fix = {
    startIndex: literalValueStart,
    endIndex: literalValueEnd,
    newText: `{{ routes.root_url }}`,
  };
}

// Case 3: path with no matching route key — suggest route_url filter (less specific)
if (!fix) {
  fix = {
    startIndex: literalValueStart,
    endIndex: literalValueEnd,
    newText: `{{ '${literalPath}' | route_url }}`,
  };
}

context.report({
  message: `Hardcoded route '${literalPath}' — use {{ routes.${matchingRouteKey ?? '...'} }}`,
  startIndex: node.position.start,
  endIndex: node.position.end,
  fix,
});
```

The `StringCorrector` / `applyFixToString` infrastructure in `platformos-check-common`
handles the actual text substitution when `--fix` is invoked.

---

## pos-cli LSP proposals

### 6. GraphQL result shape in hover

**LSP method:** `textDocument/hover` on graphql result variables
**Affected files:** `.liquid` files containing `{% graphql result = 'path/to/query' %}`

#### The problem

Today, hovering over the result variable `g` in:

```liquid
{% graphql g = 'records/users' %}
{% for user in g.records.results %}
```

returns nothing useful. The agent (and developer) must either:
1. Open the `.graphql` file and mentally trace `query GetUsers { records { results { ... } } }`
   back to the access path
2. Guess — and `g.users.results` vs `g.records.results` is the single most common source
   of `UnknownProperty` errors in platformOS templates

The correct access path depends on the query's root field name, which is determined by
the GraphQL schema and the specific query — information the LSP already has.

#### What the hover should return

```markdown
**`g`** ← `records/users` (GetUsers)

**Access pattern:**
{{ g.records.results }}            — array of Record objects
{{ g.records.total_entries }}      — total count (for pagination)
{{ g.records.total_pages }}

**Each record has:**
id · created_at · updated_at · properties_object · table
```

This eliminates a whole class of runtime errors by making the correct access path
explicit at the point of use.

#### Implementation approach

When the LSP receives `hover` on a variable that is the result of a `{% graphql %}` tag:

1. **Resolve the query file:** parse the `GraphQLMarkup` node to get the query path
   (e.g. `records/users`) and resolve to `app/graphql/records/users.graphql`
2. **Parse the query:** use the GraphQL parser to identify the operation name and
   root selection field (`records`, `users`, `pages`, etc.)
3. **Look up the return type:** cross-reference the root selection field against the
   schema to find its return type (`RecordConnection`, `UserConnection`, etc.)
4. **Build the access path:** from the connection type, derive:
   - `g.<rootField>.results` — the items array
   - `g.<rootField>.total_entries` — pagination count
   - The shape of each item (fields selected in the query)
5. **Return as hover markdown**

The LSP already performs steps 1–3 for GraphQL diagnostics and completions. Step 4 is
new but straightforward given the type information already resolved.

#### Liquid variable tracking

The LSP needs to track that `g` in the Liquid context is bound to the result of the
graphql tag, then recognise `g` in downstream `{{ g.something }}` expressions as the
same binding. This requires a lightweight Liquid variable binding tracker — the LSP
likely already has this for its existing `UndefinedObject` and `UnknownProperty`
diagnostics.

---

### 7. GraphQL type field listing in hover and completions

**LSP methods:** `textDocument/hover` on type names, `textDocument/completion` inside
selection sets
**Affected files:** `.graphql` files

#### The problem

When writing a GraphQL query, the agent (and developer) does not know which fields are
available on a given type without either:
- Running the query and inspecting the result
- Reading the schema file (`app/graphql/schema.graphql`) manually
- Guessing, leading to `UnknownProperty` errors

Standard GraphQL LSP implementations provide field-level completions and hover out of
the box. The pos-cli LSP has schema awareness (it validates queries against the schema)
but may not surface this at the hover and completion level.

#### What this should provide

**Hover on a type name** (`Record`, `User`, `OrderItem`) in a query:
```markdown
**Record**

Fields:
- `id` — ID
- `table` — String — the table/model name
- `created_at` — String — ISO 8601 timestamp
- `updated_at` — String
- `properties` — JSON — raw properties hash
- `properties_object` — Object — typed property access
- `related_records` — [Record] — associated records
```

**Completion inside a selection set** (cursor after `{`):
```
id
table
created_at
updated_at
properties
properties_object
related_records { ... }
```

#### Why this belongs in the LSP

The LSP already has the schema. GraphQL field completion is standard LSP behavior
(`CompletionItemKind.Field`). The implementation is a standard GraphQL LSP feature —
libraries like `graphql-language-service` implement this and could be integrated or
referenced. The pos-cli LSP could either implement this natively or delegate to
`graphql-language-service-interface` which is schema-aware.

Implementing this in the plugin would require the plugin to parse the schema,
resolve types, and format completions — all work the LSP already does internally
but does not expose at the hover/completion level.

---

### 8. Circular render detection via `appGraph`

**LSP feature:** `textDocument/publishDiagnostics` on cyclic render references
**Trigger:** on file save / `didChange` for `.liquid` files involved in a cycle

#### The problem

If partial A renders partial B, which renders partial C, which renders partial A, the
result is an infinite loop at runtime — the page request never completes and eventually
times out or crashes. The linter does not detect this. The plugin's `ProjectIndex` knows
each partial's `renders[]` list but cycle detection is not implemented there.

This is a correctness bug, not a style issue. A render cycle will break any page that
includes any partial in the cycle.

#### Why it belongs in the LSP

The LSP already builds and maintains the `appGraph` — the full render dependency graph
for the project. `appGraph/dependencies` gives the transitive dependency tree from any
file. Cycle detection over an already-built graph is a DFS with a visited set — a
trivial algorithm on top of an existing data structure.

When the LSP detects a cycle, it can publish a diagnostic via
`textDocument/publishDiagnostics` on the specific `{% render %}` tag that closes the
cycle, pointing exactly at the offending line.

#### Implementation approach

After rebuilding the `appGraph` (on file save or project index refresh):

```js
function detectCycles(graph) {
  // graph: Map<filePath, Set<filePath>> (file → files it renders)
  const cycles = [];
  const visited = new Set();
  const stack = [];

  function dfs(node) {
    if (stack.includes(node)) {
      // Found a cycle — extract the cycle path
      const cycleStart = stack.indexOf(node);
      cycles.push(stack.slice(cycleStart).concat(node));
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.push(node);
    for (const neighbour of (graph.get(node) ?? [])) {
      dfs(neighbour);
    }
    stack.pop();
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) dfs(node);
  }
  return cycles;
}
```

For each detected cycle, the LSP:
1. Identifies the `{% render %}` tag in the closing file that references back to a
   file earlier in the cycle
2. Publishes a diagnostic (ERROR severity) on that specific tag:
   ```
   Circular render detected: sections/hero → atoms/icon → sections/hero
   This will cause an infinite loop at runtime.
   ```
3. Also publishes the same diagnostic on the opening file's render tag, so both ends
   of the cycle are highlighted in the editor

#### Incremental update

When a file is saved, only re-run cycle detection for the connected component containing
that file — not the entire graph. The `appGraph` already supports incremental updates;
cycle detection can follow the same invalidation scope.

---

## Summary

| # | Feature | Target | Severity | Complexity |
|---|---------|--------|----------|------------|
| 1 | N+1 GraphQL query detection | pos-cli check | WARNING | Low — ~60 lines |
| 2 | Render `@param` validation | pos-cli check | ERROR/WARNING | Medium — ~120 lines + cross-file reads |
| 3 | Dead translation keys | pos-cli check | INFO | Medium — needs YAML + cross-file accumulation |
| 4 | `TranslationKeyExists` nearest-key suggest | pos-cli check | (modify existing) | Low — ~30 lines added to existing check |
| 5 | `HardcodedRoutes` autofix | pos-cli check | (modify existing) | Low — fix field on existing offense |
| 6 | GraphQL result shape in hover | pos-cli LSP | — | Medium — query→type resolution |
| 7 | GraphQL type field listing | pos-cli LSP | — | Medium — schema traversal for hover/completions |
| 8 | Circular render detection | pos-cli LSP | ERROR diagnostic | Low — DFS on existing appGraph |

**Priority recommendation:** #1 (N+1), #4 (suggest), #5 (autofix), #8 (cycles) are the
highest ratio of value to effort. #2 (@param validation) has the most transformative
long-term impact but requires the codebase to adopt `@param` annotations first.
