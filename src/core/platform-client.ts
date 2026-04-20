import {
  EngineServicesClient,
  EngineServicesClientProps,
} from './client';

/**
 * A drop-in `EngineServicesClient` for apps, frontends, and any caller that
 * authenticates with a user JWT instead of an API access token. Inherits the
 * full method surface of `EngineServicesClient`; the only difference is the
 * constructor: it takes the bearer token directly and always wires
 * `useBearer: true` internally.
 *
 * Use `EngineServicesClient` for components (API-token auth, local server,
 * WebSocket progress). Use `PlatformClient` for apps and FE code.
 *
 * @example
 * ```ts
 * const client = new PlatformClient(jwt, 'https://api.thatopen.com');
 * const files = await client.listFiles({ projectId });
 * const { hasPermission } = await client.checkPermission({
 *   projectId, resourceType: 'STORAGE', action: 'READ',
 * });
 * ```
 */
export class PlatformClient extends EngineServicesClient {
  /**
   * @param bearerToken - Auth0 JWT for the acting user.
   * @param apiUrl - Base URL of the API (e.g. `https://api.thatopen.com`).
   * @param props - Optional client configuration. `useBearer` is always `true`
   *   here and cannot be overridden.
   */
  constructor(
    bearerToken: string,
    apiUrl: string,
    props?: Omit<EngineServicesClientProps, 'useBearer'>,
  ) {
    super(bearerToken, apiUrl, { ...props, useBearer: true });
  }
}
