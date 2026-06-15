import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupNpmrc } from './npmrc';
import { RequestError } from '../../core/request-error';
import type { EngineServicesClient } from '../../core/client';

function fakeClient(getNpmCredentials: () => Promise<unknown>): EngineServicesClient {
  return { getNpmCredentials } as unknown as EngineServicesClient;
}

describe('setupNpmrc', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'npmrc-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes .npmrc and returns written on success', async () => {
    const npmrc =
      '@thatopen-platform:registry=https://registry.npmjs.org/\n' +
      '//registry.npmjs.org/:_authToken=npm_ro\n';
    const client = fakeClient(async () => ({
      registry: 'https://registry.npmjs.org/',
      scope: '@thatopen-platform',
      token: 'npm_ro',
      npmrc,
    }));

    const result = await setupNpmrc(client, dir);

    expect(result).toEqual({ status: 'written', scope: '@thatopen-platform' });
    expect(readFileSync(join(dir, '.npmrc'), 'utf-8')).toBe(npmrc);
  });

  it('returns forbidden and writes nothing on a 403', async () => {
    const client = fakeClient(async () => {
      throw new RequestError(
        403,
        'Forbidden',
        JSON.stringify({ message: 'Community membership required' }),
      );
    });

    const result = await setupNpmrc(client, dir);

    expect(result).toEqual({ status: 'forbidden' });
    expect(existsSync(join(dir, '.npmrc'))).toBe(false);
  });

  it('returns error (and writes nothing) on any other failure', async () => {
    const client = fakeClient(async () => {
      throw new Error('network down');
    });

    const result = await setupNpmrc(client, dir);

    expect(result.status).toBe('error');
    expect(existsSync(join(dir, '.npmrc'))).toBe(false);
  });
});
