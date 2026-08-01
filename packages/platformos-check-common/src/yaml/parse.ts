import { isMap, isScalar, isSeq, isPair, parseDocument } from 'yaml';
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
  // `prettyErrors: false` keeps the parser's message as its own sentence. With the
  // default the library appends ` at line N, column M:` plus a source snippet, and
  // the only way back to a clean message is a regex over English. We report the
  // location structurally instead, so the prose does not need to carry it.
  const doc = parseDocument(source, { prettyErrors: false });

  // `MULTIPLE_DOCS` is NOT a defect in the file. Multi-document YAML is valid YAML;
  // the parser is objecting to being asked for a single document, which is our
  // calling convention rather than the author's mistake — and it still hands back a
  // fully parsed first document, so there is nothing degraded about the result.
  // Reporting it would put a false block on every multi-document file for a reason
  // no author could act on except by restructuring valid input.
  //
  // The cost is stated rather than hidden: when this fires, documents after the
  // first are not parsed, so a syntax error inside one of them is not seen. That is
  // already true of the error itself — `yaml` reports MULTIPLE_DOCS *instead of* a
  // syntax error in document two, not alongside it — so nothing is lost that this
  // could have caught, and the alternative trades a silent gap for a false refusal.
  const failures = doc.errors.filter((error) => error.code !== 'MULTIPLE_DOCS');

  if (failures.length > 0) {
    throw new YAMLConvertError(
      // Clamped to the source, because `yaml` points one PAST the last character
      // for an unterminated construct — a missing closing quote on the final line
      // reports at `source.length`. That is a real place to report (end of input),
      // but an unclamped range would address a position the file does not have.
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

function convertNode(node: any, source: string): JSONNode {
  if (isMap(node)) return convertMap(node, source);
  if (isSeq(node)) return convertSeq(node, source);
  if (isScalar(node)) return convertScalar(node);
  return { type: 'Literal', value: null, raw: 'null', loc: loc(0, 0) } as LiteralNode;
}

function convertMap(node: YAMLMap, source: string): ObjectNode {
  const [start, end] = getRange(node);
  return {
    type: 'Object',
    children: node.items.map((pair) => convertPair(pair as Pair<any, any>, source)),
    loc: loc(start, end),
  };
}

function convertPair(pair: Pair<any, any>, source: string): PropertyNode {
  const key = pair.key as Scalar;
  const value = pair.value;

  const [keyStart, keyEnd] = getRange(key);
  const [, valueEnd] = value ? getRange(value) : [keyEnd, keyEnd];
  const pairEnd = valueEnd > keyEnd ? valueEnd : keyEnd;

  return {
    type: 'Property',
    key: convertIdentifier(key),
    value: value
      ? (convertNode(value, source) as ValueNode)
      : ({ type: 'Literal', value: null, raw: 'null', loc: loc(keyEnd, keyEnd) } as LiteralNode),
    loc: loc(keyStart, pairEnd),
  };
}

function convertIdentifier(node: Scalar): IdentifierNode {
  const [start, end] = getRange(node);
  const value = String(node.value ?? '');
  return {
    type: 'Identifier',
    value,
    raw: JSON.stringify(value),
    loc: loc(start, end),
  };
}

function convertScalar(node: Scalar): LiteralNode {
  const [start, end] = getRange(node);
  const value = node.value as string | number | boolean | null;
  return {
    type: 'Literal',
    value,
    raw: JSON.stringify(value),
    loc: loc(start, end),
  };
}

function convertSeq(node: YAMLSeq, source: string): ArrayNode {
  const [start, end] = getRange(node);
  return {
    type: 'Array',
    children: node.items.map((item) => convertNode(item, source) as ValueNode),
    loc: loc(start, end),
  };
}
