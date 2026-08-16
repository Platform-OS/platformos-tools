import {
  ForMarkup,
  GraphQLInlineMarkup,
  GraphQLMarkup,
  LiquidDocParamNode,
  LiquidHtmlNode,
  LiquidTag,
  LiquidVariable,
  NamedTags,
  NodeTypes,
  TextNode,
} from '@platformos/liquid-html-parser';

import {
  DOCSET_TYPES,
  LiquidType,
  filterChainType,
  filterReturnTypes,
  tagReturnTypes,
} from './liquid-types';
import { PlatformOSDocset, SourceCodeType, TypedAppFile } from './types';
import { enclosingBranchEnd, isLiquidDocument } from './utils/ast';
import { visit } from './visitor';
import { writeTargetOf } from './write-targets';

/**
 * WHAT A NAMED VARIABLE HOLDS, at an offset in one file.
 *
 * The symbol table three checks said did not exist. `{{ 403 | t }}` was reported and
 * `{% assign x = 403 %}{{ x | t }}` was not, although the runtime refuses both identically —
 * measured: `translate filter - first argument must be a string, received: 403`, twice.
 *
 * This is `InvalidWriteTarget`'s private tracker promoted, not a new model. That check kept
 * ranges, narrowing and a literal switch that nothing else could reach; `shape-analysis.ts` kept the
 * SCOPING those ranges were missing. Both are here now, and check-common is back to two per-file
 * models of a variable — this one for its TYPE, `shape-analysis` for its STRUCTURE — rather than the
 * three it was heading for.
 *
 * WHERE THE TYPES COME FROM is the docset and nowhere else. A filter chain resolves through
 * `filters.json`'s published `return_type` ({@link filterChainType}) and a tag through `tags.json`'s
 * ({@link tagReturnTypes}); see {@link MEASURED_TAG_TYPES} for the four rows the document has not
 * filled in yet and what removes them. The literal arms below are not documentation — a `Number`
 * node is a number in the language, whoever documents it.
 */
export interface VariableTypes {
  /**
   * The type `name` holds at `position`, or `untyped` when nothing is known there.
   *
   * `untyped` means UNKNOWN and every caller treats it as compatible with whatever was expected —
   * a name this file never assigns, a name a loop rebound, a name written in one branch of an
   * `{% if %}` and read after it.
   */
  typeAt(name: string, position: number, sources?: VariableTypeSources): LiquidType;
}

/** The docset's published return types, the only thing here that decides a documented type. */
export interface VariableTypeSources {
  /** Filter name → the type it returns. {@link filterReturnTypes} */
  filters: ReadonlyMap<string, LiquidType>;
  /** Tag name → the type it leaves in the variable it assigns. {@link tagReturnTypes} */
  tags: ReadonlyMap<string, LiquidType>;
}

const NO_SOURCES: VariableTypeSources = { filters: new Map(), tags: new Map() };

const SOURCES_BY_DOCSET = new WeakMap<PlatformOSDocset, Promise<VariableTypeSources>>();

/**
 * The published return types a check hands to {@link VariableTypes.typeAt}, built once per docset.
 *
 * Kept OUT of the table itself so the table can be memoized on the `AppFile` without a docset in its
 * key: a file's writes are a property of the file, and what a filter returns is a property of the
 * document. The two are joined at query time.
 */
export function variableTypeSources(
  docset: PlatformOSDocset | undefined,
): Promise<VariableTypeSources> {
  if (!docset) return Promise.resolve(NO_SOURCES);

  const cached = SOURCES_BY_DOCSET.get(docset);
  if (cached) return cached;

  const sources = Promise.all([docset.filters(), docset.tags()]).then(([filters, tags]) => ({
    filters: filterReturnTypes(filters),
    tags: tagReturnTypes(tags),
  }));

  SOURCES_BY_DOCSET.set(docset, sources);
  return sources;
}

/**
 * What a tag leaves behind, for a docset whose tag `return_type` is still `[]`.
 *
 * A BRIDGE TO A KNOWN RELEASE, not an open-ended table. Every one of these four is published
 * upstream now and each row retires itself the moment a user's downloaded docset carries it:
 *
 * - `graphql` — `@return [object]` on `Liquify::Tags::GraphqlTag`, plus its two deprecated
 *   siblings `execute_query` and `query_graph`. The tags generator emitted no `returns` at all
 *   until then, so `platformos_tags.liquid` looped over nothing and published `[]` for all 33.
 * - `capture`, `increment`, `decrement` — core Liquid tags the platform never registers, so they
 *   have no handler class to annotate; their `return_type` is authored in the documentation
 *   repository's hand-written `standard_tags.liquid`, beside the rest of their documentation.
 *
 * THE DOCSET WINS regardless: this is read only where {@link tagReturnTypes} has no row, which is
 * what makes the retirement automatic rather than a deletion someone has to remember.
 *
 * Each row is a MEASURED runtime fact rather than a claim about a vocabulary, which is what kept it
 * from being the filter/tag table this repository deleted:
 *
 * - `capture` and `graphql` are the two `InvalidWriteTarget` already shipped and depends on;
 *   `{% graphql g %}…{% endgraphql %}` leaves a value `hash_keys` answers `["records"]` for.
 * - `increment` / `decrement` write a counter that is READABLE under the same name — measured
 *   against a live instance, `{% increment c %}{{ c }}` renders `1` — but an assigned variable
 *   SHADOWS it: `{% assign d = 'str' %}{% increment d %}{{ d }}` renders `str`, and so does the
 *   same pair written the other way round. That second half is why a counter binds only where
 *   nothing else does; `shape-analysis.ts` records nothing for these two and was right about the
 *   shadowing and wrong about the read.
 *
 * `parse_json` is deliberately ABSENT, and upstream now says so in the document: it publishes
 * `@return [untyped]`, because the type is its BODY's — `[1,2]` is an Array and `{}` is a Hash — so
 * a row saying `object` would be wrong half the time. It is read from the source instead, by
 * {@link parsedJsonType}. `function` is `untyped` upstream for the same kind of reason: a partial's
 * return is its author's to decide.
 */
const MEASURED_TAG_TYPES: Readonly<Record<string, LiquidType>> = {
  capture: 'string',
  graphql: 'object',
  increment: 'number',
  decrement: 'number',
};

/**
 * How a name is bound over a range.
 *
 * `expression` and `narrowed` are LAZY on purpose: resolving either needs the docset, and keeping
 * the docset out of the build is what lets one table serve every check and be memoized on the file.
 */
type Binding =
  | { kind: 'type'; type: LiquidType }
  /** `{% assign x = <value> %}`, resolved against the docset at query time. */
  | { kind: 'expression'; value: LiquidVariable; readAt: number }
  /** What a TAG left behind, resolved against `tags.json` at query time. */
  | { kind: 'tag'; tag: string }
  /** A write that went INTO the container rather than replacing it. */
  | { kind: 'narrowed'; becomes: 'array' | 'object'; previous: Binding | undefined };

interface Slot {
  name: string;
  /** `undefined` is KNOWN-UNKNOWN: a loop variable, or the far side of a conditional. */
  binding: Binding | undefined;
  range: [start: number, end?: number];
}

/**
 * One tag's effect on the table.
 *
 * `from` is where the previous binding stops being current (the tag's start) and `at` is where the
 * new one starts (the tag's — or block's — end). They are two different offsets and conflating them
 * breaks `{% assign x = 5 %}{% assign x = x %}`, whose operand must read the FIRST binding.
 */
type Write =
  | {
      kind: 'bind';
      name: string;
      from: number;
      at: number;
      scopeEnd?: number;
      binding: Binding | undefined;
    }
  | {
      kind: 'narrow';
      name: string;
      from: number;
      at: number;
      scopeEnd?: number;
      becomes: 'array' | 'object';
    }
  | { kind: 'counter'; name: string; from: number; at: number; scopeEnd?: number; tag: string }
  | { kind: 'loop'; name: string; from: number; at: number; bodyEnd?: number }
  | { kind: 'forget'; from: number; at: number };

/** Tags that assign, so unreadable markup on one means an assignment nothing here can place. */
const ASSIGNING_TAGS = new Set<string>([
  NamedTags.assign,
  NamedTags.hash_assign,
  NamedTags.function,
  NamedTags.graphql,
  NamedTags.parse_json,
  NamedTags.capture,
  NamedTags.increment,
  NamedTags.decrement,
  NamedTags.for,
  NamedTags.tablerow,
]);

/**
 * The table for one file, memoized ON that file so four checks build it once.
 *
 * `AppFile.derived` is invalidated when the file's contents change, so the memo cannot go stale —
 * the same seam `undefinedVariablesOf` uses, and for the same reason.
 */
export function variableTypesOf(
  file: TypedAppFile<SourceCodeType.LiquidHtml>,
): Promise<VariableTypes> {
  return file.derived('variableTypes', () => buildVariableTypes(file.ast));
}

/** The table for an AST a caller holds directly — a test, or a buffer with no `AppFile`. */
export async function buildVariableTypes(ast: unknown): Promise<VariableTypes> {
  const slots: Slot[] = [];

  if (isLiquidDocument(ast)) applyWrites(slots, await collectWrites(ast));

  /**
   * The binding in effect for `name` at `position`, or `undefined`.
   *
   * THE START BOUND IS INCLUSIVE. A range starts at the defining tag's end, which is an offset a
   * real tag can begin at exactly, because Liquid tags may abut with nothing between them:
   *
   *   {% assign x = 5 %}{% hash_assign x['k'] = 'v' %}
   *                     ^ range start AND the reported lookup are both 18
   *
   * An exclusive bound excluded that case, and the check went silent on a buffer the runtime raises
   * for while firing on the same code with one space inserted. `shape-analysis`'s `valueAt` uses the
   * exclusive spelling for its own reasons; this one is the measured bound.
   *
   * Later slots win, which is what resolves a reassignment whose ranges abut.
   */
  const slotAt = (name: string, position: number): Slot | undefined => {
    let found: Slot | undefined;
    for (const slot of slots) {
      if (slot.name !== name) continue;
      const [start, end] = slot.range;
      if (position < start) continue;
      if (end !== undefined && position > end) continue;
      found = slot;
    }
    return found;
  };

  /**
   * Resolving a name re-enters this, so `seen` is what stops the recursion.
   *
   * KEYED ON THE NAME AND THE POSITION, not on the name. `{% assign x = 403 %}{% assign x = x %}`
   * resolves `x` at the second tag while already resolving `x` at the end of the file, and those
   * are two different bindings — a name-only key answered `untyped` for it, which is the answer a
   * genuine cycle deserves and this is not one. The pair is finite and each is on the stack once,
   * so a real cycle (`{% assign x = x %}` with nothing before it) still terminates.
   */
  const resolveName = (
    name: string,
    position: number,
    sources: VariableTypeSources,
    seen: Set<string>,
  ): LiquidType => {
    const key = `${name}\u0000${position}`;
    if (seen.has(key)) return 'untyped';
    const binding = slotAt(name, position)?.binding;
    if (!binding) return 'untyped';

    seen.add(key);
    try {
      return resolveBinding(binding, sources, seen);
    } finally {
      seen.delete(key);
    }
  };

  const resolveBinding = (
    binding: Binding,
    sources: VariableTypeSources,
    seen: Set<string>,
  ): LiquidType => {
    switch (binding.kind) {
      case 'type':
        return binding.type;

      case 'tag':
        // THE DOCSET FIRST, always. `tags.json` carries `return_type` under the same name filters
        // use, so a `@return` annotation added upstream takes effect here with no edit — and
        // silently retires the corresponding row of {@link MEASURED_TAG_TYPES}.
        return sources.tags.get(binding.tag) ?? MEASURED_TAG_TYPES[binding.tag] ?? 'untyped';

      case 'narrowed': {
        // A write that REACHED the runtime proves the container was of the right kind, so an
        // unknown value becomes what the operation requires — an Array for `<<`, a Hash for a
        // subscript write unless it was already an Array, which a subscript write does not convert.
        const previous = binding.previous
          ? resolveBinding(binding.previous, sources, seen)
          : 'untyped';
        return binding.becomes === 'array' || previous === 'array' ? 'array' : 'object';
      }

      case 'expression':
        return resolveExpression(binding.value, binding.readAt, sources, seen);
    }
  };

  const resolveExpression = (
    variable: LiquidVariable,
    readAt: number,
    sources: VariableTypeSources,
    seen: Set<string>,
  ): LiquidType => {
    // THE LAST FILTER DECIDES, from the docset's published return types. A list of filter names
    // must never be reintroduced beside this: a name in the wrong bucket refuses working code and
    // a duplicate entry is invisible by construction.
    if (variable.filters?.length) return filterChainType(variable.filters, sources.filters);

    const expression = variable.expression;
    switch (expression.type) {
      case NodeTypes.Number:
        return 'number';
      case NodeTypes.String:
        return 'string';
      case NodeTypes.Range:
        // NOT `array`. An Array accepts `x[0] = …` and a range was only ever measured raising.
        return 'range';
      case NodeTypes.JsonArrayLiteral:
        return 'array';
      case NodeTypes.JsonHashLiteral:
        return 'object';
      case NodeTypes.BooleanExpression:
        return 'boolean';
      case NodeTypes.LiquidLiteral:
        // `nil`, `empty` and `blank` are all `untyped`: what they hold depends on what they are
        // compared against, and this table's answer is read as a fact about a container.
        return expression.keyword === 'true' || expression.keyword === 'false'
          ? 'boolean'
          : 'untyped';
      case NodeTypes.VariableLookup:
        // `{% assign b = a %}` takes `a`'s type. A LOOKUP INTO one does not: nothing here tracks
        // element or property types, and `shape-analysis` is the model that does.
        return expression.lookups.length > 0 || !expression.name
          ? 'untyped'
          : resolveName(expression.name, readAt, sources, seen);
      default:
        return 'untyped';
    }
  };

  return {
    typeAt(name, position, sources = NO_SOURCES) {
      return resolveName(name, position, sources, new Set());
    },
  };
}

function applyWrites(slots: Slot[], writes: Write[]) {
  const slotAt = (name: string, position: number): Slot | undefined => {
    let found: Slot | undefined;
    for (const slot of slots) {
      if (slot.name !== name) continue;
      const [start, end] = slot.range;
      if (position < start) continue;
      if (end !== undefined && position > end) continue;
      found = slot;
    }
    return found;
  };

  const closeRange = (name: string, endPosition: number) => {
    for (let i = slots.length - 1; i >= 0; i--) {
      if (slots[i].name === name && slots[i].range[1] === undefined) {
        slots[i].range[1] = endPosition;
        break;
      }
    }
  };

  const bind = (
    name: string,
    binding: Binding | undefined,
    from: number,
    at: number,
    scopeEnd: number | undefined,
  ) => {
    closeRange(name, from);
    slots.push({ name, binding, range: [at, scopeEnd] });
    // Past the branch, nobody knows whether the write ran — so nobody knows the type either.
    if (scopeEnd !== undefined) slots.push({ name, binding: undefined, range: [scopeEnd] });
  };

  // Source order, so a write can see what preceded it. Sorted rather than assumed: the traversal
  // that produced these emits document order today, and nothing about a range depends on that.
  for (const write of [...writes].sort((a, b) => a.from - b.from)) {
    switch (write.kind) {
      case 'forget':
        // Unreadable markup may have assigned anything; `LiquidHTMLSyntaxError` owns saying so.
        //
        // Closed at the bad tag's START, like every other write, and NOT at its end. The end is an
        // offset the next tag can begin at exactly — Liquid tags abut — and a consumer that queries
        // a tag's `position.start` would land on it and, the end bound being inclusive, still read
        // the forgotten value. `{% assign x = 5 %}{% assign %}{% hash_assign x['k'] = 'v' %}` is
        // the buffer that shows it, and closing early only ever forgets sooner.
        for (const slot of slots) if (slot.range[1] === undefined) slot.range[1] = write.from;
        break;

      case 'loop': {
        // A loop variable SHADOWS the name over the body, and Liquid scopes it, so past the
        // `{% endfor %}` the name means what it did before. Without this,
        // `{% assign x = 403 %}{% for x in list %}{{ x | t }}{% endfor %}` reports a number.
        const outer = slotAt(write.name, write.at);
        closeRange(write.name, write.from);
        slots.push({ name: write.name, binding: undefined, range: [write.at, write.bodyEnd] });
        if (write.bodyEnd !== undefined) {
          slots.push({ name: write.name, binding: outer?.binding, range: [write.bodyEnd] });
        }
        break;
      }

      case 'counter': {
        // A counter is readable under its own name ONLY while nothing else binds it — measured,
        // see {@link MEASURED_TAG_TYPES}. Asked of the WRITES rather than the slots, because a
        // `{% function x = 'p' %}` binds a value this table cannot type: its slot holds no
        // binding, and reading that as "nothing assigns x" would let the counter claim a name the
        // runtime has already given to the partial's return value.
        //
        // An assignment LATER does not shadow: measured, `{% increment c %}{{ c }}{% assign c =
        // 'x' %}` renders `1` at the read. Last-write-wins gives that for free.
        const shadowed = writes.some(
          (other) =>
            other.kind !== 'counter' &&
            other.kind !== 'forget' &&
            other.name === write.name &&
            other.from <= write.from,
        );
        if (!shadowed)
          bind(write.name, { kind: 'tag', tag: write.tag }, write.from, write.at, write.scopeEnd);
        break;
      }

      case 'narrow':
        bind(
          write.name,
          {
            kind: 'narrowed',
            becomes: write.becomes,
            previous: slotAt(write.name, write.from)?.binding,
          },
          write.from,
          write.at,
          write.scopeEnd,
        );
        break;

      case 'bind':
        bind(write.name, write.binding, write.from, write.at, write.scopeEnd);
        break;
    }
  }
}

async function collectWrites(ast: LiquidHtmlNode): Promise<Write[]> {
  const writes: Write[] = [];

  await visit<SourceCodeType.LiquidHtml, void>(ast, {
    async LiquidDocParamNode(node: LiquidDocParamNode) {
      // A DECLARED parameter is in scope from before the file's first line, so `-1`. It is the
      // same contract `ValidRenderPartialArgumentTypes` already enforces at every call site; this
      // is only the callee's side of it. A spelling the docset's type vocabulary does not map —
      // an object name like `{current_user}`, or the `{string[]}` array form — binds NOTHING,
      // because nothing here knows what satisfies one.
      const declared = declaredType(node.paramType);
      if (declared) {
        writes.push({
          kind: 'bind',
          name: node.paramName.value,
          from: -1,
          at: -1,
          binding: { kind: 'type', type: declared },
        });
      }
    },

    async LiquidTag(node: LiquidTag, ancestors) {
      // A read INSIDE the tag still resolves against the previous binding, so the new range starts
      // where the tag — or its block — ends.
      const from = node.position.start;
      const at = node.blockEndPosition?.end ?? node.position.end;
      const scopeEnd = enclosingBranchEnd(ancestors);

      if (typeof node.markup === 'string') {
        if (ASSIGNING_TAGS.has(node.name)) writes.push({ kind: 'forget', from, at });
        return;
      }

      // {% for item in collection %} / {% tablerow item in collection %}
      if (isLoop(node)) {
        const name = node.markup.variableName;
        if (name) {
          writes.push({
            kind: 'loop',
            name,
            from: node.blockStartPosition.end,
            at: node.blockStartPosition.end,
            bodyEnd: node.blockEndPosition?.start,
          });
        }
        return;
      }

      // The three tags that write through a target — `{% assign x['k'] = v %}`,
      // `{% hash_assign x['k'] = v %}`, `{% function x << 'p' %}` and the plain forms of each.
      // `write-targets.ts` unpicks the three markups; what the write DOES to the table is decided
      // here, and whether it is LEGAL is `checks/invalid-write-target`'s question.
      const write = writeTargetOf(node);
      if (write) {
        const name = write.name;
        if (!name) return;

        // `hash_assign` narrows to a Hash whatever its shape: the tag cannot be spelled without a
        // subscript on the platform, so there is no replacing form of it to model. (This repository
        // parses `{% hash_assign h = 'v' %}`, which `InvalidHashAssignTargetSyntax` reports.)
        if (write.tag === NamedTags.hash_assign) {
          writes.push({ kind: 'narrow', name, from, at, scopeEnd, becomes: 'object' });
          return;
        }

        // A plain `function` target takes the partial's RETURN value, which nothing here can infer
        // — but it genuinely REPLACES what was there, so the old binding must not survive it. That
        // is what a `bind` with no binding says, and it is why `value` is `undefined` for it.
        writes.push(
          writeInto(name, write.lookups.length > 0, write.operator, from, at, scopeEnd) ?? {
            kind: 'bind',
            name,
            from,
            at,
            scopeEnd,
            binding: write.value
              ? { kind: 'expression', value: write.value, readAt: from }
              : undefined,
          },
        );
        return;
      }

      // {% parse_json x %}…{% endparse_json %} — the ONE tag whose type is its body's.
      if (isParseJson(node)) {
        const name = node.markup.name;
        if (name) {
          writes.push({
            kind: 'bind',
            name,
            from,
            at,
            scopeEnd,
            binding: parsedJsonType(node),
          });
        }
        return;
      }

      // {% capture x %}…{% endcapture %}
      if (node.name === NamedTags.capture) {
        const name = (node.markup as { name?: string | null }).name;
        if (name) writes.push(tagTyped(node.name, name, from, at, scopeEnd));
        return;
      }

      // {% graphql r %}…{% endgraphql %} / {% graphql r = 'file' %}
      if (isGraphQL(node)) {
        const name = node.markup.name;
        if (name) writes.push(tagTyped(node.name, name, from, at, scopeEnd));
        return;
      }

      // {% increment c %} / {% decrement c %}
      if (node.name === NamedTags.increment || node.name === NamedTags.decrement) {
        const name = (node.markup as { name?: string | null }).name;
        if (name) writes.push({ kind: 'counter', name, from, at, scopeEnd, tag: node.name });
      }
    },
  });

  return writes;
}

/**
 * A write that goes THROUGH the name rather than TO it, or `undefined` when it replaces the value.
 *
 * A subscript write and an append both leave the container in place, so the variable does NOT take
 * the value's type — the whole difference from a plain `{% assign %}`. Getting it wrong is a false
 * BLOCK rather than a missed detection: rebinding `h` to `string` after `{% assign h['k'] = 'V' %}`
 * makes the next write onto the same hash look like a write onto a string.
 */
function writeInto(
  name: string,
  subscripted: boolean,
  operator: string,
  from: number,
  at: number,
  scopeEnd: number | undefined,
): Write | undefined {
  // THE SUBSCRIPT WINS OVER THE OPERATOR, and the order matters: `{% assign x['k'] << 'v' %}`
  // appends to the value AT the key, so `x` itself stays whatever container it was. Reading the
  // `<<` first made it an Array and lost the Hash — caught by the `function` spelling of exactly
  // this shape in `invalid-write-target/index.spec.ts`.
  if (subscripted) return { kind: 'narrow', name, from, at, scopeEnd, becomes: 'object' };
  if (operator === '<<') return { kind: 'narrow', name, from, at, scopeEnd, becomes: 'array' };
  return undefined;
}

/** A variable the tag itself types — resolved against `tags.json` when the query happens. */
function tagTyped(
  tag: string,
  name: string,
  from: number,
  at: number,
  scopeEnd: number | undefined,
): Write {
  return { kind: 'bind', name, from, at, scopeEnd, binding: { kind: 'tag', tag } };
}

/**
 * The type of a `{% parse_json %}` body, read from the body rather than looked up.
 *
 * `[1,2]` is an Array and `{"a":1}` is a Hash, so a single published type for the tag would be
 * wrong half the time — and was: `{% parse_json x %}[1]{% endparse_json %}{% assign x << 2 %}`
 * appends on a live instance while a flat `object` reported it as an append onto a Hash.
 *
 * Only an ALL-TEXT body is the document that runs. Dropping an interpolation leaves a DIFFERENT
 * document, so a body with any Liquid in it claims nothing.
 */
function parsedJsonType(node: LiquidTag): Binding | undefined {
  const children = (node as { children?: LiquidHtmlNode[] }).children ?? [];
  if (!children.every((child) => child.type === NodeTypes.TextNode)) return undefined;

  const body = children
    .map((child) => (child as TextNode).value)
    .join('')
    .trimStart();
  if (body.startsWith('[')) return { kind: 'type', type: 'array' };
  if (body.startsWith('{')) return { kind: 'type', type: 'object' };
  return undefined;
}

/** A `@param {…}` spelling the docset's type vocabulary maps, or `undefined`. */
function declaredType(paramType: TextNode | null): LiquidType | undefined {
  const declared = paramType?.value?.toLowerCase();
  return declared ? DOCSET_TYPES[declared] : undefined;
}

function isParseJson(node: LiquidTag): node is LiquidTag & { markup: { name: string } } {
  return node.name === NamedTags.parse_json;
}

function isGraphQL(node: LiquidTag): node is LiquidTag & {
  markup: GraphQLMarkup | GraphQLInlineMarkup;
} {
  return node.name === NamedTags.graphql;
}

function isLoop(node: LiquidTag): node is LiquidTag & { markup: ForMarkup } {
  return node.name === NamedTags.for || node.name === NamedTags.tablerow;
}
