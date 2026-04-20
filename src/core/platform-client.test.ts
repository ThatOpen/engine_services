import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'vitest';
import { EngineServicesClient } from './client';
import { PlatformClient } from './platform-client';

const API = 'https://api.example.com';
const JWT = 'test-jwt';

function okResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(data),
    json: async () => data,
  } as unknown as Response;
}

function parseUrl(url: string): { pathname: string; params: URLSearchParams } {
  const u = new URL(url);
  return { pathname: u.pathname, params: u.searchParams };
}

describe('PlatformClient — bearer-configured EngineServicesClient', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extends EngineServicesClient — full method surface is inherited', () => {
    const client = new PlatformClient(JWT, API);
    expect(client).toBeInstanceOf(EngineServicesClient);
    // Methods that only exist on the parent must be callable on PlatformClient.
    expect(typeof client.executeComponent).toBe('function');
    expect(typeof client.onExecutionProgress).toBe('function');
    expect(typeof client.listFiles).toBe('function');
    expect(typeof client.checkPermission).toBe('function');
  });

  describe('token provider — refresh-friendly auth', () => {
    it('string token is sent verbatim', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new PlatformClient('static-jwt', API);
      await client.listFiles();
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe(
        `Bearer static-jwt`,
      );
    });

    it('provider function is called on every request', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const provider = vi.fn();
      provider
        .mockResolvedValueOnce('token-v1')
        .mockResolvedValueOnce('token-v2')
        .mockResolvedValueOnce('token-v3');

      const client = new PlatformClient(provider, API);
      await client.listFiles();
      await client.listFolders();
      await client.getProject('proj-1');

      expect(provider).toHaveBeenCalledTimes(3);
      const authHeaders = fetchMock.mock.calls.map(
        (call) =>
          (call[1] as RequestInit).headers as Record<string, string>,
      );
      expect(authHeaders[0].Authorization).toBe('Bearer token-v1');
      expect(authHeaders[1].Authorization).toBe('Bearer token-v2');
      expect(authHeaders[2].Authorization).toBe('Bearer token-v3');
    });

    it('synchronous provider also works', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      let current = 'one';
      const client = new PlatformClient(() => current, API);
      await client.listFiles();
      current = 'two';
      await client.listFolders();
      const authHeaders = fetchMock.mock.calls.map(
        (c) => (c[1] as RequestInit).headers as Record<string, string>,
      );
      expect(authHeaders[0].Authorization).toBe('Bearer one');
      expect(authHeaders[1].Authorization).toBe('Bearer two');
    });
  });

  describe('fromPlatformContext', () => {
    afterEach(() => {
      (globalThis as unknown as { window?: Window }).window = undefined;
    });

    it('creates a PlatformClient from window context', () => {
      (globalThis as unknown as { window: object }).window = {
        __THATOPEN_CONTEXT__: {
          appId: 'app-1',
          projectId: 'proj-1',
          accessToken: 'ctx-jwt',
          apiUrl: 'https://api.example.com',
        },
      };
      const client = PlatformClient.fromPlatformContext();
      expect(client).toBeInstanceOf(PlatformClient);
      expect(client.context.projectId).toBe('proj-1');
      expect(client.context.accessToken).toBe('ctx-jwt');
    });
  });

  it('always authenticates with Bearer regardless of props', async () => {
    fetchMock.mockResolvedValue(okResponse([]));
    const client = new PlatformClient(JWT, API, { retries: 2 });
    await client.listFiles();
    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    const init = call[1] as RequestInit;
    const { params } = parseUrl(url);
    expect(params.get('accessToken')).toBeNull();
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${JWT}`,
    );
  });

  it('forwards projectId on project-scoped listings', async () => {
    fetchMock.mockResolvedValue(okResponse([]));
    const client = new PlatformClient(JWT, API);
    await client.listFiles({ projectId: 'proj-1' });
    const { pathname, params } = parseUrl(fetchMock.mock.calls[0][0] as string);
    expect(pathname).toBe('/api/item');
    expect(params.get('itemType')).toBe('FILE');
    expect(params.get('projectId')).toBe('proj-1');
  });

  describe('project routes (JWT-only; lives on PlatformClient only)', () => {
    it('getProject GETs /project/:id', async () => {
      fetchMock.mockResolvedValue(okResponse({ _id: 'proj-1' }));
      const client = new PlatformClient(JWT, API);
      const result = await client.getProject('proj-1');
      expect(result).toEqual({ _id: 'proj-1' });
      const { pathname } = parseUrl(fetchMock.mock.calls[0][0] as string);
      expect(pathname).toBe('/api/project/proj-1');
    });

    it('getProjectData GETs /project/:id/data', async () => {
      fetchMock.mockResolvedValue(okResponse({ project: { _id: 'proj-1' } }));
      const client = new PlatformClient(JWT, API);
      await client.getProjectData('proj-1');
      const { pathname } = parseUrl(fetchMock.mock.calls[0][0] as string);
      expect(pathname).toBe('/api/project/proj-1/data');
    });

    it('checkPermission returns { hasPermission, scope }', async () => {
      fetchMock.mockResolvedValue(
        okResponse({ hasPermission: true, scope: 'project' }),
      );
      const client = new PlatformClient(JWT, API);
      const result = await client.checkPermission({
        resourceType: 'APP',
        action: 'READ',
        projectId: 'proj-1',
      });
      expect(result).toEqual({ hasPermission: true, scope: 'project' });
      const { pathname, params } = parseUrl(
        fetchMock.mock.calls[0][0] as string,
      );
      expect(pathname).toBe('/api/project/permissions/check');
      expect(params.get('resourceType')).toBe('APP');
      expect(params.get('action')).toBe('READ');
      expect(params.get('projectId')).toBe('proj-1');
    });

    it('checkPermissionBatch POSTs /permissions/check/batch and returns results', async () => {
      fetchMock.mockResolvedValue(
        okResponse({
          results: [
            { hasPermission: true, scope: 'project' },
            { hasPermission: false, scope: 'none' },
          ],
        }),
      );
      const client = new PlatformClient(JWT, API);
      const checks = [
        { resourceType: 'APP', action: 'READ', projectId: 'proj-1' },
        { resourceType: 'APP', action: 'DELETE', projectId: 'proj-1' },
      ];
      const results = await client.checkPermissionBatch(checks);
      expect(results).toHaveLength(2);
      const call = fetchMock.mock.calls[0];
      const init = call[1] as RequestInit;
      const { pathname } = parseUrl(call[0] as string);
      expect(pathname).toBe('/api/project/permissions/check/batch');
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify({ checks }));
    });

    it('EngineServicesClient does not expose project/permission methods', () => {
      // These methods hit JWT-only backend routes; they must not exist on
      // the API-token-capable parent class.
      const parent = {} as EngineServicesClient as unknown as Record<
        string,
        unknown
      >;
      const proto = Object.getPrototypeOf(
        new (class extends EngineServicesClient {})(JWT, API),
      );
      // Walk prototype chain to collect own method names on EngineServicesClient.
      const names = Object.getOwnPropertyNames(
        Object.getPrototypeOf(proto) as object,
      );
      expect(names).not.toContain('getProject');
      expect(names).not.toContain('getProjectData');
      expect(names).not.toContain('checkPermission');
      expect(names).not.toContain('checkPermissionBatch');
      void parent;
    });
  });

  it('TypeScript: constructor has no API-token / useBearer escape hatches', () => {
    // The constructor only takes (bearerToken, apiUrl, props?). `useBearer`
    // is omitted from the props type — callers can't turn bearer off.
    // This test documents the contract; if the type widens, it breaks.
    type Ctor = ConstructorParameters<typeof PlatformClient>;
    type Props = Ctor[2];
    // @ts-expect-error — useBearer is not assignable on PlatformClient props.
    const _badProps: Props = { useBearer: false };
    void _badProps;
  });
});
