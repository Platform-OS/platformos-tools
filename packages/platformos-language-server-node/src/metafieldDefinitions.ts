import * as child_process from 'child_process';
import { promisify } from 'node:util';

const exec = promisify(child_process.exec);

const isWin = process.platform === 'win32';

const posCliPathPromise = getPosCliPath();

export async function fetchMetafieldDefinitionsForURI(uri: string) {
  try {
    const path = await posCliPathPromise;

    if (!path) {
      return;
    }

    // Note: This command may not exist in pos-cli. If it doesn't, this will fail gracefully.
    await exec(`${path} theme metafields pull`, {
      cwd: new URL(uri),
      timeout: 10_000,
      env: {
        ...process.env,
        PLATFORMOS_LANGUAGE_SERVER: '1',
      },
    });
  } catch (_) {
    // CLI command can break because of incorrect version or not being logged in
    // If this fails, the user must fetch their own metafield definitions
  }
}

async function getPosCliPath() {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  try {
    if (isWin) {
      const { stdout } = await exec(`where.exe pos-cli`);
      const executables = stdout
        .replace(/\r/g, '')
        .split('\n')
        .filter((exe) => exe.endsWith('bat') || exe.endsWith('exe'));
      return executables.length > 0 ? executables[0] : '';
    } else {
      const { stdout } = await exec(`which pos-cli`);
      return stdout.split('\n')[0].replace('\r', '');
    }
  } catch (_) {
    // If any errors occur while trying to find the CLI, we will silently return
    return;
  }
}
