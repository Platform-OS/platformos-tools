import { isMap, isScalar, isSeq, isPair, parseDocument } from 'yaml';
import { normalizeLoneCarriageReturns } from '@platformos/platformos-common';
import {
  foldedScalarValue,
  reconcileFlowScalarContinuations,
  spansReconciledBreak,
} from './flow-scalar-continuations';
import type { Pair, Scalar, YAMLMap, YAMLSeq } from 'yaml';
import type {
  ArrayNode,
  IdentifierNode,
  JSONNode,
  LiteralNode,
  Location,
  ObjectNode,
  PropertyNode,
  ValueNode,
} from '../jsonc/types';

/** One YAML parse failure, located in the source it came from. */
export interface YAMLParseFailure {
  /** The parser's own wording, with no location suffix — see {@link toYAMLNode}. */
  message: string;
  /** Character offset of the first character of the failing span. */
  offset: number;
  /** Length of that span. Zero only when the failure is at end of input. */
  length: number;
}

/**
 * A YAML document that could not be parsed, carrying WHERE it failed.
 *
 * The position is the whole point of this class. It used to hold only a message,
 * so the parse result could say *that* a file was broken but not *where*, and a
 * consumer wanting a line and column had to parse English out of the message. The
 * `yaml` package hands us character offsets for free; throwing them away and
 * recovering them by regex is strictly worse.
 */
export class YAMLConvertError extends Error {
  /** Every failure the parser reported, in source order. Never empty. */
  readonly failures: readonly YAMLParseFailure[];

  constructor(failures: readonly YAMLParseFailure[]) {
    super(failures[0].message);
    this.name = 'YAMLConvertError';
    this.failures = failures;
  }
}

function loc(start: number, end: number): Location {
  return { start: { offset: start }, end: { offset: end } };
}

function getRange(node: any): [number, number] {
  if (node && node.range && Array.isArray(node.range)) {
    const start = node.range[0] ?? 0;
    const end = node.range[1] ?? 0;
    return [start, end];
  }
  return [0, 0];
}

export function toYAMLNode(source: string): JSONNode {
  // `prettyErrors: false` keeps the parser's message as its own sentence. With the default
  // the library appends ` at line N, column M:` plus a source snippet, and the only way back
  // to a clean message is a regex over English; we report the location structurally instead.
  //
  // `uniqueKeys: false` because a REPEATED KEY IS NOT A PARSE FAILURE HERE. The library
  // defaults it to `true` and raises `DUPLICATE_KEY`, which reached the blocking gate and
  // refused writes the platform accepts — measured against `pos-cli deploy --dry-run`, which
  // takes a duplicated key at the top level, inside a property, and in a translation file.
  // The platform then resolves it LAST-WINS, exactly as `toJS` does here (measured
  // separately, by reading both values back through `liquid_exec`).
  //
  // Accepting the key does not make the discarded value harmless: `DuplicateYAMLKey` reports
  // it as a non-blocking warning. Silence here is about PARSING, not approval, and
  // `checks/yaml-syntax-error/index.spec.ts` asserts it.
  //
  // A LONE `\r` IS A LINE BREAK TO THE PLATFORM AND NOT TO THIS PARSER, so it is normalized
  // first — see `yaml-line-breaks.ts` in platformos-common. One byte for one byte, so every
  // offset below is still an offset into the caller's original source.
  const options = { prettyErrors: false, uniqueKeys: false };
  const normalized = normalizeLoneCarriageReturns(source);
  const doc = parseDocument(normalized, options);

  // `MULTIPLE_DOCS` is NOT a defect in the file. Multi-document YAML is valid YAML; the
  // parser is objecting to being asked for a single document, which is our calling convention
  // rather than the author's mistake, and it still hands back a fully parsed first document.
  //
  // The cost is stated rather than hidden: when this fires, documents after the first are not
  // parsed. That is already true of the error itself — `yaml` reports MULTIPLE_DOCS *instead
  // of* a syntax error in document two — so nothing is lost that this could have caught.
  const failures = doc.errors.filter((error) => error.code !== 'MULTIPLE_DOCS');

  // A QUOTED SCALAR MAY BE CONTINUED AT OR BELOW ITS KEY'S INDENTATION on the platform, and
  // not in YAML 1.2 — the second dialect mismatch, see `flow-scalar-continuations.ts`. Only
  // attempted once the 1.2 parse has already failed, so a valid file pays nothing, and it
  // returns null unless the reconciled bytes parse cleanly, so a genuinely broken file still
  // reports its ORIGINAL errors below rather than a reconciled guess.
  const reconciled =
    failures.length > 0 ? reconcileFlowScalarContinuations(normalized, options) : null;

  if (reconciled) {
    return convertNode(reconciled.doc.contents as any, source, {
      breaks: reconciled.breaks,
      options,
    }) as JSONNode;
  }

  if (failures.length > 0) {
    throw new YAMLConvertError(
      // Clamped to the source. `yaml` reports an unterminated construct as
      // `[length, length + 1]` — measured on a missing closing quote, an unclosed flow
      // sequence and an unclosed flow map, with and without a trailing newline.
      //
      // `length` itself is a real position (end of input) and `getPosition` places it
      // correctly; it is the `+ 1` that names nothing, so only the END is moved. The
      // resulting empty range is the honest shape for "the file stopped before it should
      // have": there is no character to underline.
      failures.map((error) => {
        const [start, end] = error.pos;
        const offset = Math.max(0, Math.min(start, source.length));
        return {
          message: error.message,
          offset,
          length: Math.max(0, Math.min(end, source.length) - offset),
        };
      }),
    );
  }

  if (doc.contents === null || doc.contents === undefined) {
    return { type: 'Object', children: [], loc: loc(0, 0) } as ObjectNode;
  }

  return convertNode(doc.contents as any, source) as JSONNode;
}

/**
 * What a reconciled parse needs in order to report honest scalar VALUES.
 *
 * Present only when `reconcileFlowScalarContinuations` did something. Offsets are valid in
 * both sources because the substitution is one byte for one byte, so `source` is always the
 * caller's original.
 */
interface Reconciled {
  /** Offsets of the line breaks that were replaced by spaces. */
  breaks: readonly number[];
  /** The same options the document was parsed with, so folding matches. */
  options: { prettyErrors: boolean; uniqueKeys: boolean };
}

function convertNode(node: any, source: string, reconciled?: Reconciled): JSONNode {
  if (isMap(node)) return convertMap(node, source, reconciled);
  if (isSeq(node)) return convertSeq(node, source, reconciled);
  if (isScalar(node)) return convertScalar(node, source, reconciled);
  return { type: 'Literal', value: null, raw: 'null', loc: loc(0, 0) } as LiteralNode;
}

/**
 * The value this scalar would have on the platform, when reconciliation changed how it reads.
 *
 * `undefined` for every scalar a reconciliation did not touch — which is all of them in a file
 * that parsed normally — so the ordinary path keeps the parser's own value untouched.
 */
function reconciledValue(
  source: string,
  start: number,
  end: number,
  reconciled?: Reconciled,
): unknown {
  if (!reconciled || !spansReconciledBreak(reconciled.breaks, start, end)) return undefined;
  return foldedScalarValue(source, start, end, reconciled.options);
}

function convertMap(node: YAMLMap, source: string, reconciled?: Reconciled): ObjectNode {
  const [start, end] = getRange(node);
  return {
    type: 'Object',
    children: node.items.map((pair) => convertPair(pair as Pair<any, any>, source, reconciled)),
    loc: loc(start, end),
  };
}

function convertPair(pair: Pair<any, any>, source: string, reconciled?: Reconciled): PropertyNode {
  const key = pair.key as Scalar;
  const value = pair.value;

  const [keyStart, keyEnd] = getRange(key);
  const [, valueEnd] = value ? getRange(value) : [keyEnd, keyEnd];
  const pairEnd = valueEnd > keyEnd ? valueEnd : keyEnd;

  return {
    type: 'Property',
    key: convertIdentifier(key, source, reconciled),
    value: value
      ? (convertNode(value, source, reconciled) as ValueNode)
      : ({ type: 'Literal', value: null, raw: 'null', loc: loc(keyEnd, keyEnd) } as LiteralNode),
    loc: loc(keyStart, pairEnd),
  };
}

function convertIdentifier(node: Scalar, source: string, reconciled?: Reconciled): IdentifierNode {
  const [start, end] = getRange(node);
  // A KEY can be a multi-line quoted scalar too, so it gets the same repair as a value.
  const repaired = reconciledValue(source, start, end, reconciled);
  const value = String((repaired !== undefined ? repaired : node.value) ?? '');
  return {
    type: 'Identifier',
    value,
    raw: JSON.stringify(value),
    loc: loc(start, end),
  };
}

function convertScalar(node: Scalar, source: string, reconciled?: Reconciled): LiteralNode {
  const [start, end] = getRange(node);
  const repaired = reconciledValue(source, start, end, reconciled);
  const value = (repaired !== undefined ? repaired : node.value) as
    string | number | boolean | null;
  return {
    type: 'Literal',
    value,
    raw: JSON.stringify(value),
    loc: loc(start, end),
  };
}

function convertSeq(node: YAMLSeq, source: string, reconciled?: Reconciled): ArrayNode {
  const [start, end] = getRange(node);
  return {
    type: 'Array',
    children: node.items.map((item) => convertNode(item, source, reconciled) as ValueNode),
    loc: loc(start, end),
  };
}
