import {
  Config,
  findRoot,
  loadConfig as nodeLoadConfig,
  makeFileExists,
  path,
} from '@platformos/platformos-check-node';

import { AbstractFileSystem } from '@platformos/platformos-common';
import { Dependencies, recommendedChecks } from '@platformos/platformos-language-server-common';
import { URI, Utils } from 'vscode-uri';

// Calls to `fs` should be done with this
function asFsPath(uriOrPath: string | URI) {
  if (URI.isUri(uriOrPath)) {
    return uriOrPath.fsPath;
  } else if (/^file:/i.test(uriOrPath)) {
    return URI.parse(uriOrPath).fsPath;
  } else {
    return URI.file(uriOrPath).fsPath;
  }
}

export const loadConfig: Dependencies['loadConfig'] = async function loadConfig(uriString, fs) {
  const fileUri = path.normalize(uriString);
  const fileExists = makeFileExists(fs);
  const rootUriString = await findRoot(fileUri, fileExists);
  if (!rootUriString) {
    throw new Error(`Could not find app root for ${fileUri}`);
  }

  const rootUri = URI.parse(rootUriString);
  const scheme = rootUri.scheme;
  const configUri = Utils.joinPath(rootUri, '.platformos-check.yml');
  const configExists = await fileExists(path.normalize(configUri));

  if (scheme === 'file') {
    const configPath = asFsPath(configUri);
    const rootPath = asFsPath(rootUri);
    if (configExists) {
      return nodeLoadConfig(configPath, rootPath).then(normalizeRoot);
    } else {
      return nodeLoadConfig(undefined, rootPath).then(normalizeRoot);
    }
  } else {
    // We can't load configs properly in remote environments.
    // Reading and parsing YAML files is possible, but resolving `extends` and `require` fields isn't.
    // We'll do the same thing prettier does, we just won't load configs.
    return {
      checks: recommendedChecks,
      settings: {},
      rootUri: path.normalize(rootUri),
    };
  }
};

function normalizeRoot(config: Config) {
  config.rootUri = path.normalize(config.rootUri);
  return config;
}
