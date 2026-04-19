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
      fetchMock.mockResolvedValue(okResponse({ results: [] }));
      const client = new EngineServicesClient(TOKEN, API);
      await client.checkPermissionBatch([]);
      const { url, init } = getCall(fetchMock);
      const { params } = parseUrl(url);
      expect(params.get('accessToken')).toBe(TOKEN);
      expect(
        (init.headers as Record<string, string>).Authorization,
      ).toBeUndefined();
    });

    it('bearer mode sets Authorization header and omits accessToken query param', async () => {
      fetchMock.mockResolvedValue(okResponse({ results: [] }));
      const client = new EngineServicesClient(TOKEN, API, { useBearer: true });
      await client.checkPermissionBatch([]);
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

  describe('checkPermission', () => {
    it('GETs /project/permissions/check with query params', async () => {
      fetchMock.mockResolvedValue(
        okResponse({ hasPermission: true, scope: 'project' }),
      );
      const client = new EngineServicesClient(TOKEN, API);
      const result = await client.checkPermission({
        resourceType: 'APP',
        action: 'READ',
        projectId: 'proj-1',
      });
      expect(result).toEqual({ hasPermission: true, scope: 'project' });
      const { url, init } = getCall(fetchMock);
      const { pathname, params } = parseUrl(url);
      expect(pathname).toBe('/api/project/permissions/check');
      expect(init.method).toBe('GET');
      expect(params.get('resourceType')).toBe('APP');
      expect(params.get('action')).toBe('READ');
      expect(params.get('projectId')).toBe('proj-1');
    });
  });

  describe('checkPermissionBatch', () => {
    it('POSTs to /project/permissions/check/batch and returns the results array', async () => {
      fetchMock.mockResolvedValue(
        okResponse({
          results: [
            { hasPermission: true, scope: 'project' },
            { hasPermission: false, scope: 'none' },
          ],
        }),
      );
      const client = new EngineServicesClient(TOKEN, API);
      const checks = [
        {
          resourceType: 'APP',
          action: 'READ',
          projectId: 'proj-1',
        },
        {
          resourceType: 'APP',
          action: 'DELETE',
          projectId: 'proj-1',
        },
      ];
      const results = await client.checkPermissionBatch(checks);
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ hasPermission: true, scope: 'project' });
      expect(results[1]).toEqual({ hasPermission: false, scope: 'none' });

      const { url, init } = getCall(fetchMock);
      const { pathname } = parseUrl(url);
      expect(pathname).toBe('/api/project/permissions/check/batch');
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify({ checks }));
    });
  });

  describe('project-scoped list methods', () => {
    it('listProjectFiles GETs /project/:projectId/files with optional archived flag', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new EngineServicesClient(TOKEN, API);
      await client.listProjectFiles('proj-1', { archived: true });
      const { url, init } = getCall(fetchMock);
      const { pathname, params } = parseUrl(url);
      expect(pathname).toBe('/api/project/proj-1/files');
      expect(init.method).toBe('GET');
      expect(params.get('archived')).toBe('true');
    });

    it('listProjectFolders GETs /project/:projectId/folders', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new EngineServicesClient(TOKEN, API);
      await client.listProjectFolders('proj-1');
      const { url, init } = getCall(fetchMock);
      const { pathname } = parseUrl(url);
      expect(pathname).toBe('/api/project/proj-1/folders');
      expect(init.method).toBe('GET');
    });

    it('listProjectApps GETs /project/:projectId/apps', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new EngineServicesClient(TOKEN, API);
      await client.listProjectApps('proj-1');
      const { url } = getCall(fetchMock);
      const { pathname } = parseUrl(url);
      expect(pathname).toBe('/api/project/proj-1/apps');
    });

    it('listProjectComponents GETs /project/:projectId/components', async () => {
      fetchMock.mockResolvedValue(okResponse([]));
      const client = new EngineServicesClient(TOKEN, API);
      await client.listProjectComponents('proj-1');
      const { url } = getCall(fetchMock);
      const { pathname } = parseUrl(url);
      expect(pathname).toBe('/api/project/proj-1/components');
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
  });
});
