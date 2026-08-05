import { isMap, isScalar, isSeq, isPair, parseAllDocuments, parseDocument } from 'yaml';
import type { Pair, Scalar, YAMLError, YAMLMap, YAMLSeq } from 'yaml';
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

export class YAMLConvertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YAMLConvertError';
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

/** One thing the YAML parser complained about, in `Problem` shape. */
export interface YAMLProblem {
  message: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Everything the YAML parser complained about, positioned.
 *
 * `toYAMLNode` refuses a document with any complaint, so this is what `YAMLSyntaxError`
 * reports — and the only reason the author hears about it at all. A duplicated mapping
 * key is named, because "map keys must be unique" without the key is a hunt, and because
 * the consequence is worth stating: one of the two values is dead.
 */
export function yamlProblems(source: string): YAMLProblem[] {
  // `parseAllDocuments`, not `parseDocument`, because of the `---` TERMINATOR: a file that
  // ends with one holds a second, empty document, and `parseDocument` calls that an error.
  // Ruby reads such a file without complaint and so do we — 83 model schemas, the instance
  // config and three translation files on one real project end that way. A second document
  // with CONTENT is a different matter: only the first is ever read.
  const documents = parseAllDocuments(source);
  const problems = documents[0]?.errors.map((error) => toProblem(error, source)) ?? [];

  const ignored = documents.slice(1).find((document) => document.toJS() != null);
  if (ignored) {
    problems.push({
      message: 'Only the first YAML document in a file is read; everything after this is ignored.',
      startIndex: ignored.range?.[0] ?? 0,
      endIndex: ignored.range?.[1] ?? source.length,
    });
  }

  return problems;
}

function toProblem(error: YAMLError, source: string): YAMLProblem {
  const [startIndex, endIndex] = error.pos;

  if (error.code === 'DUPLICATE_KEY') {
    // The parser points at the key's first character; the author wants the key.
    const key = keyAt(source, startIndex);
    return {
      message: `Duplicate key '${key.name}' — the last value wins, so the earlier one is dead.`,
      startIndex,
      endIndex: key.end,
    };
  }

  return {
    // The parser appends " at line N, column M:" and a source excerpt; the offense
    // carries the position itself.
    message: error.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, ''),
    startIndex,
    endIndex,
  };
}

/** The key token that starts at `offset`: everything up to its `:`, unquoted. */
function keyAt(source: string, offset: number): { name: string; end: number } {
  const lineEnd = source.indexOf('\n', offset);
  const line = source.slice(offset, lineEnd === -1 ? undefined : lineEnd);
  const colon = line.indexOf(':');
  const raw = (colon === -1 ? line : line.slice(0, colon)).trimEnd();
  return { name: raw.replace(/^['"]|['"]$/g, ''), end: offset + raw.length };
}

export function toYAMLNode(source: string): JSONNode {
  const doc = parseDocument(source);

  if (doc.errors.length > 0) {
    throw new YAMLConvertError(doc.errors[0].message);
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
