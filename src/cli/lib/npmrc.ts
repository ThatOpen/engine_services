import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EngineServicesClient } from '../../core/client';
import { RequestError } from '../../core/request-error';

export type NpmrcResult =
  | { status: 'written'; scope: string }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

/**
 * Fetches the Founders npm credentials and writes them to `<dir>/.npmrc`, so
 * `npm install` can resolve the private `@thatopen` beta packages.
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
