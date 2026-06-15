import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EngineServicesClient } from '../../core/client';
import { RequestError } from '../../core/request-error';
import { resolveConfig } from './config';

export type NpmrcResult =
  | { status: 'written'; scope: string }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

/**
 * Fetches the Founders npm credentials and writes them to `<dir>/.npmrc`, so
 * `npm install` can resolve the private `@thatopen-platform` beta packages.
 *
 * Best-effort by design — it never throws, so scaffolding and login keep
 * flowing:
 * - `forbidden`: the account isn't a FOUNDING member (backend 403); no file.
 * - `error`: any other failure (network, misconfig); no file.
 * - `written`: `.npmrc` created (mode 0600, it carries a credential).
 */
export async function setupNpmrc(
  client: EngineServicesClient,
  dir: string,
): Promise<NpmrcResult> {
  try {
    const creds = await client.getNpmCredentials();
    writeFileSync(join(dir, '.npmrc'), creds.npmrc, { mode: 0o600 });
    return { status: 'written', scope: creds.scope };
  } catch (err) {
    if (err instanceof RequestError && err.status === 403) {
      return { status: 'forbidden' };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'error', message };
  }
}

/**
 * CLI glue for the `--beta` flows (`create` and `swap`): resolves the logged-in
 * config, writes an authenticated `.npmrc` into `dir`, and prints a
 * human-readable status. Best-effort — never throws, so the install still runs.
 */
export async function configureBetaNpmrc(dir: string): Promise<void> {
  const config = resolveConfig(dir);
  if (!config) {
    console.log(
      '  Beta libraries are private. Run `thatopen login --token <token>`,',
    );
    console.log(
      '  then `npm install`, or add your beta npm token to .npmrc manually.',
    );
    return;
  }
  const client = new EngineServicesClient(config.accessToken, config.apiUrl);
  const result = await setupNpmrc(client, dir);
  if (result.status === 'written') {
    console.log(`  Beta access configured — wrote .npmrc for ${result.scope}.`);
  } else if (result.status === 'forbidden') {
    console.log(
      '  Your account is not a Founding member — beta libraries need Founding',
    );
    console.log('  access, so the install will fail until you have it.');
  } else {
    console.log(
      `  Could not fetch beta npm credentials (${result.message}). Set your`,
    );
    console.log('  token in .npmrc manually if the install fails.');
  }
}
