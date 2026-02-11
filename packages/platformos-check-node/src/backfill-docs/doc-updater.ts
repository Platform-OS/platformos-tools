import { toLiquidHtmlAST } from '@platformos/liquid-html-parser';
import { SourceCodeType, visit, LiquidDocParameter } from '@platformos/platformos-check-common';
import { isLiquidHtmlNode, LiquidRawTag } from '@platformos/liquid-html-parser';
import { generateDocTag } from './doc-generator';
import { ExistingParam } from './types';

interface DocTagInfo {
  exists: boolean;
  startIndex: number;
  endIndex: number;
  existingParams: ExistingParam[];
  lastParamEndIndex: number;
  docContent: string;
}

/**
 * Parse a file to extract information about existing doc tags.
 */
async function parseDocTag(source: string): Promise<DocTagInfo> {
  const result: DocTagInfo = {
    exists: false,
    startIndex: 0,
    endIndex: 0,
    existingParams: [],
    lastParamEndIndex: 0,
    docContent: '',
  };

  try {
    const ast = toLiquidHtmlAST(source);
    if (!isLiquidHtmlNode(ast)) {
      return result;
    }

    await visit<SourceCodeType.LiquidHtml, void>(ast, {
      async LiquidRawTag(node: LiquidRawTag) {
        if (node.name !== 'doc') return;

        result.exists = true;
        result.startIndex = node.position.start;
        result.endIndex = node.position.end;
        result.docContent = node.body.value;
      },

      async LiquidDocParamNode(node) {
        result.existingParams.push({
          name: node.paramName.value,
          type: node.paramType?.value ?? null,
          description: node.paramDescription?.value ?? null,
          required: node.required,
        });
        // Track the end position of the last @param line
        result.lastParamEndIndex = node.position.end;
      },
    });
  } catch {
    // Parse error - treat as no doc tag
  }

  return result;
}

/**
 * Find the correct insertion point for new @param lines within an existing doc tag.
 * Inserts after the last @param line, or at the beginning if no params exist.
 */
function findInsertionPoint(docContent: string, existingParams: ExistingParam[]): number {
  if (existingParams.length === 0) {
    // No existing params, insert at the beginning of the doc content
    // Find the first non-whitespace position after {% doc %}
    const match = docContent.match(/^\s*/);
    return match ? match[0].length : 0;
  }

  // Find the position after the last @param line
  const lines = docContent.split('\n');
  let lastParamLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('@param')) {
      lastParamLineIndex = i;
    }
  }

  if (lastParamLineIndex === -1) {
    return 0;
  }

  // Calculate the character offset to the end of the last @param line
  let offset = 0;
  for (let i = 0; i <= lastParamLineIndex; i++) {
    offset += lines[i].length + 1; // +1 for newline
  }

  return offset - 1; // Position at the end of the last @param line
}

/**
 * Detect the indentation used in an existing doc tag.
 */
function detectIndentation(docContent: string): string {
  const lines = docContent.split('\n');
  for (const line of lines) {
    const match = line.match(/^(\s*)@param/);
    if (match) {
      return match[1];
    }
  }
  return '  '; // Default to 2 spaces
}

/**
 * Update or insert a doc tag in a file's source code.
 *
 * @param source - The file source content
 * @param paramsToAdd - Array of param line strings to add
 * @returns The updated source content, or null if no changes needed
 */
export async function updateDocInSource(
  source: string,
  paramsToAdd: string[],
): Promise<string | null> {
  if (paramsToAdd.length === 0) {
    return null;
  }

  const docInfo = await parseDocTag(source);

  if (!docInfo.exists) {
    // No doc tag exists - create one at the start of the file
    const newDocTag = generateDocTag(paramsToAdd);
    return newDocTag + source;
  }

  // Doc tag exists - insert new params
  const existingParamNames = new Set(docInfo.existingParams.map((p) => p.name));

  // Filter out params that already exist
  const newParams = paramsToAdd.filter((paramLine) => {
    const match = paramLine.match(/@param\s+\{[^}]+\}\s+\[?(\w+)\]?/);
    if (match) {
      return !existingParamNames.has(match[1]);
    }
    return true;
  });

  if (newParams.length === 0) {
    return null; // No new params to add
  }

  const indentation = detectIndentation(docInfo.docContent);
  const insertionPoint = findInsertionPoint(docInfo.docContent, docInfo.existingParams);

  // Build the new doc content
  const newParamLines = newParams.map((p) => `${indentation}${p}`).join('\n');

  // Insert the new params into the doc content
  let newDocContent: string;
  if (docInfo.existingParams.length === 0) {
    // No existing params - add at the beginning with proper formatting
    newDocContent = '\n' + newParamLines + docInfo.docContent;
  } else {
    // Has existing params - insert after the last one
    const before = docInfo.docContent.slice(0, insertionPoint);
    const after = docInfo.docContent.slice(insertionPoint);
    newDocContent = before + '\n' + newParamLines + after;
  }

  // Reconstruct the doc tag
  const newDocTag = `{% doc %}${newDocContent}{% enddoc %}`;

  // Replace the old doc tag with the new one
  return source.slice(0, docInfo.startIndex) + newDocTag + source.slice(docInfo.endIndex);
}

/**
 * Get the list of existing parameter names from a file.
 */
export async function getExistingParams(source: string): Promise<ExistingParam[]> {
  const docInfo = await parseDocTag(source);
  return docInfo.existingParams;
}
