/**
 * Read-only npm credentials for the private `@thatopen` Founders beta packages.
 * Returned by `GET /api/npm-registry/credentials` to FOUNDING members only.
 */
export interface NpmCredentials {
  /** Registry the scope is pinned to (e.g. `https://registry.npmjs.org/`). */
  registry: string;
  /** Package scope the token grants read access to (e.g. `@thatopen`). */
  scope: string;
  /** The read-only npm token. */
  token: string;
  /** Ready-to-write `.npmrc` file body (scope pin + auth line). */
  npmrc: string;
}
