import { DocumentHighlight, DocumentHighlightParams } from 'vscode-languageserver';
import { LiquidHtmlNode } from '@platformos/platformos-check-common';

export interface BaseDocumentHighlightsProvider {
  documentHighlights: (
    node: LiquidHtmlNode,
    ancestors: LiquidHtmlNode[],
    params: DocumentHighlightParams,
  ) => Promise<DocumentHighlight[] | null>;
}
