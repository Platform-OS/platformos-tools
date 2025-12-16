import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import yaml from "js-yaml";
import { DocumentsLocator, NodeType } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';
import { LiquidNamedArgument, Position } from '@platformos/liquid-html-parser';
import { getLiquidDocParams } from '../../liquid-doc/arguments';

type Metadata = {
  metadata: {
    params: Record<string, unknown>
  }
}

function extractMetadataParams(source: string): string[] | null {
  source = source.trim();
  if (!source.startsWith("---")) return null;

  const end = source.indexOf("---", 3);
  if (end === -1) return null;

  const yamlBlock = source.slice(3, end).trim();
  try {
    const result = yaml.load(yamlBlock) as Metadata;
    return Object.keys(result.metadata.params);
  } catch (e) {
    return null;
  }
}

export const MetadataParamsCheck: LiquidCheckDefinition = {
  meta: {
    code: "MetadataParamsCheck",
    name: "Metadata Params Check",
    docs: {
      description:
        "Ensures that variables referenced in the document exist in metadata.params or in the doc tag.",
      recommended: true,
      url: undefined
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    const locator = new DocumentsLocator(context.fs);
    const validate = async (nodeType: NodeType, targetFile: string, args: LiquidNamedArgument[], position: Position) => {
      const locatedFile = await locator.locate(URI.parse(context.config.rootUri), nodeType, targetFile)

      if(!locatedFile) {
        return
      }
      let params = extractMetadataParams(await context.fs.readFile(locatedFile));
      if (!params) {
        const liquidDocParameters = await getLiquidDocParams(
          context,
          locatedFile,
        );

        if(!liquidDocParameters) return;

        params = Array.from(liquidDocParameters.values()).filter(
          (p) => p.required,
        ).map(p => p.name);
      }

      args.filter(arg => !params.includes(arg.name)).forEach(arg => {
        context.report({
          message: `Unknown parameter ${arg.name} passed to ${nodeType} call`,
          startIndex: arg.position.start,
          endIndex: arg.position.end
        })
      })

      params.filter(param => !args.find(arg => arg.name === param)).forEach(param => {
        context.report({
          message: `Required parameter ${param} must be passed to ${nodeType} call`,
          startIndex: position.start,
          endIndex: position.end
        })
      })
    }

    return {
      async RenderMarkup(node) {
        const targetFile = 'value' in node.snippet ? node.snippet.value : node.snippet.name
        if (!targetFile) {
          return
        }
        
        await validate('render', targetFile, node.args, node.position)
      },
      async FunctionMarkup(node) {
        const targetFile = 'value' in node.partial ? node.partial.value : node.partial.name
        if (!targetFile) {
          return
        }

        await validate('function', targetFile, node.args, node.position)
      }
    };
  }
};
