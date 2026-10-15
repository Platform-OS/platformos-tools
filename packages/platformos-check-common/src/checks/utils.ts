import {
  Position,
  NodeTypes,
  HtmlElement,
  TextNode,
  AttrEmpty,
  AttrSingleQuoted,
  AttrDoubleQuoted,
  AttrUnquoted,
  FunctionMarkup,
  GraphQLInlineMarkup,
  GraphQLMarkup,
  LiquidHtmlNode,
  LiquidBranch,
  LiquidLiteralValues,
  LiquidTagFor,
  LiquidTagTablerow,
  LiquidTag,
  LoopNamedTags,
  NamedTags,
  RenderMarkup,
} from '@platformos/liquid-html-parser';
import {
  isObjectInScope as isObjectAccessInScope,
  parseGraphql,
  PlatformOSFileType,
} from '@platformos/platformos-common';
import { DocumentNode, GraphQLSchema } from 'graphql';

import { LiquidHtmlNodeOfType as NodeOfType, ObjectEntry } from '../types';
import { PlatformOSDocset } from '../types/platformos-liquid-docs';
import { buildGraphQLSchema } from '../utils/graphql-schema';

/**
 * Names that Liquid resolves as built-in literals before looking up variables
 * (the backend's Liquid literal table, `LiquidLiteralValues` in the
 * parser grammar). Assigning to them succeeds silently, but reading them
 * always returns the literal, never the assigned value.
 */
export const RESERVED_VARIABLE_NAMES: ReadonlySet<string> = new Set(
  Object.keys(LiquidLiteralValues),
);

type ElementType<T> = T extends (infer E)[] ? E : never;

export type ValuedHtmlAttribute = AttrSingleQuoted | AttrDoubleQuoted | AttrUnquoted;

export function isNodeOfType<T extends NodeTypes>(
  type: T,
  node?: LiquidHtmlNode,
): node is NodeOfType<T> {
  return node?.type === type;
}

export function isLiquidBranch(node: LiquidHtmlNode): node is LiquidBranch {
  return isNodeOfType(NodeTypes.LiquidBranch, node);
}

export function isHtmlTag<T>(
  node: HtmlElement,
  name: T,
): node is HtmlElement & { name: [{ name: T }]; blockEndPosition: Position } {
  return (
    node.name.length === 1 &&
    node.name[0].type === NodeTypes.TextNode &&
    node.name[0].value === name &&
    !!node.blockEndPosition
  );
}

export function isAttr(attr: ValuedHtmlAttribute | AttrEmpty, name: string) {
  return (
    attr.name.length === 1 &&
    isNodeOfType(NodeTypes.TextNode, attr.name[0]) &&
    attr.name[0].value === name
  );
}

export function isHtmlAttribute(
  attr: ElementType<HtmlElement['attributes']>,
): attr is ValuedHtmlAttribute | AttrEmpty {
  return [
    NodeTypes.AttrUnquoted,
    NodeTypes.AttrDoubleQuoted,
    NodeTypes.AttrSingleQuoted,
    NodeTypes.AttrEmpty,
  ].some((type) => isNodeOfType(type, attr));
}

export function isValuedHtmlAttribute(
  attr: ElementType<HtmlElement['attributes']>,
): attr is ValuedHtmlAttribute {
  return [NodeTypes.AttrUnquoted, NodeTypes.AttrDoubleQuoted, NodeTypes.AttrSingleQuoted].some(
    (type) => isNodeOfType(type, attr),
  );
}

export function valueIncludes(attr: ValuedHtmlAttribute, word: string) {
  const regex = new RegExp(`(^|\\s)${word}(\\s|$)`, 'g');

  return attr.value
    .filter((node): node is TextNode => isNodeOfType(NodeTypes.TextNode, node))
    .some((valueNode) => regex.test(valueNode.value));
}

export function hasAttributeValueOf(attr: ValuedHtmlAttribute, value: string) {
  return (
    attr.value.length === 1 &&
    isNodeOfType(NodeTypes.TextNode, attr.value[0]) &&
    attr.value[0].value === value
  );
}

export function isLiquidString(node: LiquidHtmlNode): node is NodeOfType<NodeTypes.String> {
  return node.type === NodeTypes.String;
}

/**
 * The tags that carry a call-site markup. `render`, `include` and `theme_render_rc` all
 * parse to a `RenderMarkup`, `function` to a `FunctionMarkup`, and every one of them is
 * also a `DocumentType` — so one answer both words the message and resolves the target.
 *
 * Written as literals rather than enum members because `DocumentType` is a union of string
 * literals and a string enum member is not assignable to one; `satisfies` ties the list to
 * `NamedTags` anyway, so a tag the parser renames fails to compile here.
 */
const CALL_SITE_TAGS = [
  'render',
  'include',
  'theme_render_rc',
  'function',
] as const satisfies readonly `${NamedTags}`[];

/** The tag a call site was written with. Every value is also a `DocumentType`. */
export type CallSiteTag = (typeof CALL_SITE_TAGS)[number];

/**
 * Which tag a call site actually spells.
 *
 * The parser gives `{% include %}`, `{% render %}` and `{% theme_render_rc %}` the same
 * `RenderMarkup` node, so the name is only on the enclosing `LiquidTag` — which a visitor
 * already receives as `ancestors.at(-1)`. A check that skips this tells the author of an
 * `include` about a "render tag" they did not write, and — since `include` runs the partial
 * in the CALLER'S scope — may be reporting something that is not wrong at all.
 *
 * The tag's own name is the answer, so a tag added to the list above needs nothing here.
 */
export function callSiteTag(
  node: RenderMarkup | FunctionMarkup,
  ancestors: LiquidHtmlNode[],
): CallSiteTag {
  const tag = ancestors.at(-1);
  if (isNodeOfType(NodeTypes.LiquidTag, tag) && isCallSiteTag(tag.name)) return tag.name;

  // Unreachable while the parser keeps each markup under the tag that produced it. The node
  // type still separates the two families, which is the most that can be said without the
  // tag — and better than naming a tag the author may not have written.
  return node.type === NodeTypes.FunctionMarkup ? 'function' : 'render';
}

function isCallSiteTag(name: string): name is CallSiteTag {
  return (CALL_SITE_TAGS as readonly string[]).includes(name);
}

export function isLoopScopedVariable(variableName: string, ancestors: LiquidHtmlNode[]) {
  return ancestors.some(
    (ancestor) =>
      ancestor.type === NodeTypes.LiquidTag &&
      isLoopLiquidTag(ancestor) &&
      typeof ancestor.markup !== 'string' &&
      ancestor.markup.variableName === variableName,
  );
}

export function isLoopLiquidTag(tag: LiquidTag): tag is LiquidTagFor | LiquidTagTablerow {
  return LoopNamedTags.includes(tag.name as any);
}

const RawTagsThatDoNotParseTheirContents = ['raw'];

function isRawTagThatDoesNotParseItsContent(node: LiquidHtmlNode) {
  return (
    node.type === NodeTypes.LiquidRawTag && RawTagsThatDoNotParseTheirContents.includes(node.name)
  );
}

export function isWithinRawTagThatDoesNotParseItsContents(ancestors: LiquidHtmlNode[]) {
  return ancestors.some(isRawTagThatDoesNotParseItsContent);
}

/**
 * Whether a documented object is in scope inside a file of `fileType`, and so must never
 * be reported as an undefined variable or a missing partial argument.
 *
 * The RULE is platformOS's, so it lives in `platformos-common` alongside the file types it
 * is expressed in; this wrapper only unpacks an `ObjectEntry`. Shared by `UndefinedObject`,
 * `PartialCallArguments` and `UnrecognizedRenderPartialArguments`.
 *
 * Contextual names (e.g. `app` inside a partial) are NOT covered: they are not documented
 * objects at all, so each check adds them separately.
 */
export function isObjectInScope(
  { access }: ObjectEntry,
  fileType: PlatformOSFileType | undefined,
): boolean {
  return isObjectAccessInScope(access, fileType);
}

/** Whether a block tag's body is text only, so the raw source between its children is its content. */
export function isPlainTextBlock(node: LiquidTag & { children?: LiquidHtmlNode[] }): boolean {
  return (node.children ?? []).every((child) => child.type === NodeTypes.TextNode);
}

export function isLiquidTagGraphQL(
  node: LiquidTag,
): node is LiquidTag & { markup: GraphQLMarkup | GraphQLInlineMarkup } {
  return node.name === NamedTags.graphql && typeof node.markup !== 'string';
}

/** An inline `{% graphql %}` body, parsed, with the file offset its source starts at. */
export interface InlineGraphQLDocument {
  document: DocumentNode;
  schema: GraphQLSchema;
  /** The body as the file spells it, so a report with no location of its own can span it. */
  source: string;
  /** Add this to any index the document reports to place it in the Liquid file. */
  startIndex: number;
}

/**
 * The GraphQL document an inline `{% graphql %}` tag carries, or `undefined` when there is
 * nothing a GraphQL-aware check may say about it.
 *
 * Shared by every check that reads an inline body, because each of the four ways this gives
 * up is a decision rather than a guard, and a second copy of them would drift:
 *
 *   - not a `{% graphql %}` tag at all;
 *   - the body is not all text, so it interpolates Liquid and the document's shape depends on
 *     values no check can know;
 *   - the body does not parse. Deliberately NOT reported: graphql-js and the platform's own
 *     parser disagree in measured ways (`rejectedByThePlatform`), and which spellings the
 *     platform accepts inline has not been measured against a live instance;
 *   - no docset, so there is no schema to validate against.
 *
 * `startIndex` is what keeps an offense on the `.liquid` file: the body is sliced from the
 * file's own source rather than joined from the children's `value` — equal for an all-text
 * body, but carrying no offset of its own — so a reported index needs only this added.
 */
export async function inlineGraphQLDocument(
  node: LiquidTag & { children?: LiquidHtmlNode[] },
  docset: PlatformOSDocset | undefined,
): Promise<InlineGraphQLDocument | undefined> {
  if (!isLiquidTagGraphQL(node)) return undefined;

  const children = node.children ?? [];
  if (children.length === 0 || !isPlainTextBlock(node)) return undefined;

  const startIndex = children[0].position.start;
  const source = node.source.slice(startIndex, children[children.length - 1].position.end);

  const { document } = parseGraphql(source);
  if (!document) return undefined;

  const sdl = await docset?.graphQL();
  if (!sdl) return undefined;

  return { document, schema: buildGraphQLSchema(sdl), source, startIndex };
}
