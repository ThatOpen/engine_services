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
