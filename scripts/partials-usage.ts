#!/usr/bin/env ts-node
import { LiquidTag, NodeTypes } from '@platformos/liquid-html-parser';
import { getAppAndConfig, path, SourceCode, SourceCodeType } from '@platformos/platformos-check-node';
import { visit } from '@platformos/platformos-language-server-common';
import { URI } from 'vscode-uri';

type UsedBy = Record<string, number>;
type Stats = Record<string, UsedBy>;

async function main() {
  const args = process.argv.slice(2);
  const appPath = args[0];
  if (!args[0]) {
    console.error('Usage: scripts/partials-usage <app-root-path>');
    console.error();
    console.error('This script will output a list of partials and the files that use them.');
    process.exit(0);
  }

  const { app } = await getAppAndConfig(appPath);
  const stats: Stats = {};
  const root = URI.file(appPath).toString();
  const liquidFiles = app.filter(
    (f): f is SourceCode<SourceCodeType.LiquidHtml> => f.type === SourceCodeType.LiquidHtml,
  );
  for (const file of liquidFiles) {
    if (file.ast instanceof Error) continue;

    const relative = path.relative(file.uri, root);

    await visit(file.ast, {
      async LiquidTag(node: LiquidTag) {
        if (node.name !== 'include' && node.name !== 'render') return;
        if (typeof node.markup === 'string') return;
        const partial = node.markup.partial;
        if (partial.type !== NodeTypes.String) return;
        const partialPath = `app/views/partials/${partial.value}.liquid`;
        stats[partialPath] ??= {};
        stats[partialPath][relative] ??= 0;
        stats[partialPath][relative]++;
      },
    });
  }

  for (const [partial, usedBy] of Object.entries(stats)) {
    console.log(partial);
    for (const [file, count] of Object.entries(usedBy)) {
      console.log(`  ${count.toString().padEnd(2)} ${file}`);
    }
  }
}

main();
