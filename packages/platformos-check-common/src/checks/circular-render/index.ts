import { NodeTypes, toLiquidHtmlAST, nonTraversableProperties } from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { DocumentsLocator } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';

const MAX_DEPTH = 50;

type DocumentType = 'render' | 'include' | 'function';

interface PartialRef {
  name: string;
  documentType: DocumentType;
  startIndex: number;
  endIndex: number;
}

// Module-level cache: URI -> partial references extracted from that file.
// Shared across all files in a check run to avoid re-parsing.
const parseCacheMap = new WeakMap<object, Map<string, PartialRef[]>>();

function getParseCache(context: { fs: object }): Map<string, PartialRef[]> {
  if (!parseCacheMap.has(context.fs)) {
    parseCacheMap.set(context.fs, new Map());
  }
  return parseCacheMap.get(context.fs)!;
}

/**
 * Extract partial references (render/function/include) from a Liquid source string.
 * Returns an empty array on parse errors.
 */
function extractPartialRefs(source: string): PartialRef[] {
  let ast;
  try {
    ast = toLiquidHtmlAST(source);
  } catch {
    return [];
  }

  const refs: PartialRef[] = [];
  const stack: any[] = [ast];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;

    if (
      node.type === NodeTypes.LiquidTag &&
      node.markup &&
      typeof node.markup === 'object' &&
      (node.markup.type === NodeTypes.RenderMarkup || node.markup.type === NodeTypes.FunctionMarkup) &&
      node.markup.partial &&
      node.markup.partial.type !== NodeTypes.VariableLookup
    ) {
      refs.push({
        name: node.markup.partial.value,
        documentType: (node.name as DocumentType) || 'render',
        startIndex: node.markup.partial.position.start,
        endIndex: node.markup.partial.position.end,
      });
    }

    // Traverse children (skip circular references like parentNode, prev, next)
    for (const key of Object.keys(node)) {
      if (nonTraversableProperties.has(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === 'object') {
            stack.push(child);
          }
        }
      } else if (value && typeof value === 'object' && value.type) {
        stack.push(value);
      }
    }
  }

  return refs;
}

export const CircularRender: LiquidCheckDefinition = {
  meta: {
    code: 'CircularRender',
    name: 'Prevent circular renders',
    docs: {
      description:
        'Reports circular render/function/include chains that would cause infinite loops at runtime.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/circular-render',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    const locator = new DocumentsLocator(context.fs);
    const rootUri = URI.parse(context.config.rootUri);
    const parseCache = getParseCache(context);
    const collectedRefs: PartialRef[] = [];

    return {
      async RenderMarkup(node, ancestors) {
        if (node.partial.type === NodeTypes.VariableLookup) return;
        const parent = ancestors.at(-1) as any;
        const documentType: DocumentType = parent?.name === 'include' ? 'include' : 'render';
        collectedRefs.push({
          name: node.partial.value,
          documentType,
          startIndex: node.partial.position.start,
          endIndex: node.partial.position.end,
        });
      },

      async FunctionMarkup(node) {
        if (node.partial.type === NodeTypes.VariableLookup) return;
        collectedRefs.push({
          name: node.partial.value,
          documentType: 'function',
          startIndex: node.partial.position.start,
          endIndex: node.partial.position.end,
        });
      },

      async onCodePathEnd() {
        const fileUri = context.file.uri;

        for (const ref of collectedRefs) {
          const cycle = await findCycle(
            locator,
            rootUri,
            context.fs,
            parseCache,
            fileUri,
            ref.name,
            ref.documentType,
            [fileUri],
            0,
          );

          if (cycle) {
            const cyclePath = cycle
              .map((u) => {
                const parts = u.split('/');
                return parts.slice(-2).join('/');
              })
              .join(' -> ');

            context.report({
              message: `Circular render detected: ${cyclePath}. This will cause an infinite loop at runtime.`,
              startIndex: ref.startIndex,
              endIndex: ref.endIndex,
            });
          }
        }
      },
    };
  },
};

async function findCycle(
  locator: DocumentsLocator,
  rootUri: URI,
  fs: { readFile: (uri: string) => Promise<string> },
  parseCache: Map<string, PartialRef[]>,
  originUri: string,
  partialName: string,
  documentType: DocumentType,
  path: string[],
  depth: number,
): Promise<string[] | null> {
  if (depth >= MAX_DEPTH) return null;

  const uri = await locator.locate(rootUri, documentType, partialName);
  if (!uri) return null;

  if (uri === originUri) {
    return [...path, uri];
  }

  if (path.includes(uri)) {
    // This is a cycle, but it doesn't include the origin file — skip it
    return null;
  }

  let refs = parseCache.get(uri);
  if (!refs) {
    try {
      const source = await fs.readFile(uri);
      refs = extractPartialRefs(source);
    } catch {
      refs = [];
    }
    parseCache.set(uri, refs);
  }

  for (const dep of refs) {
    const cycle = await findCycle(
      locator,
      rootUri,
      fs,
      parseCache,
      originUri,
      dep.name,
      dep.documentType,
      [...path, uri],
      depth + 1,
    );
    if (cycle) return cycle;
  }

  return null;
}
