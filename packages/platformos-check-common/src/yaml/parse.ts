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
