import {
  getName,
  HtmlElement,
  LiquidHTMLASTParsingError,
  LiquidHtmlNode,
  NodeTypes,
  toLiquidHtmlAST,
} from '@platformos/liquid-html-parser';
import {
  DocumentOnTypeFormattingParams,
  Position,
  Range,
  TextEdit,
} from 'vscode-languageserver-protocol';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { AugmentedLiquidSourceCode } from '../../documents';
import { findCurrentNode } from '@platformos/platformos-check-common';
import { BaseOnTypeFormattingProvider, SetCursorPosition } from '../types';

const defer = (fn: () => void) => setTimeout(fn, 10);

/**
 * Closes dangling HTML elements: typing `<script>` should insert `</script>`, but only when the
 * closing tag is not already there.
 *
 * The trick is to insert only when `document.ast` is a `LiquidHTMLASTParsingError` whose
 * unclosed element has the name just typed.
 *
 * @example
 * ```html
 *   <div id="main">
 *     <div id="inner">|
 *   </div>
 * ```
 * The inner div parses as closed and `div#main` as unclosed, so the error names a `div` and the
 * cursor sits at the end of one — which is enough to insert `</div>` after the cursor.
 */
export class HtmlElementAutoclosingOnTypeFormattingProvider implements BaseOnTypeFormattingProvider {
  constructor(private setCursorPosition: SetCursorPosition) {}

  onTypeFormatting(
    document: AugmentedLiquidSourceCode,
    params: DocumentOnTypeFormattingParams,
  ): TextEdit[] | null {
    const textDocument = document.textDocument;
    const ch = params.ch;
    // position is position of cursor so 1 ahead of char
    const { line, character } = params.position;
    switch (ch) {
      // here we fix `>` with `</$unclosed>`
      case '>': {
        const ast = document.ast;
        if (
          ast instanceof LiquidHTMLASTParsingError &&
          ast.unclosed &&
          ast.unclosed.type === NodeTypes.HtmlElement &&
          (ast.unclosed.blockStartPosition.end === textDocument.offsetAt(params.position) ||
            shouldClose(ast.unclosed, nodeAtCursor(textDocument, params.position)))
        ) {
          defer(() => this.setCursorPosition(textDocument, params.position));
          return [TextEdit.insert(Position.create(line, character), `</${ast.unclosed.name}>`)];
        } else if (!(ast instanceof Error)) {
          // Even though we accept dangling <div>s inside {% if condition %}, we prefer to auto-insert the </div>
          const [node] = findCurrentNode(ast, textDocument.offsetAt(params.position));
          if (isDanglingHtmlElement(node)) {
            defer(() => this.setCursorPosition(textDocument, params.position));
            return [TextEdit.insert(Position.create(line, character), `</${getName(node)}>`)];
          }
        }
      }
    }
    return null;
  }
}

function nodeAtCursor(textDocument: TextDocument, position: Position) {
  const text = textDocument.getText(Range.create(Position.create(0, 0), position));
  try {
    const ast = toLiquidHtmlAST(text, {
      allowUnclosedDocumentNode: true,
      mode: 'tolerant',
    });

    const [node, ancestors] = findCurrentNode(ast, textDocument.offsetAt(position));
    if (ancestors.at(-1)?.type === NodeTypes.HtmlElement) return ancestors.at(-1)!;
    if (node.type === NodeTypes.LiquidBranch) return ancestors.at(-1)!;
    return node;
  } catch {
    return null;
  }
}

function shouldClose(unclosed: any, node: LiquidHtmlNode | null) {
  if (node === null || !('blockStartPosition' in node)) return false;

  return (
    [NodeTypes.HtmlElement, NodeTypes.LiquidTag, NodeTypes.HtmlRawNode].includes(unclosed.type) &&
    getName(node) === unclosed.name
  );
}

function isDanglingHtmlElement(node: LiquidHtmlNode): node is HtmlElement {
  return (
    node !== null &&
    node.type === NodeTypes.HtmlElement &&
    node.blockEndPosition.start === node.blockEndPosition.end
  );
}
