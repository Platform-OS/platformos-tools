import { Doc } from 'prettier';
import type { AstPath } from 'prettier';
import type { ParserOptions as ParserOptions3 } from 'prettier3';
import * as AST from '@platformos/liquid-html-parser';

export type CommonKeys<T1, T2> = Extract<keyof T1, keyof T2>;
export type { AstPath };
export type ParserOptions<T = any> = ParserOptions3<T>;

export function isLiquidHtmlNode(value: any): value is LiquidHtmlNode {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    AST.NodeTypes.hasOwnProperty(value.type)
  );
}

export type LiquidAstPath = AstPath<LiquidHtmlNode>;
export type LiquidParserOptions = ParserOptions<LiquidHtmlNode> & {
  singleAttributePerLine: boolean;
  singleLineLinkTags: boolean;
  liquidSingleQuote: boolean;
  embeddedSingleQuote: boolean;
  captureWhitespaceSensitivity: 'strict' | 'ignore';
  liquidDocParamDash: boolean;
};
export type LiquidPrinterArgs = {
  leadingSpaceGroupId?: symbol[] | symbol;
  trailingSpaceGroupId?: symbol[] | symbol;
  isLiquidStatement?: boolean;
  truncate?: boolean;
};
export type LiquidPrinter = (path: AstPath<LiquidHtmlNode>, args?: LiquidPrinterArgs) => Doc;

// Those properties create loops that would make walking infinite
export const nonTraversableProperties = new Set([
  'parentNode',
  'prev',
  'next',
  'firstChild',
  'lastChild',
]);

// `Augmented<T, Props>` adds properties to every node of the AST without rewriting each node
// type. It maps a property to the augmented form of whatever it holds:
//
//   LiquidNode[]         -> Augmented<LiquidNode>[]
//   string | LiquidNode  -> string | Augmented<LiquidNode>
//   LiquidNode           -> Augmented<LiquidNode>
//   string               -> string
//
// So `Augmented<LiquidTag, WithParent>` is a LiquidTag with a `parentNode`, whose `children`
// and `markup` nodes have one too, and whose `name` stays a string.
//
// Built from TypeScript generic, mapped, union and conditional types (including distribution
// over unions).
// prettier-ignore
export type Augmented<T, Aug> = {
  [Property in keyof T]: [T[Property]] extends [(infer Item)[] | undefined]
    // First branch: property?: Item[]
    ? [Item] extends [AST.LiquidHtmlNode] // If *all* Item extend AST.LiquidHtmlNode
      ? Augmented<Item, Aug>[]            // If yes, => Augmented<Node>[]
      : Item[]                            // If not, => string[], number[], etc.

    // Second branch: property is NOT Item[]
    : T[Property] extends infer P    // T[Property] to distributed P alias
      ? P extends AST.LiquidHtmlNode // Distribute if P extends AST.LiquidHtmlNode
        ? Augmented<P, Aug>          // => If yes, => Augmented<Node>
        : P                          // => If not, => string, number, Position, etc.
      : never;
} & Aug;

export type AllAugmentations = WithParent &
  WithSiblings &
  WithFamily &
  WithCssProperties &
  WithWhitespaceHelpers;

export type WithParent = {
  parentNode?: ParentNode;
};

export type WithSiblings = {
  // We're cheating here by saying the prev/next will have all the props.
  // That's kind of a lie. But it would be too complicated to do this any
  // other way.
  prev: LiquidHtmlNode | undefined;
  next: LiquidHtmlNode | undefined;
};

export type WithFamily = {
  firstChild: LiquidHtmlNode | undefined;
  lastChild: LiquidHtmlNode | undefined;
};

export type WithCssProperties = {
  cssDisplay: string;
  cssWhitespace: string;
};

export type WithWhitespaceHelpers = {
  isDanglingWhitespaceSensitive: boolean;
  isWhitespaceSensitive: boolean;
  isLeadingWhitespaceSensitive: boolean;
  isTrailingWhitespaceSensitive: boolean;
  isIndentationSensitive: boolean;
  hasLeadingWhitespace: boolean;
  hasTrailingWhitespace: boolean;
  hasDanglingWhitespace: boolean;
};

export type AugmentedNode<Aug> = Augmented<AST.LiquidHtmlNode, Aug>;

export type Augment<Aug> = <NodeType extends AugmentedNode<Aug>>(
  options: LiquidParserOptions,
  node: NodeType,
  parentNode?: NodeType,
) => void;

export type LiquidHtmlNode = Augmented<AST.LiquidHtmlNode, AllAugmentations>;
export type DocumentNode = Augmented<AST.DocumentNode, AllAugmentations>;
export type LiquidNode = Augmented<AST.LiquidNode, AllAugmentations>;
export type LiquidStatement = Augmented<AST.LiquidStatement, AllAugmentations>;
export type ParentNode = Augmented<AST.ParentNode, AllAugmentations>;
export type LiquidRawTag = Augmented<AST.LiquidRawTag, AllAugmentations>;
export type LiquidTag = Augmented<AST.LiquidTag, AllAugmentations>;
export type LiquidTagNamed = Augmented<AST.LiquidTagNamed, AllAugmentations>;
export type LiquidBranch = Augmented<AST.LiquidBranch, AllAugmentations>;
export type LiquidBranchNamed = Augmented<AST.LiquidBranchNamed, AllAugmentations>;
export type LiquidVariableOutput = Augmented<AST.LiquidVariableOutput, AllAugmentations>;
export type HtmlNode = Augmented<AST.HtmlNode, AllAugmentations>;
export type HtmlTag = Exclude<HtmlNode, HtmlComment | HtmlProcessingInstruction>;
export type HtmlElement = Augmented<AST.HtmlElement, AllAugmentations>;
export type HtmlDanglingMarkerClose = Augmented<AST.HtmlDanglingMarkerClose, AllAugmentations>;
export type HtmlVoidElement = Augmented<AST.HtmlVoidElement, AllAugmentations>;
export type HtmlSelfClosingElement = Augmented<AST.HtmlSelfClosingElement, AllAugmentations>;
export type HtmlRawNode = Augmented<AST.HtmlRawNode, AllAugmentations>;
export type HtmlDoctype = Augmented<AST.HtmlDoctype, AllAugmentations>;
export type HtmlComment = Augmented<AST.HtmlComment, AllAugmentations>;
export type HtmlProcessingInstruction = Augmented<AST.HtmlProcessingInstruction, AllAugmentations>;
export type AttributeNode = Augmented<AST.AttributeNode, AllAugmentations>;
export type AttrSingleQuoted = Augmented<AST.AttrSingleQuoted, AllAugmentations>;
export type AttrDoubleQuoted = Augmented<AST.AttrDoubleQuoted, AllAugmentations>;
export type AttrUnquoted = Augmented<AST.AttrUnquoted, AllAugmentations>;
export type AttrEmpty = Augmented<AST.AttrEmpty, AllAugmentations>;
export type LiquidExpression = Augmented<AST.LiquidExpression, AllAugmentations>;
export type TextNode = Augmented<AST.TextNode, AllAugmentations>;
export type RawMarkup = Augmented<AST.RawMarkup, AllAugmentations>;
