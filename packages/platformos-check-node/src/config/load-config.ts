import { Config } from '@platformos/platformos-check-common';
import { AbsolutePath } from '../temp';
import { loadConfigDescription } from './load-config-description';
import { resolveConfig } from './resolve';
import { ModernIdentifier } from './types';
import { validateConfig } from './validation';
import fs from 'fs/promises';

/**
 * Given an absolute path to a config file, this function returns
 * the validated Config object that it represents.
 *
 * In detail, it does the following:
 *  - resolves and merges extended config,
 *  - resolves the absolute path of the root,
 *  - loads community-provided checks,
 *  - validates check settings.
 */
export async function loadConfig(
  /** The absolute path of config file */
  configPath: AbsolutePath | ModernIdentifier | undefined,
  /** The root of the platformOS project */
  root: AbsolutePath,
): Promise<Config> {
  if (!root) throw new Error('loadConfig cannot be called without a root argument');
  const defaultChecks = 'platformos-check:recommended';

  const configDescription = await resolveConfig(configPath ?? defaultChecks, true);
  const config = await loadConfigDescription(configDescription, root);
  validateConfig(config);
  return config;
}
