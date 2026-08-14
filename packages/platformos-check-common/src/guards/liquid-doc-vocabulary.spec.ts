import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { relativePosixPath } from '@platformos/platformos-common';
import { describe, expect, it } from 'vitest';

const packagesDir = join(__dirname, '..', '..', '..');

/**
 * The `{% doc %}` vocabulary is published by the platform, and this fails the build on a second copy.
 *
 * WHY A TEST AND NOT A CONVENTION. There were three copies before this: a list of annotation names in a
 * check package, the prose and worked examples the editor displayed in the language server, and a set of
 * five declarable types where the platform publishes seven. None of them looked wrong. Each was somebody
 * writing down what they knew, in the package that needed it, and the drift only became visible when
 * someone compared them — the grammar accepted an annotation the other two had never heard of, and the
 * editor's own example named a Shopify object as the type of a platformOS parameter.
 *
 * TWO RULES, because the vocabulary has two halves and they fail differently:
 *
 * 1. The ANNOTATION NAMES may be written down only where a parse or a print needs them. Those places
 *    cannot ask a docset — a parse is synchronous, and the printer regenerates source from an AST — and
 *    they are listed below. Anywhere else, a list of annotation names is a list that can disagree with
 *    what the platform publishes, and the editor's completions came from exactly such a list.
 * 2. The DECLARABLE TYPES cannot be policed by name at all: `string`, `number` and `object` are also
 *    JSON Schema's words, the shape analyzer's words, frontmatter's words and the language server's own
 *    type names, so scanning for them reports every neighbouring vocabulary. What is checkable is
 *    STRUCTURAL, and it is the thing that actually went wrong: `parseParamType` decides whether an
 *    author's `@param {…}` names a valid type, and its set must come from the published document —
 *    `getValidParamTypes`, or the derived `DECLARABLE_TYPES` for the narrower question of what this
 *    monorepo can infer. A hand-built set passed to it is the old bug with a new spelling.
 *
 * WHAT IS NOT A COPY: behaviour keyed by a name is not a claim about what exists.
 * `getDefaultValueForType` says a `number` completes to `0` and everything else to nothing;
 * `isTypeCompatible` says a `boolean` accepts anything. A type the platform adds tomorrow falls through
 * both. The patterns below look for COLLECTIONS — an array, a `Set`, an enum, a union, a table keyed by
 * quoted names — which is what all three of the real copies were.
 */

/** The annotations, as the docset publishes them. The subject of the scan, not a source of truth. */
const ANNOTATIONS = ['param', 'example', 'description'];

/**
 * Files allowed to spell the annotation names, each because it runs with no docset available.
 *
 * The grammar is LOAD-BEARING here rather than decorative: its `supportedTags` alternation matches the
 * union pattern below, and the control further down asserts that dropping this exemption finds it — so
 * the list cannot rot into a set of paths that match nothing.
 */
const PARSE_TIME_OWNERS = new Set([
  // The list itself, and the one copy AC#5 of TASK-84 preserves: the boundary between one annotation and
  // the free-form text of the last one is decided while parsing. The same exemption `NamedTags` has.
  'liquid-html-parser/grammar/liquid-html.ohm',
  // The CST and AST node kinds the grammar above produces. They must change WITH the grammar, and a
  // `LiquidDocParamNode` named `'param'` is a fact about the parse tree, not about what an author may
  // write — the docset can add an annotation without either file learning a new node type.
  'liquid-html-parser/src/stage-1-cst.ts',
  'liquid-html-parser/src/stage-2-ast.ts',
  // Maps those AST node kinds onto `DocDefinition.nodeType`, which is the same fact one layer up.
  'platformos-check-common/src/liquid-doc/liquidDoc.ts',
  // Regenerates `{% doc %}` source from the AST. What it prints is the node it was handed; a docset it
  // could consult would not help it print a node the parser never produced.
  'prettier-plugin-liquid/src/printer/print/liquid.ts',
]);

/** This file quotes every pattern and every deleted copy it scans for. */
const SELF = 'platformos-check-common/src/guards/liquid-doc-vocabulary.spec.ts';

/**
 * The annotation names a file writes down inside a collection.
 *
 * Quoted literals only. `description` and `example` are ordinary field names — `LiquidDocParameter` has
 * both, and so does every docset entry — so a rule that read bare object keys would report a third of
 * the repository and be exempted into meaninglessness within a week.
 */
function annotationNamesInCollections(rawSource: string): string[] {
  const alternation = ANNOTATIONS.join('|');
  // `nodeType: 'param'` is the AST discriminant a `LiquidDocParamNode` carries — parse-tree knowledge,
  // and the shape every `DocDefinition` fixture in the repository is built from. Naming it says nothing
  // about which annotations the platform offers, so it is dropped everywhere rather than exempted file by
  // file. `name: 'param'` is NOT dropped: that is how a vocabulary ENTRY is spelled, fixture included.
  const source = rawSource.replace(
    /nodeType:\s*['"`]@?(?:param|example|description)['"`]/g,
    'nodeType: _',
  );
  const literal = `['"\`]@?(?:${alternation})['"\`]`;
  const found = new Set<string>();

  const collect = (text: string) => {
    for (const [, name] of text.matchAll(new RegExp(`['"\`]@?(${alternation})['"\`]`, 'g'))) {
      found.add(name);
    }
  };

  // An array or a `Set([…])` — innermost brackets only, so a surrounding array of test cases is not
  // read as one list.
  for (const [span] of source.matchAll(/\[[^[\]]*\]/g)) collect(span);

  // An enum body, or an object literal with no nesting.
  for (const [span] of source.matchAll(/enum\s+\w+\s*\{[^{}]*\}/g)) collect(span);

  // A union of string literals, in TypeScript or in the Ohm grammar: `'a' | 'b' | 'c'`.
  for (const [span] of source.matchAll(new RegExp(`${literal}(?:\\s*\\|\\s*${literal})+`, 'g'))) {
    collect(span);
  }

  // A table keyed by them, or an enum member: `'param': {…}`, `Param = 'param',`.
  for (const [span] of source.matchAll(
    new RegExp(`(?:${literal}\\s*:|=\\s*${literal}\\s*,)`, 'g'),
  )) {
    collect(span);
  }

  return [...found].sort();
}

/**
 * Whether a file that calls `parseParamType` gets its valid-type set from the published document.
 *
 * The set is the whole question `parseParamType` answers, so a call site that builds one itself has
 * re-invented the vocabulary however the names got in there — read from a file, spread from an enum, or
 * typed out.
 */
function buildsItsOwnParamTypeSet(source: string): boolean {
  if (!source.includes('parseParamType(')) return false;

  // `param_types` is the published field: a set built from it came out of a document — the real one at
  // runtime, or the shared fixture in a test — rather than out of somebody's memory.
  return !(
    source.includes('getValidParamTypes(') ||
    source.includes('DECLARABLE_TYPES') ||
    source.includes('param_types')
  );
}

/** Every offence in the repository, given the files allowed to hold a vocabulary. */
async function vocabularyCopies(owners: Set<string>): Promise<string[]> {
  const offenders: string[] = [];

  for (const file of await scannedFiles()) {
    const relative = relativePosixPath(file, packagesDir);
    if (relative === SELF) continue;

    const source = await readFile(file, 'utf8');
    const annotations = annotationNamesInCollections(source);

    if (annotations.length >= 2 && !owners.has(relative)) {
      offenders.push(`${relative}: annotation names ${annotations.join(', ')}`);
    }

    if (buildsItsOwnParamTypeSet(source)) {
      offenders.push(
        `${relative}: a valid-param-type set that came from somewhere other than the docset`,
      );
    }
  }

  return offenders.sort();
}

describe('the {% doc %} vocabulary has one publisher', () => {
  it('is never written down again outside the parser and the printer', async () => {
    expect(await vocabularyCopies(PARSE_TIME_OWNERS)).toEqual([]);
  });

  /**
   * THE CONTROL. The assertion above says a scan found nothing, and a scan that found nothing because it
   * scanned nothing — a moved `src`, a renamed package, a regex that quietly stopped matching — says
   * exactly the same thing. Run with the grammar no longer exempt, it must find the grammar.
   */
  it('still finds the grammar, so an empty result means something', async () => {
    const withoutTheGrammar = new Set(
      [...PARSE_TIME_OWNERS].filter((owner) => !owner.endsWith('liquid-html.ohm')),
    );

    expect(await vocabularyCopies(withoutTheGrammar)).toEqual([
      'liquid-html-parser/grammar/liquid-html.ohm: annotation names description, example, param',
    ]);
  });

  /**
   * The copies this rule replaced, as the code they actually were. A pattern that no longer matches them
   * is a pattern that would not have caught the drift it was written for — and unlike the scan above,
   * these cannot be quietly satisfied by the repository changing shape.
   */
  it('catches each of the copies it replaced', () => {
    const enumOfNames = `
      export enum SupportedDocTagTypes {
        Param = 'param',
        Example = 'example',
        Description = 'description',
      }`;
    const tableOfProse = `
      export const SUPPORTED_LIQUID_DOC_TAG_HANDLES = {
        'param': { description: 'Provides information about a parameter.' },
        'example': { description: 'Provides an example.' },
        'description': { description: 'Provides information on what the partial does.' },
      };`;
    const grammarAlternation = `  supportedTags = "@example" | "@description" | "@param"`;
    const arrayOfNames = `const handles = ['param', 'example', 'description'];`;

    expect([
      annotationNamesInCollections(enumOfNames),
      annotationNamesInCollections(tableOfProse),
      annotationNamesInCollections(grammarAlternation),
      annotationNamesInCollections(arrayOfNames),
    ]).toEqual([
      ['description', 'example', 'param'],
      ['description', 'example', 'param'],
      ['description', 'example', 'param'],
      ['description', 'example', 'param'],
    ]);
  });

  it('catches a valid-type set that did not come from the docset', () => {
    const handBuilt = `
      const validTypes = new Set(['string', 'number', 'boolean', 'object', 'array']);
      const parsed = parseParamType(validTypes, node.paramType.value);`;
    const fromTheDocset = `
      const types = getValidParamTypes(vocabulary.param_types, drops);
      const parsed = types && parseParamType(new Set(types.keys()), node.paramType.value);`;
    const fromTheLattice = `
      const known = new Set<string>([...DECLARABLE_TYPES, ...liquidDrops.map((d) => d.name)]);
      const parsed = parseParamType(known, paramTypeValue);`;

    expect([
      buildsItsOwnParamTypeSet(handBuilt),
      buildsItsOwnParamTypeSet(fromTheDocset),
      buildsItsOwnParamTypeSet(fromTheLattice),
    ]).toEqual([true, false, false]);
  });

  /**
   * And the shapes that must NOT be flagged, since a guard that cries wolf gets an exemption added to it
   * until it means nothing. Each of these is real code from this package.
   */
  it('leaves behaviour keyed by a name alone', () => {
    const oneSnippet = `return name === 'param' ? \`param {$2} $1$0\` : \`\${name} $0\`;`;
    const parameterFields = `
      export interface LiquidDocParameter {
        name: string;
        description: string | null;
        required: boolean;
      }`;
    const docsetEntryFields = `
      export interface DocsetEntry {
        name: string;
        description?: string;
        examples?: Example[];
      }`;
    const liquidFixture = `const source = '{% doc %}\\n  @param {string} a - b\\n  @example x\\n{% enddoc %}';`;

    expect([
      annotationNamesInCollections(oneSnippet),
      annotationNamesInCollections(parameterFields),
      annotationNamesInCollections(docsetEntryFields),
      annotationNamesInCollections(liquidFixture),
      // The snippet table included: `name === 'param'` is a comparison, and a comparison cannot be a
      // vocabulary — it acts on ONE name and says nothing about which others exist.
    ]).toEqual([[], [], [], []]);
  });
});

/** Every workspace package's `src`, plus the grammar, which is where the parse-time exemption lives. */
async function scannedFiles(): Promise<string[]> {
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const perPackage = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => [
        ...(await sourceFiles(join(packagesDir, entry.name, 'src'))),
        ...(await sourceFiles(join(packagesDir, entry.name, 'grammar'))),
      ]),
  );

  return perPackage.flat();
}

async function sourceFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      // `.ohm.js` is generated from the `.ohm` beside it on every build, so scanning it would report the
      // grammar a second time, at a path nobody may edit.
      if (entry.name.endsWith('.ohm.js')) return [];

      return /\.(ts|tsx|js|mjs|ohm)$/.test(entry.name) ? [full] : [];
    }),
  );

  return nested.flat();
}
