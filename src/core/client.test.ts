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

const API = 'https://api.example.com';
const TOKEN = 'test-token';

function okResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(data),
    json: async () => data,
  } as unknown as Response;
}

function errorResponse(status: number, message = 'Bad Request'): Response {
  return {
    ok: false,
    status,
    statusText: message,
    text: async () => message,
    json: async () => ({ message }),
  } as unknown as Response;
}

function getCall(
  fetchMock: Mock,
  index = 0,
): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[index];
  return { url: call[0] as string, init: call[1] as RequestInit };
}

function parseUrl(url: string): { pathname: string; params: URLSearchParams } {
  const u = new URL(url);
  return { pathname: u.pathname, params: u.searchParams };
}

describe('EngineServicesClient — HTTP contract', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('auth mode', () => {
    it('access-token mode puts token in query string', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new EngineServicesClient(TOKEN, API);
      await client.listFiles();
      const { url, init } = getCall(fetchMock);
      const { params } = parseUrl(url);
      expect(params.get('accessToken')).toBe(TOKEN);
      expect(
        (init.headers as Record<string, string>).Authorization,
      ).toBeUndefined();
    });

    it('bearer mode sets Authorization header and omits accessToken query param', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new EngineServicesClient(TOKEN, API, { useBearer: true });
      await client.listFiles();
      const { url, init } = getCall(fetchMock);
      const { params } = parseUrl(url);
      expect(params.get('accessToken')).toBeNull();
      expect((init.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${TOKEN}`,
      );
    });
  });

  describe('executeComponent', () => {
    it('POSTs to /processor/:id/execute with JSON body including projectId when supplied', async () => {
      fetchMock.mockResolvedValue(okResponse({ executionId: 'exec-1' }));
      const client = new EngineServicesClient(TOKEN, API);
      const result = await client.executeComponent(
        'comp-42',
        { projectId: 'proj-99', foo: 'bar' },
        'v1',
      );
      expect(result).toEqual({ executionId: 'exec-1' });
      const { url, init } = getCall(fetchMock);
      const { pathname, params } = parseUrl(url);
      expect(pathname).toBe('/api/processor/comp-42/execute');
      expect(init.method).toBe('POST');
      expect(params.get('versionTag')).toBe('v1');
      expect(init.body).toBe(
        JSON.stringify({ projectId: 'proj-99', foo: 'bar' }),
      );
    });

    it('omits versionTag from query when not supplied', async () => {
      fetchMock.mockResolvedValue(okResponse({ executionId: 'exec-2' }));
      const client = new EngineServicesClient(TOKEN, API);
      await client.executeComponent('comp-42', {});
      const { url } = getCall(fetchMock);
      const { params } = parseUrl(url);
      expect(params.get('versionTag')).toBeNull();
    });
  });

  describe('listExecutions', () => {
    it('passes projectId as a query parameter when provided', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new EngineServicesClient(TOKEN, API);
      await client.listExecutions('comp-1', 'proj-1');
      const { url } = getCall(fetchMock);
      const { pathname, params } = parseUrl(url);
      expect(pathname).toBe('/api/processor/comp-1/progress');
      expect(params.get('projectId')).toBe('proj-1');
    });

    it('omits projectId when not supplied', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new EngineServicesClient(TOKEN, API);
      await client.listExecutions('comp-1');
      const { url } = getCall(fetchMock);
      const { params } = parseUrl(url);
      expect(params.get('projectId')).toBeNull();
    });
  });

  // `checkPermission` and `checkPermissionBatch` live on `PlatformClient`
  // (JWT-only routes) — their contract tests are in `platform-client.test.ts`.

  describe('project-scoped list methods — via projectId query on /item and /item/folder', () => {
    it('listFiles({ projectId }) forwards projectId on /item', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new EngineServicesClient(TOKEN, API);
      await client.listFiles({ projectId: 'proj-1', archived: true });
      const { url, init } = getCall(fetchMock);
      const { pathname, params } = parseUrl(url);
      expect(pathname).toBe('/api/item');
      expect(init.method).toBe('GET');
      expect(params.get('itemType')).toBe('FILE');
      expect(params.get('projectId')).toBe('proj-1');
      expect(params.get('archived')).toBe('true');
    });

    it('listFolders({ projectId }) forwards projectId on /item/folder', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new EngineServicesClient(TOKEN, API);
      await client.listFolders({ projectId: 'proj-1' });
      const { url, init } = getCall(fetchMock);
      const { pathname, params } = parseUrl(url);
      expect(pathname).toBe('/api/item/folder');
      expect(init.method).toBe('GET');
      expect(params.get('projectId')).toBe('proj-1');
    });

    it('listApps({ projectId }) forwards projectId on /item', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new EngineServicesClient(TOKEN, API);
      await client.listApps({ projectId: 'proj-1' });
      const { url, params } = {
        ...getCall(fetchMock),
        ...parseUrl(getCall(fetchMock).url),
      };
      expect(url).toMatch(/\/api\/item\b/);
      expect(params.get('itemType')).toBe('APP');
      expect(params.get('projectId')).toBe('proj-1');
    });

    it('listComponents({ projectId }) forwards projectId on /item', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new EngineServicesClient(TOKEN, API);
      await client.listComponents({ projectId: 'proj-1' });
      const { params } = parseUrl(getCall(fetchMock).url);
      expect(params.get('itemType')).toBe('TOOL');
      expect(params.get('projectId')).toBe('proj-1');
    });
  });

  describe('createFile / createFolder / createComponent / createApp pass projectId', () => {
    it('createFolder POSTs projectId in JSON body', async () => {
      fetchMock.mockResolvedValue(okResponse({}));
      const client = new EngineServicesClient(TOKEN, API);
      await client.createFolder('My folder', undefined, 'proj-1');
      const { url, init } = getCall(fetchMock);
      const { pathname } = parseUrl(url);
      expect(pathname).toBe('/api/item/folder');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string);
      expect(body).toMatchObject({ name: 'My folder', projectId: 'proj-1' });
    });

    it('createFile attaches projectId to the FormData body', async () => {
      fetchMock.mockResolvedValue(okResponse({}));
      const client = new EngineServicesClient(TOKEN, API);
      const file = new Blob(['dummy']) as Blob;
      await client.createFile({
        file,
        name: 'doc.ifc',
        versionTag: 'v1',
        projectId: 'proj-1',
      });
      const { init } = getCall(fetchMock);
      const formData = init.body as FormData;
      expect(formData).toBeInstanceOf(FormData);
      expect(formData.get('projectId')).toBe('proj-1');
      expect(formData.get('itemType')).toBe('FILE');
    });
  });

  describe('error handling', () => {
    it('throws when the server responds with a non-2xx status', async () => {
      fetchMock.mockResolvedValue(errorResponse(403, 'Forbidden'));
      const client = new EngineServicesClient(TOKEN, API);
      await expect(
        client.executeComponent('comp-1', { projectId: 'foreign' }),
      ).rejects.toThrow(/403/);
    });

    it('throws a RequestError exposing status, code and details from the body', async () => {
      const body = JSON.stringify({
        message: 'Components limit reached (10/10).',
        code: 'LIMIT_EXCEEDED',
        details: { limitType: 'componentsPerAccount', current: 10, max: 10 },
      });
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => body,
        json: async () => JSON.parse(body),
      } as unknown as Response);
      const client = new EngineServicesClient(TOKEN, API);
      await expect(client.executeComponent('comp-1', {})).rejects.toMatchObject(
        {
          name: 'RequestError',
          status: 403,
          code: 'LIMIT_EXCEEDED',
          message: 'Components limit reached (10/10).',
        },
      );
    });
  });

  describe('file version metadata', () => {
    it('GET hits /item/:id/version/:tag/metadata', async () => {
      fetchMock.mockResolvedValue(okResponse({ k: 'v' }));
      const client = new EngineServicesClient(TOKEN, API);
      const result = await client.getFileVersionMetadata('file-1', 'v1');
      const { url, init } = getCall(fetchMock);
      const { pathname } = parseUrl(url);
      expect(pathname).toBe('/api/item/file-1/version/v1/metadata');
      expect(init.method).toBe('GET');
      expect(result).toEqual({ k: 'v' });
    });

    it('GET forwards withDraft when provided', async () => {
      fetchMock.mockResolvedValue(okResponse({}));
      const client = new EngineServicesClient(TOKEN, API);
      await client.getFileVersionMetadata('file-1', 'draft', {
        withDraft: true,
      });
      const { url } = getCall(fetchMock);
      const { params } = parseUrl(url);
      expect(params.get('withDraft')).toBe('true');
    });

    it('PUT sends the metadata in a JSON body', async () => {
      fetchMock.mockResolvedValue(okResponse({ a: 'b' }));
      const client = new EngineServicesClient(TOKEN, API);
      await client.updateFileVersionMetadata('file-1', 'v1', { a: 'b', n: 1 });
      const { url, init } = getCall(fetchMock);
      const { pathname } = parseUrl(url);
      expect(pathname).toBe('/api/item/file-1/version/v1/metadata');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body as string)).toEqual({
        metadata: { a: 'b', n: 1 },
      });
      expect((init.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json',
      );
    });

    it('DELETE hits /item/:id/version/:tag/metadata with DELETE method', async () => {
      fetchMock.mockResolvedValue(okResponse({ success: true }));
      const client = new EngineServicesClient(TOKEN, API);
      await client.deleteFileVersionMetadata('file-1', 'v1');
      const { url, init } = getCall(fetchMock);
      const { pathname } = parseUrl(url);
      expect(pathname).toBe('/api/item/file-1/version/v1/metadata');
      expect(init.method).toBe('DELETE');
    });

    it('createFile attaches metadata to the FormData body when provided', async () => {
      fetchMock.mockResolvedValue(okResponse({}));
      const client = new EngineServicesClient(TOKEN, API);
      const file = new Blob(['x']) as Blob;
      await client.createFile({
        file,
        name: 'doc.ifc',
        versionTag: 'v1',
        metadata: { discipline: 'structural' },
      });
      const { init } = getCall(fetchMock);
      const formData = init.body as FormData;
      expect(JSON.parse(formData.get('metadata') as string)).toEqual({
        discipline: 'structural',
      });
    });

    it('encodes URL-unsafe characters in fileId and versionTag', async () => {
      fetchMock.mockResolvedValue(okResponse({}));
      const client = new EngineServicesClient(TOKEN, API);
      await client.getFileVersionMetadata('file/with slash', 'v1?bug');
      const { url } = getCall(fetchMock);
      const { pathname } = parseUrl(url);
      expect(pathname).toBe(
        '/api/item/file%2Fwith%20slash/version/v1%3Fbug/metadata',
      );
    });
  });

  describe('version archive / recover / delete', () => {
    it('listVersions GETs /item/:id/versions and forwards archived filter', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new EngineServicesClient(TOKEN, API);
      await client.listVersions('item-1', { archived: true });
      const { url, init } = getCall(fetchMock);
      const { pathname, params } = parseUrl(url);
      expect(init.method).toBe('GET');
      expect(pathname).toBe('/api/item/item-1/versions');
      expect(params.get('archived')).toBe('true');
    });

    it('listVersions omits archived param when not provided', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new EngineServicesClient(TOKEN, API);
      await client.listVersions('item-1');
      const { params } = parseUrl(getCall(fetchMock).url);
      expect(params.get('archived')).toBeNull();
    });

    it('archiveVersion PUTs /item/:id/version/:tag/archive', async () => {
      fetchMock.mockResolvedValue(okResponse({ tag: 'v2', archived: true }));
      const client = new EngineServicesClient(TOKEN, API);
      await client.archiveVersion('item-1', 'v2');
      const { url, init } = getCall(fetchMock);
      const { pathname } = parseUrl(url);
      expect(init.method).toBe('PUT');
      expect(pathname).toBe('/api/item/item-1/version/v2/archive');
    });

    it('recoverVersion PUTs /item/:id/version/:tag/recover', async () => {
      fetchMock.mockResolvedValue(okResponse({ tag: 'v2', archived: false }));
      const client = new EngineServicesClient(TOKEN, API);
      await client.recoverVersion('item-1', 'v2');
      const { url, init } = getCall(fetchMock);
      const { pathname } = parseUrl(url);
      expect(init.method).toBe('PUT');
      expect(pathname).toBe('/api/item/item-1/version/v2/recover');
    });

    it('deleteVersion DELETEs /item/:id/version/:tag', async () => {
      fetchMock.mockResolvedValue(okResponse({ success: true }));
      const client = new EngineServicesClient(TOKEN, API);
      await client.deleteVersion('item-1', 'v2');
      const { url, init } = getCall(fetchMock);
      const { pathname } = parseUrl(url);
      expect(init.method).toBe('DELETE');
      expect(pathname).toBe('/api/item/item-1/version/v2');
    });

    it('archiveVersion in bearer mode uses Authorization header', async () => {
      fetchMock.mockResolvedValue(okResponse({ tag: 'v2', archived: true }));
      const client = new EngineServicesClient(TOKEN, API, { useBearer: true });
      await client.archiveVersion('item-1', 'v2');
      const { url, init } = getCall(fetchMock);
      const { params } = parseUrl(url);
      expect(params.get('accessToken')).toBeNull();
      expect((init.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${TOKEN}`,
      );
    });

    it('deleteVersion throws when the server responds with a non-2xx', async () => {
      fetchMock.mockResolvedValue(errorResponse(404, 'Not Found'));
      const client = new EngineServicesClient(TOKEN, API);
      await expect(client.deleteVersion('item-1', 'v2')).rejects.toThrow(/404/);
    });

    it('encodes URL-unsafe characters in itemId and versionTag', async () => {
      fetchMock.mockResolvedValue(okResponse({ tag: 'v1?bug', archived: true }));
      const client = new EngineServicesClient(TOKEN, API);
      await client.archiveVersion('item/with slash', 'v1?bug');
      const { url } = getCall(fetchMock);
      const { pathname } = parseUrl(url);
      expect(pathname).toBe(
        '/api/item/item%2Fwith%20slash/version/v1%3Fbug/archive',
      );
    });
  });

  describe('getNpmCredentials', () => {
    it('GETs /api/npm-registry/credentials with the access token', async () => {
      fetchMock.mockResolvedValue(
        okResponse({
          registry: 'https://registry.npmjs.org/',
          scope: '@thatopen-platform',
          token: 'npm_ro',
          npmrc: '@thatopen-platform:registry=https://registry.npmjs.org/\n',
        }),
      );
      const client = new EngineServicesClient(TOKEN, API);
      const creds = await client.getNpmCredentials();
      const { url } = getCall(fetchMock);
      const { pathname, params } = parseUrl(url);
      expect(pathname).toBe('/api/npm-registry/credentials');
      expect(params.get('accessToken')).toBe(TOKEN);
      expect(creds.scope).toBe('@thatopen-platform');
    });

    it('throws a RequestError with status 403 for non-Founding accounts', async () => {
      fetchMock.mockResolvedValue(
        errorResponse(403, 'Community membership required'),
      );
      const client = new EngineServicesClient(TOKEN, API);
      await expect(client.getNpmCredentials()).rejects.toMatchObject({
        status: 403,
      });
    });
  });
});
