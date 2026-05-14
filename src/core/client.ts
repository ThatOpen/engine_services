import { io } from 'socket.io-client';
import {
  ExecutionEntity,
  ExecutionSuscriptionReturnType,
} from '../types/execution';
import { UpdateItemDto, UpdateItemFolderDto } from '../types/item.dto';
import {
  AppVersionProps,
  ComponentVersionProps,
  ComponentItem,
  AppItem,
  Item,
  ItemFolder,
  ItemType,
  ItemVersion,
  ItemWithVersions,
} from '../types/items';
import { CreateItemResponse, UpdateItemResponse } from '../types/response';
import {
  CreateHiddenItemResult,
  HiddenFileEntity,
  Metadata,
} from '../types/files';
import { ThatOpenContext } from '../types/context';
import { RequestError } from './request-error';

declare global {
  interface Window {
    __THATOPEN_CONTEXT__?: ThatOpenContext;
    ThatOpenCompany?: Record<string, unknown>;
  }
}

const FOLDER_PATH = 'item/folder';
const ITEM_PATH = 'item';
const PROCESS_PATH = 'processor';
const HIDDEN_PATH = 'hidden';
const ITEM_TYPE_FILE = 'FILE';
const ITEM_TYPE_COMPONENT = 'TOOL';
const ITEM_TYPE_APP = 'APP';

/**
 * Minimal shape of an OBC.Components-like object.
 * Avoids hard-coupling to `@thatopen/components` at the public API level.
 */
export interface ComponentsLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic constructor pattern requires any[]
  get<T>(c: new (...args: any[]) => T): T;
  init(): void;
}

/** Properties for creating a new item (file, component, or app). */
export type CreateItemProps = {
  /** The file to upload (File in browsers, Blob in Node.js). */
  file: File | Blob;
  /** Display name of the item. */
  name: string;
  /** Semantic version tag (e.g. "v1", "v1.0.0"). */
  versionTag: string;
  /** Optional folder ID to place the item in. */
  parentFolderId?: string;
  /** Optional project ID to associate the item with. */
  projectId?: string;
  /** Optional free-JSON metadata stored on the first version. */
  metadata?: Metadata;
};

/** Properties for updating an existing item. Combines rename/move with optional new version upload. */
export type UpdateItemProps = {
  /** New display name. */
  name?: string;
  /** New parent folder ID (moves the item). */
  parentFolderId?: string;
  /** New file to upload as a new version (File in browsers, Blob in Node.js). */
  file?: File | Blob;
  /** Version tag for the new file version. */
  versionTag?: string;
  /** Optional free-JSON metadata stored on the new version. */
  metadata?: Metadata;
};

/** Properties for creating an app. Extends {@link CreateItemProps} with app-specific version props. */
export type CreateAppProps = CreateItemProps & {
  /** App version properties (isOnline, url). */
  appProps?: AppVersionProps;
};

/** Properties for creating a component. Extends {@link CreateItemProps} with component-specific version props. */
export type CreateComponentProps = CreateItemProps & {
  /** Component version properties (type, tier, isPublic, etc.). Required. */
  componentProps: ComponentVersionProps;
};

/** Properties for updating a component. Extends {@link UpdateItemProps} with component-specific version props. */
export type UpdateComponentProps = UpdateItemProps & {
  /** Component version properties for the new version. */
  componentProps?: ComponentVersionProps;
};

/** Options for retrieving a single item. */
export type GetItemProps = {
  /** If true, includes the item's version history. */
  showVersions?: boolean;
};

/** Filter/query params for listing items. */
export type GetItemsParams = {
  /** Filter by folder. */
  folderId?: string;
  /** If true, includes version history for each item. */
  ShowVersions?: boolean;
};

/** Parameters for downloading a specific item version. */
export type DownloadItemFileParams = {
  /** Download a specific version by tag instead of the latest. */
  versionTag?: string;
  /** If true, includes draft versions in resolution. */
  withDraft?: boolean;
};

/** Configuration options for the {@link EngineServicesClient} constructor. */
export type EngineServicesClientProps = {
  /** Number of automatic retries on request failure. Default: 0. */
  retries?: number;
  /**
   * If true, sends the token as an `Authorization: Bearer` header instead of
   * an `accessToken` query parameter. Use this when authenticating with an
   * Auth0 JWT (e.g. inside platform apps) rather than a platform API token.
   */
  useBearer?: boolean;
  /**
   * URL of a local execution server started with `thatopen local-server`.
   * When set, execution methods (executeComponent, onExecutionProgress,
   * listExecutions, getExecution, abortExecution) are routed to this server
   * instead of the cloud API. All other methods remain unchanged.
   *
   * @example
   * ```ts
   * const client = new EngineServicesClient(token, apiUrl, {
   *   localServerUrl: 'http://localhost:4001',
   * });
   * ```
   */
  localServerUrl?: string;
};

/**
 * Client for the That Open Engine Services API.
 *
 * Provides methods for managing files, folders, components, apps,
 * executions, hidden files, projects, and permissions.
 *
 * @example
 * ```ts
 * import { EngineServicesClient } from 'thatopen-services';
 *
 * const client = new EngineServicesClient('my-access-token', 'https://api.thatopen.com');
 * const files = await client.listFiles();
 * ```
 */
export class EngineServicesClient {
  private apiUrl: string;
  private accessToken: string;
  private wsUrl: string;
  private retries: number;
  private useBearer: boolean;
  private builtInGlobals: Record<string, unknown> | null = null;

  /**
   * URL of a local execution server (e.g. `http://localhost:4001`).
   * When set, execution methods are routed to this server instead of the cloud API.
   * Set to `null` to disable local routing and use the cloud API.
   */
  localServerUrl: string | null = null;

  /**
   * The platform context this client was created with.
   * Contains `appId`, `projectId`, `accessToken`, and `apiUrl`.
   * Populated automatically when using {@link fromPlatformContext}.
   */
  readonly context: ThatOpenContext;

  /**
   * Creates a client from the platform context injected into
   * `window.__THATOPEN_CONTEXT__` by the That Open Platform.
   *
   * This is the recommended way to create a client inside platform apps.
   * It automatically reads the auth context and sets `useBearer: true`.
   *
   * @param props - Optional configuration (retry count, local server URL, etc.).
   * @returns A new EngineServicesClient instance.
   *
   * @example
   * ```ts
   * const client = EngineServicesClient.fromPlatformContext();
   * console.log(client.context.projectId);
   * ```
   */
  static fromPlatformContext(
    props?: Omit<EngineServicesClientProps, 'useBearer'>,
  ): EngineServicesClient {
    const ctx: ThatOpenContext =
      (typeof window !== 'undefined'
        ? window.__THATOPEN_CONTEXT__
        : null) || { appId: '', projectId: '', accessToken: '', apiUrl: '' };
    const client = new EngineServicesClient(ctx.accessToken, ctx.apiUrl, {
      ...props,
      useBearer: true,
    });
    (client as { context: ThatOpenContext }).context = ctx;
    return client;
  }

  /**
   * Creates a new EngineServicesClient instance.
   * @param accessToken - API access token (obtained from the platform dashboard)
   *   or an Auth0 JWT (when using `useBearer: true`).
   * @param apiUrl - Base URL of the API (e.g. "https://api.thatopen.com").
   * @param props - Optional configuration (retry count, auth mode, etc.).
   */
  constructor(
    accessToken: string,
    apiUrl: string,
    props?: EngineServicesClientProps,
  ) {
    const { retries = 0, useBearer = false, localServerUrl } = props || {};
    let url = apiUrl;
    if (url.charAt(url.length - 1) === '/') {
      url = url.slice(0, -1);
    }
    this.apiUrl = `${url}/api`;
    this.accessToken = accessToken;
    this.wsUrl = `${url}?accessToken=${accessToken}`;
    this.retries = retries;
    this.useBearer = useBearer;
    this.context = { appId: '', projectId: '', accessToken, apiUrl };
    if (localServerUrl) {
      let lsUrl = localServerUrl;
      if (lsUrl.charAt(lsUrl.length - 1) === '/') {
        lsUrl = lsUrl.slice(0, -1);
      }
      this.localServerUrl = lsUrl;
    }
  }

  /**
   * Sets the number of automatic retries for failed requests.
   * @param retries - Number of retries (0 = no retries).
   */
  setRetries(retries: number) {
    this.retries = retries;
  }

  /**
   * Registers the global libraries that built-in components need at runtime.
   *
   * Call this once after importing your libraries. Then every subsequent
   * {@link initBuiltInComponent} call will use these globals automatically
   * — you no longer need to pass a `globals` argument to each one.
   *
   * @param globals - Map of global names to module namespaces.
   *   Common keys: `OBC`, `OBF`, `BUI`, `CUI`, `THREE`, `FRAGS`, `MARKERJS`.
   *
   * @example
   * ```ts
   * import * as OBC from "@thatopen/components";
   * import * as OBF from "@thatopen/components-front";
   * import * as BUI from "@thatopen/ui";
   * import * as CUI from "@thatopen/ui-obc";
   * import * as THREE from "three";
   * import * as FRAGS from "@thatopen/fragments";
   *
   * client.setBuiltInGlobals({ OBC, OBF, BUI, CUI, THREE, FRAGS });
   *
   * // Now just pass the component — no globals needed:
   * await client.initBuiltInComponent(AppManager, components);
   * await client.initBuiltInComponent(ViewerToolbar, components);
   * await client.initBuiltInComponent(ModelsPanel, components);
   * ```
   */
  setBuiltInGlobals(globals: Record<string, unknown>) {
    this.builtInGlobals = globals;
  }

  #buildUrl(path: string) {
    return `${this.apiUrl}/${path}`;
  }

  /**
   * Protected extension point for subclasses that need dynamic tokens
   * (e.g. `PlatformClient` with an auth provider callback). The default
   * returns the static token captured at construction time.
   *
   * When a subclass overrides this to call an async refresh function,
   * the new token is picked up on every request — expired tokens no
   * longer stick around.
   */
  protected async resolveAccessToken(): Promise<string> {
    return this.accessToken;
  }

  async #requestApi<T = object>(
    method: string,
    path: string,
    requestData?: {
      body?: BodyInit;
      query?: object;
      contentType?:
        | 'application/json'
        | 'multipart/form-data'
        | 'application/x-www-form-urlencoded';
      retries?: number;
    },
  ): Promise<T> {
    const { body, query, contentType, retries } = requestData || {};
    const url = this.#buildUrl(path);

    const cleanQuery = this.#cleanData(query);
    const token = await this.resolveAccessToken();

    const params = {
      ...cleanQuery,
      ...(this.useBearer ? {} : { accessToken: token }),
    };

    try {
      const response = await fetch(
        url + '?' + new URLSearchParams(params).toString(),
        {
          method,
          headers: {
            Accept: 'application/json',
            ...(contentType && { 'Content-Type': contentType }),
            ...(this.useBearer && { Authorization: `Bearer ${token}` }),
          },
          ...(body && { body }),
        },
      );
      if (!response.ok) {
        const textResponse = await response
          .text()
          .then((text) => text)
          .catch(() => '');
        throw new RequestError(
          response.status,
          response.statusText,
          textResponse,
        );
      }

      return response
        .json()
        .then((data) => data as T)
        .catch(() => undefined as T);
    } catch (e) {
      let retriesAmmount = retries != null ? retries : this.retries;
      if (retriesAmmount) {
        retriesAmmount = retriesAmmount - 1;
        return await this.#requestApi(method, path, {
          ...requestData,
          retries: retriesAmmount,
        });
      } else {
        throw e;
      }
    }
  }

  /**
   * Protected extension hook for subclasses (e.g. `PlatformClient`) that
   * need to add HTTP methods against additional backend routes. Delegates
   * to the private `#requestApi` implementation so retry / auth / query-
   * cleaning logic is applied identically.
   */
  protected async request<T = object>(
    method: string,
    path: string,
    requestData?: {
      body?: BodyInit;
      query?: object;
      contentType?:
        | 'application/json'
        | 'multipart/form-data'
        | 'application/x-www-form-urlencoded';
      retries?: number;
    },
  ): Promise<T> {
    return this.#requestApi<T>(method, path, requestData);
  }

  async #requestFile(path: string, requestData?: { query?: object }) {
    const { query } = requestData || {};
    const url = this.#buildUrl(path);
    const token = await this.resolveAccessToken();
    const params = {
      ...query,
      ...(this.useBearer ? {} : { accessToken: token }),
    };
    const response = await fetch(
      url + '?' + new URLSearchParams(params).toString(),
      {
        method: 'GET',
        ...(this.useBearer && {
          headers: { Authorization: `Bearer ${token}` },
        }),
      },
    );

    return response;
  }

  // ─── Files ───────────────────────────────────────────────────────

  /**
   * Lists all files accessible by the current token.
   * @param filters - Optional filters for folder and archive status.
   * @returns Array of file items.
   */
  async listFiles(filters?: {
    folderId?: string;
    archived?: boolean;
    /**
     * Scope the listing to a project. Requires the token owner to have
     * `STORAGE:READ` role in that project; otherwise the backend returns
     * 403. Per-entity permission overrides are applied server-side.
     */
    projectId?: string;
  }) {
    const { folderId, archived, projectId } = filters || {};
    if (folderId) {
      return await this.#requestApi<Item[]>(
        'GET',
        `${FOLDER_PATH}/${folderId}/items`,
        { query: { itemType: ITEM_TYPE_FILE, archived } },
      );
    }
    return await this.#requestApi<Item[]>('GET', `${ITEM_PATH}`, {
      query: {
        itemType: ITEM_TYPE_FILE,
        archived,
        ...(projectId && { projectId }),
      },
    });
  }

  /**
   * Gets a single file by ID, optionally including version history.
   * @param fileId - The file's unique identifier.
   * @param props - Options such as whether to include versions.
   * @returns The file item, optionally with version history.
   */
  async getFile(fileId: string, props?: GetItemProps) {
    return await this.#getItem<ItemWithVersions<Item>>(fileId, props);
  }

  /**
   * Uploads a new file.
   * @param fileData - File content, name, and version tag.
   * @returns The created item and its first version.
   */
  async createFile(fileData: CreateItemProps) {
    return await this.#createItem(fileData, ITEM_TYPE_FILE);
  }

  /**
   * Updates an existing file. Can rename, move to a different folder,
   * and/or upload a new version — all in a single call.
   * @param fileId - The file's unique identifier.
   * @param fileData - Properties to update (name, folderId, file, versionTag).
   * @returns The updated item and/or the new version.
   */
  async updateFile(
    fileId: string,
    fileData: UpdateItemProps,
  ): Promise<UpdateItemResponse> {
    return await this.#updateItem(fileId, fileData);
  }

  /**
   * Archives (soft-deletes) a file. Can be recovered with {@link recoverFile}.
   * @param fileId - The file's unique identifier.
   */
  async archiveFile(fileId: string) {
    return await this.#requestApi<Item>('DELETE', `${ITEM_PATH}/${fileId}`);
  }

  /**
   * Recovers a previously archived file.
   * @param fileId - The file's unique identifier.
   */
  async recoverFile(fileId: string) {
    return await this.#requestApi<Item>(
      'PUT',
      `${ITEM_PATH}/${fileId}/recover`,
    );
  }

  /**
   * Downloads a file's content. Returns the raw fetch Response.
   * @param fileId - The file's unique identifier.
   * @param params - Optional version selection parameters.
   * @returns A fetch Response containing the file data.
   */
  async downloadFile(fileId: string, params?: DownloadItemFileParams) {
    return await this.#downloadItem(fileId, params);
  }

  /**
   * Retrieves the free-JSON metadata for a specific file version.
   * Returns `{}` when the version exists but has no metadata.
   * @param fileId - The file's unique identifier.
   * @param versionTag - The version tag (e.g. "v1").
   * @param params - Optional flags such as `withDraft`.
   */
  async getFileVersionMetadata(
    fileId: string,
    versionTag: string,
    params?: { withDraft?: boolean },
  ) {
    const { withDraft } = params || {};
    return await this.#requestApi<Metadata>(
      'GET',
      `${ITEM_PATH}/${encodeURIComponent(fileId)}/version/${encodeURIComponent(versionTag)}/metadata`,
      {
        query: {
          ...(withDraft && { withDraft: 'true' }),
        },
      },
    );
  }

  /**
   * Replaces the metadata of a specific file version with the provided object.
   * @param fileId - The file's unique identifier.
   * @param versionTag - The version tag.
   * @param metadata - Free-JSON object (max 200 fields, 50-char keys/values).
   */
  async updateFileVersionMetadata(
    fileId: string,
    versionTag: string,
    metadata: Metadata,
  ) {
    return await this.#requestApi<Metadata>(
      'PUT',
      `${ITEM_PATH}/${encodeURIComponent(fileId)}/version/${encodeURIComponent(versionTag)}/metadata`,
      {
        body: JSON.stringify({ metadata }),
        contentType: 'application/json',
      },
    );
  }

  /**
   * Clears all metadata from a specific file version.
   * @param fileId - The file's unique identifier.
   * @param versionTag - The version tag.
   */
  async deleteFileVersionMetadata(fileId: string, versionTag: string) {
    return await this.#requestApi<{ success: boolean }>(
      'DELETE',
      `${ITEM_PATH}/${encodeURIComponent(fileId)}/version/${encodeURIComponent(versionTag)}/metadata`,
    );
  }

  // ─── Folders ─────────────────────────────────────────────────────

  /**
   * Lists all folders accessible by the current token.
   * @param params - Optional filters for parent folder and archive status.
   * @returns Array of folder items.
   */
  async listFolders(params?: {
    parentFolderId?: string;
    archived?: boolean;
    /**
     * Scope the listing to a project. Requires the token owner to have
     * `STORAGE:READ` in that project; returns 403 otherwise.
     */
    projectId?: string;
  }) {
    const { archived, parentFolderId, projectId } = params || {};
    return await this.#requestApi<ItemFolder[]>('GET', FOLDER_PATH, {
      query: {
        parentFolderId,
        archived,
        ...(projectId && { projectId }),
      },
    });
  }

  /**
   * Gets a single folder by ID.
   * @param folderId - The folder's unique identifier.
   */
  async getFolder(folderId: string) {
    return await this.#requestApi<ItemFolder>(
      'GET',
      `${FOLDER_PATH}/${folderId}`,
    );
  }

  /**
   * Creates a new folder.
   * @param name - Display name for the folder.
   * @param parentId - Optional parent folder ID for nesting.
   * @returns The created folder.
   */
  async createFolder(name: string, parentId?: string, projectId?: string) {
    return await this.#requestApi<ItemFolder>('POST', FOLDER_PATH, {
      body: JSON.stringify({
        name,
        ...(parentId && { parentId }),
        ...(projectId && { projectId }),
      }),
      contentType: 'application/json',
    });
  }

  /**
   * Renames a folder.
   * @param folderId - The folder's unique identifier.
   * @param updateFolderParams - New name for the folder.
   * @returns The updated folder.
   */
  async updateFolder(folderId: string, updateFolderParams: { name?: string }) {
    const { name } = updateFolderParams;
    return await this.#requestApi<ItemFolder>(
      'PUT',
      `${FOLDER_PATH}/${folderId}`,
      {
        body: JSON.stringify({ name } as UpdateItemFolderDto),
        contentType: 'application/json',
      },
    );
  }

  /**
   * Archives (soft-deletes) a folder. Can be recovered with {@link recoverFolder}.
   * @param folderId - The folder's unique identifier.
   */
  async archiveFolder(folderId: string) {
    return await this.#requestApi<ItemFolder>(
      'DELETE',
      `${FOLDER_PATH}/${folderId}`,
    );
  }

  /**
   * Recovers a previously archived folder.
   * @param folderId - The folder's unique identifier.
   */
  async recoverFolder(folderId: string) {
    return await this.#requestApi<ItemFolder>(
      'PUT',
      `${FOLDER_PATH}/${folderId}/recover`,
    );
  }

  /**
   * Downloads an entire folder as a ZIP archive.
   * @param folderId - The folder's unique identifier.
   * @returns A fetch Response containing the ZIP data.
   */
  async downloadFolder(folderId: string) {
    return await this.#requestFile(`${FOLDER_PATH}/${folderId}/download`);
  }

  // ─── Components ──────────────────────────────────────────────────

  /**
   * Lists all components (tools) accessible by the current token.
   * @param params - Optional filters for folder and version inclusion.
   * @returns Array of component items.
   */
  async listComponents(params?: GetItemsParams & { projectId?: string }) {
    const { folderId, ShowVersions, projectId } = params || {};
    if (folderId) {
      return await this.#requestApi<ComponentItem[]>(
        'GET',
        `${FOLDER_PATH}/${folderId}/items`,
        {
          query: {
            itemType: ITEM_TYPE_COMPONENT,
            ...(ShowVersions && { ShowVersions }),
          },
        },
      );
    }
    return await this.#requestApi<ComponentItem[]>('GET', `${ITEM_PATH}`, {
      query: {
        itemType: ITEM_TYPE_COMPONENT,
        ...(ShowVersions && { ShowVersions }),
        ...(projectId && { projectId }),
      },
    });
  }

  /**
   * Gets a single component by ID, optionally including version history.
   * @param componentId - The component's unique identifier.
   * @param props - Options such as whether to include versions.
   */
  async getComponent(componentId: string, props?: GetItemProps) {
    return await this.#getItem<ItemWithVersions<ComponentItem>>(
      componentId,
      props,
    );
  }

  /**
   * Creates a new component with the given file and version properties.
   * @param componentData - File content, name, version tag, and component-specific props.
   * @returns The created component item and its first version.
   */
  async createComponent(componentData: CreateComponentProps) {
    const { componentProps } = componentData;
    return await this.#createItem<ComponentItem, ComponentVersionProps>(
      componentData,
      ITEM_TYPE_COMPONENT,
      componentProps,
    );
  }

  /**
   * Updates an existing component. Can rename, move, and/or upload a new version.
   * @param componentId - The component's unique identifier.
   * @param componentData - Properties to update, including optional new componentProps.
   * @returns The updated item and/or new version.
   */
  async updateComponent(
    componentId: string,
    componentData: UpdateComponentProps,
  ): Promise<UpdateItemResponse<ComponentItem>> {
    const { componentProps } = componentData;
    return await this.#updateItem<ComponentItem, ComponentVersionProps>(
      componentId,
      componentData,
      componentProps,
    );
  }

  /**
   * Downloads a component's full ZIP file. Returns the raw fetch Response.
   * @param componentId - The component's unique identifier.
   * @param params - Optional version selection parameters.
   * @returns A fetch Response containing the ZIP data.
   */
  async downloadComponent(
    componentId: string,
    params?: DownloadItemFileParams,
  ) {
    return await this.#downloadItem(componentId, params);
  }

  /**
   * Downloads only the JavaScript bundle from a component's ZIP.
   * This is the extracted `bundle` entry, returned as text.
   * @param componentId - The component's unique identifier.
   * @param params - Optional version selection parameters.
   * @returns A fetch Response containing the bundle JavaScript text.
   */
  async downloadComponentBundle(
    componentId: string,
    params?: DownloadItemFileParams,
  ) {
    const { versionTag, withDraft } = params || {};
    return await this.#requestFile(
      `${ITEM_PATH}/${componentId}/download/bundle`,
      {
        query: {
          ...(versionTag && { versionTag }),
          ...(withDraft && { withDraft }),
        },
      },
    );
  }

  /**
   * Archives (soft-deletes) a component. Can be recovered with {@link recoverComponent}.
   * @param componentId - The component's unique identifier.
   */
  async archiveComponent(componentId: string) {
    return await this.#requestApi<ComponentItem>(
      'DELETE',
      `${ITEM_PATH}/${componentId}`,
    );
  }

  /**
   * Recovers a previously archived component.
   * @param componentId - The component's unique identifier.
   */
  async recoverComponent(componentId: string) {
    return await this.#requestApi<ComponentItem>(
      'PUT',
      `${ITEM_PATH}/${componentId}/recover`,
    );
  }

  // ─── Built-in Components ─────────────────────────────────────────

  /**
   * Fetches a built-in component's JavaScript bundle by name.
   * @param name - The built-in component name (e.g. "hello-world").
   * @returns The component's JavaScript source code as a string.
   */
  async getBuiltInComponent(name: string): Promise<string> {
    const response = await this.#requestFile(`built-in/${name}/bundle`);
    return await response.text();
  }

  /**
   * Fetches a built-in component bundle, evaluates it, and registers it
   * with the given `components` instance via `components.get()`.
   *
   * After calling this, retrieve the singleton instance with
   * `components.get(ComponentClass)`.
   *
   * @param component - The component class stub (must have a static `uuid`).
   * @param components - The OBC `Components` instance used to register the
   *   component (must expose a `.get()` method).
   * @param globals - Map of global names to values that the component source
   *   expects in scope (e.g. `{ OBC, BUI }`). If omitted, falls back to
   *   globals registered via {@link setBuiltInGlobals}, then to
   *   `window.ThatOpenCompany`.
   *
   * @example
   * ```ts
   * // Option 1: register globals once, then init without passing them
   * client.setBuiltInGlobals({ OBC, OBF, BUI, CUI, THREE, FRAGS });
   * await client.initBuiltInComponent(AppManager, components);
   * await client.initBuiltInComponent(ViewerToolbar, components);
   *
   * // Option 2: pass globals per component (still works)
   * await client.initBuiltInComponent(HelloWorld, components, { OBC, BUI });
   * ```
   */
  async initBuiltInComponent(
    component: { uuid: string },
    components: ComponentsLike,
    globals?: Record<string, unknown>,
  ): Promise<void> {
    const source = await this.getBuiltInComponent(component.uuid);
    const resolvedGlobals =
      globals ??
      this.builtInGlobals ??
      (typeof window !== 'undefined' ? window.ThatOpenCompany : {}) ??
      {};

    const keys = Object.keys(resolvedGlobals);
    const values = keys.map((k) => resolvedGlobals[k]);

    const factory = new Function(...keys, `${source}\nreturn main;`);
    const main = factory(...values);

    const componentDefinition = main?.componentDefinition ?? main;
    components.get(componentDefinition);
  }

  /**
   * Loads multiple built-in components in parallel.
   *
   * Convenience wrapper around {@link initBuiltInComponent} that fetches
   * and registers all given component stubs concurrently.
   *
   * @param components - The OBC `Components` instance.
   * @param stubs - One or more component stubs (e.g. `AppManager`, `ViewportManager`).
   *
   * @example
   * ```ts
   * await client.initBuiltInComponents(components, AppManager, ViewportManager);
   * ```
   */
  async initBuiltInComponents(
    components: ComponentsLike,
    ...stubs: { uuid: string }[]
  ): Promise<void> {
    await Promise.all(
      stubs.map((s) => this.initBuiltInComponent(s, components)),
    );
  }

  /**
   * High-level helper that creates an OBC component system, initialises BUI,
   * loads built-in components, and starts the engine — all in one call.
   *
   * @param globals - Map of global names to module namespaces
   *   (must include at least `OBC` and `BUI`).
   * @param builtIns - Built-in component stubs to load (e.g. `AppManager`, `ViewportManager`).
   * @returns An object containing the initialised `components` instance.
   *
   * @example
   * ```ts
   * const { components } = await client.setup(
   *   { OBC, OBF, BUI, CUI, THREE, FRAGS },
   *   AppManager, ViewportManager,
   * );
   *
   * const viewports = components.get(ViewportManager);
   * const { element, world } = await viewports.create();
   * ```
   */
  async setup<TComponents extends ComponentsLike = ComponentsLike>(
    globals: Record<string, unknown>,
    ...builtIns: { uuid: string }[]
  ): Promise<{ components: TComponents }> {
    const OBC = globals.OBC as { Components?: new () => TComponents } | undefined;
    const BUI = globals.BUI as { Manager?: { init(): void } } | undefined;
    if (!OBC?.Components)
      throw new Error('globals.OBC must include Components');
    if (!BUI?.Manager) throw new Error('globals.BUI must include Manager');

    const components = new OBC.Components();
    BUI.Manager.init();
    this.setBuiltInGlobals(globals);
    await this.initBuiltInComponents(components, ...builtIns);
    components.init();
    this.context.appEventOrchestrator?.appLoaded?.();
    return { components };
  }

  /**
   * Reports an error to the platform via the {@link AppEventOrchestrator.appError} callback.
   * @param code - Numeric error code.
   * @param data - Arbitrary error data to send to the platform.
   */
  throwError(code: number, data: Record<string, string>): void {
    this.context.appEventOrchestrator?.appError?.(code, data);
  }

  // ─── Apps ────────────────────────────────────────────────────────

  /**
   * Lists all apps accessible by the current token.
   * @param params - Optional filters for folder and version inclusion.
   * @returns Array of app items.
   */
  async listApps(params?: GetItemsParams & { projectId?: string }) {
    const { folderId, ShowVersions, projectId } = params || {};
    if (folderId) {
      return await this.#requestApi<AppItem[]>(
        'GET',
        `${FOLDER_PATH}/${folderId}/items`,
        {
          query: {
            itemType: ITEM_TYPE_APP,
            ...(ShowVersions && { ShowVersions }),
          },
        },
      );
    }
    return await this.#requestApi<AppItem[]>('GET', `${ITEM_PATH}`, {
      query: {
        itemType: ITEM_TYPE_APP,
        ...(ShowVersions && { ShowVersions }),
        ...(projectId && { projectId }),
      },
    });
  }

  /**
   * Creates a new app with the given file and optional version properties.
   * @param appData - File content, name, version tag, and optional app-specific props.
   * @returns The created app item and its first version.
   */
  async createApp(appData: CreateAppProps) {
    const { appProps } = appData;
    return await this.#createItem<AppItem, AppVersionProps>(
      appData,
      ITEM_TYPE_APP,
      appProps,
    );
  }

  /**
   * Downloads an app's full ZIP file. Returns the raw fetch Response.
   * @param appId - The app's unique identifier.
   * @param params - Optional version selection parameters.
   * @returns A fetch Response containing the ZIP data.
   */
  async downloadApp(appId: string, params?: DownloadItemFileParams) {
    return await this.#downloadItem(appId, params);
  }

  /**
   * Downloads only the JavaScript bundle from an app's ZIP.
   * This is the extracted `bundle` entry, returned as text.
   * @param appId - The app's unique identifier.
   * @param params - Optional version selection parameters.
   * @returns A fetch Response containing the bundle JavaScript text.
   */
  async downloadAppBundle(appId: string, params?: DownloadItemFileParams) {
    const { versionTag, withDraft } = params || {};
    return await this.#requestFile(
      `${ITEM_PATH}/${appId}/download/bundle`,
      {
        query: {
          ...(versionTag && { versionTag }),
          ...(withDraft && { withDraft }),
        },
      },
    );
  }

  /**
   * Archives (soft-deletes) an app.
   * @param appId - The app's unique identifier.
   */
  async archiveApp(appId: string) {
    return await this.#requestApi<AppItem>('DELETE', `${ITEM_PATH}/${appId}`);
  }

  // ─── Execution ───────────────────────────────────────────────────

  /**
   * Triggers server-side execution of a cloud component.
   *
   * Pass `projectId` in `executionParams` when running the component in the
   * context of a specific project. The backend validates that the component
   * is linked to that project AND that the user has execute permission
   * there; a foreign `projectId` is rejected with 403. Omit `projectId` for
   * personal executions (ownership path).
   *
   * @param componentId - The component's unique identifier.
   * @param executionParams - Arbitrary parameters passed to the component's `main()` function. Include `projectId` to scope the execution.
   * @param versionTag - Optional version to execute (defaults to latest).
   * @returns An object containing the `executionId` to track progress.
   */
  async executeComponent(
    componentId: string,
    executionParams: { projectId?: string; [key: string]: unknown },
    versionTag?: string,
  ) {
    if (this.localServerUrl) {
      const url = `${this.localServerUrl}/api/${PROCESS_PATH}/${componentId}/execute`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(executionParams),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Local server request failed: ${response.status} - ${text}`);
      }
      return (await response.json()) as { executionId: string };
    }
    return await this.#requestApi<{ executionId: string }>(
      'POST',
      `${PROCESS_PATH}/${componentId}/execute`,
      {
        body: JSON.stringify(executionParams),
        query: { ...(versionTag && { versionTag }) },
        contentType: 'application/json',
      },
    );
  }

  /**
   * Aborts a running execution.
   * @param executionId - The execution's unique identifier.
   */
  async abortExecution(executionId: string) {
    if (this.localServerUrl) {
      const url = `${this.localServerUrl}/api/${PROCESS_PATH}/progress/${executionId}/abort`;
      const response = await fetch(url, { method: 'POST' });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Local server request failed: ${response.status} - ${text}`);
      }
      return (await response.json()) as ExecutionEntity;
    }
    return await this.#requestApi<ExecutionEntity>(
      'POST',
      `${PROCESS_PATH}/progress/${executionId}/abort`,
    );
  }

  /**
   * Lists all executions for a given component.
   *
   * When `projectId` is supplied, the backend scopes the query to that
   * project — returning only executions launched in that context AND
   * enforcing that the caller has access to the component there. Without
   * `projectId`, the caller's personal executions for the component are
   * returned.
   *
   * @param componentId - The component's unique identifier.
   * @param projectId - Optional project scope.
   * @returns Array of execution entities.
   */
  async listExecutions(componentId: string, projectId?: string) {
    if (this.localServerUrl) {
      const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
      const url = `${this.localServerUrl}/api/${PROCESS_PATH}/${componentId}/progress${qs}`;
      const response = await fetch(url);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
          `Local server request failed: ${response.status} - ${text}`,
        );
      }
      return (await response.json()) as ExecutionEntity[];
    }
    return await this.#requestApi<ExecutionEntity[]>(
      'GET',
      `${PROCESS_PATH}/${componentId}/progress`,
      { query: { ...(projectId && { projectId }) } },
    );
  }

  /**
   * Gets details of a specific execution, including its messages.
   * @param executionId - The execution's unique identifier.
   * @returns The execution entity with progress and result info.
   */
  async getExecution(executionId: string) {
    if (this.localServerUrl) {
      const url = `${this.localServerUrl}/api/${PROCESS_PATH}/progress/${executionId}`;
      const response = await fetch(url);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Local server request failed: ${response.status} - ${text}`);
      }
      return (await response.json()) as ExecutionEntity;
    }
    return await this.#requestApi<ExecutionEntity>(
      'GET',
      `${PROCESS_PATH}/progress/${executionId}`,
    );
  }

  /**
   * Subscribes to real-time execution progress via WebSocket.
   * The callback fires on each progress update until the execution completes.
   * @param executionId - The execution's unique identifier.
   * @param onUpdateCallback - Callback invoked on each progress/result event.
   */
  async onExecutionProgress(
    executionId: string,
    onUpdateCallback: (data: ExecutionSuscriptionReturnType) => void,
  ) {
    const wsUrl = this.localServerUrl
      ? `${this.localServerUrl}?accessToken=${this.accessToken}`
      : this.wsUrl;
    const socket = await io(wsUrl, {
      ...(this.localServerUrl && { transports: ['websocket'] }),
    });

    socket.on('connect', function () {
      socket.emit('executionSubscription', JSON.stringify({ executionId }));
      socket.on('execution', (data: ExecutionSuscriptionReturnType) => {
        onUpdateCallback(data);
      });
    });

    socket.on('connect_error', function (e: unknown) {
      console.log(e);
    });
  }

  // ─── Hidden Files ────────────────────────────────────────────────

  /**
   * Creates a hidden file attached to a parent item (e.g., dependencies, assets).
   * @param file - The file to upload.
   * @param parentFileId - The parent item's unique identifier.
   * @returns The hidden file ID.
   */
  async createHiddenFile(file: File | Blob, parentFileId: string) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('parentItemId', parentFileId);

    return await this.#requestApi<CreateHiddenItemResult>(
      'POST',
      `${ITEM_PATH}/${HIDDEN_PATH}`,
      {
        body: formData,
      },
    );
  }

  /**
   * Deletes a hidden file by its ID.
   * @param hiddenId - The hidden file's unique identifier.
   */
  async deleteHiddenFile(hiddenId: string) {
    return await this.#requestApi<Item>(
      'DELETE',
      `${ITEM_PATH}/${HIDDEN_PATH}/${hiddenId}`,
    );
  }

  /**
   * Gets metadata for a hidden file.
   * @param hiddenId - The hidden file's unique identifier.
   */
  async getHiddenFile(hiddenId: string) {
    return await this.#requestApi<HiddenFileEntity>(
      'GET',
      `${ITEM_PATH}/${HIDDEN_PATH}/${hiddenId}`,
    );
  }

  /**
   * Downloads a hidden file's content. Returns the raw fetch Response.
   * @param hiddenId - The hidden file's unique identifier.
   */
  async downloadHiddenFile(hiddenId: string) {
    return await this.#requestFile(
      `${ITEM_PATH}/${HIDDEN_PATH}/${hiddenId}/download`,
    );
  }

  /**
   * Lists all hidden files attached to a parent item.
   * @param parentFileId - The parent item's unique identifier.
   * @returns Array of hidden file entities.
   */
  async getHiddenFilesByParent(parentFileId: string) {
    return await this.#requestApi<HiddenFileEntity[]>(
      'GET',
      `${ITEM_PATH}/${parentFileId}/${HIDDEN_PATH}`,
    );
  }

  /**
   * Deletes all hidden files attached to a parent item.
   * @param parentFileId - The parent item's unique identifier.
   */
  async deleteHiddenFilesByParent(parentFileId: string) {
    return await this.#requestApi<Item[]>(
      'DELETE',
      `${ITEM_PATH}/${parentFileId}/${HIDDEN_PATH}`,
    );
  }

  // ─── Icons ───────────────────────────────────────────────────────

  /**
   * Uploads or replaces the icon for an item (app, component, or file).
   * Accepts PNG, WebP, or ICO images up to 512 KB.
   * @param itemId - The item's unique identifier.
   * @param icon - The icon image file (File in browsers, Blob in Node.js).
   * @returns The updated item with `iconFileId` and `iconMimeType` set.
   */
  async uploadItemIcon(itemId: string, icon: File | Blob) {
    const formData = new FormData();
    formData.append('icon', icon);
    return await this.#requestApi<Item>(
      'PUT',
      `${ITEM_PATH}/${itemId}/icon`,
      { body: formData },
    );
  }

  /**
   * Downloads the icon for an item as a binary stream.
   * @param itemId - The item's unique identifier.
   * @returns The raw Response (use `.blob()`, `.arrayBuffer()`, or pipe the body).
   */
  async getItemIcon(itemId: string) {
    return await this.#requestFile(`${ITEM_PATH}/${itemId}/icon`);
  }

  /**
   * Removes the icon from an item.
   * @param itemId - The item's unique identifier.
   * @returns The updated item with icon fields removed.
   */
  async removeItemIcon(itemId: string) {
    return await this.#requestApi<Item>(
      'DELETE',
      `${ITEM_PATH}/${itemId}/icon`,
    );
  }

  // ─── General Item Operations ─────────────────────────────────────

  /**
   * Renames or moves an item (file, component, or app) without creating a new version.
   * @param itemId - The item's unique identifier.
   * @param params - New name and/or new folder ID.
   * @returns The updated item.
   */
  async updateItem(
    itemId: string,
    params: { name?: string; folderId?: string },
  ) {
    return await this.#requestApi<Item>('PUT', `${ITEM_PATH}/${itemId}`, {
      body: JSON.stringify(params),
      contentType: 'application/json',
    });
  }

  /**
   * Creates a new version of an item by uploading a new file.
   * For APP and TOOL types, `extraProps` is required by the backend.
   * @param itemId - The item's unique identifier.
   * @param file - The new file to upload.
   * @param versionTag - Version tag for the new version (e.g. "v2").
   * @param extraProps - Version-specific properties (required for APP/TOOL types).
   * @param metadata - Optional free-JSON metadata to store on the new version.
   * @returns The created version.
   */
  async createVersion(
    itemId: string,
    file: File | Blob,
    versionTag: string,
    extraProps?: object,
    metadata?: Metadata,
  ) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('versionTag', versionTag);
    extraProps && formData.append('extraProps', JSON.stringify(extraProps));
    metadata && formData.append('metadata', JSON.stringify(metadata));
    return await this.#requestApi<ItemVersion>(
      'POST',
      `${ITEM_PATH}/${itemId}/version`,
      { body: formData },
    );
  }

  /**
   * Lists versions of an item. Pass `archived: true` to fetch only archived
   * versions, `false` to fetch only active ones, or omit to receive both.
   * @param itemId - The item's unique identifier.
   * @param params - Optional `{ archived }` filter.
   * @returns Array of versions, sorted by creation date descending.
   */
  async listVersions(
    itemId: string,
    params: { archived?: boolean } = {},
  ): Promise<ItemVersion[]> {
    return await this.#requestApi<ItemVersion[]>(
      'GET',
      `${ITEM_PATH}/${encodeURIComponent(itemId)}/versions`,
      { query: params },
    );
  }

  /**
   * Archives a version of an item. Archived versions remain available via
   * `listVersions({ archived: true })` and can be recovered or permanently
   * deleted. Cleanup runs daily and removes archived versions older than the
   * platform retention period.
   * @param itemId - The item's unique identifier.
   * @param versionTag - The version's tag (e.g. "v2").
   * @returns The archived version.
   */
  async archiveVersion(itemId: string, versionTag: string) {
    return await this.#requestApi<ItemVersion>(
      'PUT',
      `${ITEM_PATH}/${encodeURIComponent(itemId)}/version/${encodeURIComponent(versionTag)}/archive`,
    );
  }

  /**
   * Recovers a previously archived version, restoring it to the active list.
   * @param itemId - The item's unique identifier.
   * @param versionTag - The version's tag (e.g. "v2").
   * @returns The recovered version.
   */
  async recoverVersion(itemId: string, versionTag: string) {
    return await this.#requestApi<ItemVersion>(
      'PUT',
      `${ITEM_PATH}/${encodeURIComponent(itemId)}/version/${encodeURIComponent(versionTag)}/recover`,
    );
  }

  /**
   * Permanently deletes a version, including its file in object storage.
   * The version must be archived first; otherwise the call is rejected.
   * @param itemId - The item's unique identifier.
   * @param versionTag - The version's tag (e.g. "v2").
   */
  async deleteVersion(itemId: string, versionTag: string) {
    return await this.#requestApi<{ success: boolean }>(
      'DELETE',
      `${ITEM_PATH}/${encodeURIComponent(itemId)}/version/${encodeURIComponent(versionTag)}`,
    );
  }

  // Project-scoped listings happen via the main list methods — e.g.
  // `listFiles({ projectId })`, `listFolders({ projectId })`,
  // `listApps({ projectId })`, `listComponents({ projectId })`. Those call
  // `GET /item?projectId=...` / `/item/folder?projectId=...`, which accept
  // both API tokens and JWT and apply per-entity permission filtering on
  // the server.
  //
  // Methods that hit the JWT-only `/project/:id/*` and
  // `/project/permissions/check*` routes (getProject, getProjectData,
  // checkPermission, checkPermissionBatch) live on `PlatformClient` — they
  // cannot be called with an access token.

  // ─── Private Helpers ─────────────────────────────────────────────

  async #downloadItem(itemId: string, params?: DownloadItemFileParams) {
    const { versionTag, withDraft } = params || {};
    return await this.#requestFile(`${ITEM_PATH}/${itemId}/download`, {
      query: {
        ...(versionTag && { versionTag }),
        ...(withDraft && { withDraft }),
      },
    });
  }

  async #createItem<T = Item, P extends object = object>(
    fileData: CreateItemProps,
    itemType: ItemType,
    extraProps?: P,
  ) {
    const { name, versionTag, parentFolderId, projectId, file, metadata } =
      fileData;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    formData.append('versionTag', versionTag);
    formData.append('itemType', itemType);
    parentFolderId && formData.append('folderId', parentFolderId);
    projectId && formData.append('projectId', projectId);

    extraProps && formData.append('extraProps', JSON.stringify(extraProps));
    metadata && formData.append('metadata', JSON.stringify(metadata));
    return await this.#requestApi<CreateItemResponse<T>>('POST', ITEM_PATH, {
      body: formData,
    });
  }

  async #updateItem<T = Item, P extends object = object>(
    itemId: string,
    fileData: UpdateItemProps,
    extraProps?: P,
  ): Promise<UpdateItemResponse<T>> {
    const { name, versionTag, parentFolderId, file, metadata } = fileData;

    let item: T | undefined;
    let version: ItemVersion | undefined;

    if (file) {
      const formData = new FormData();
      formData.append('file', file);
      versionTag && formData.append('versionTag', versionTag);
      extraProps && formData.append('extraProps', JSON.stringify(extraProps));
      metadata && formData.append('metadata', JSON.stringify(metadata));
      version = await this.#requestApi<ItemVersion>(
        'POST',
        `${ITEM_PATH}/${itemId}/version`,
        {
          body: formData,
        },
      );
    }

    if (name || parentFolderId) {
      const body: UpdateItemDto = {
        ...(name && { name }),
        ...(parentFolderId && { folderId: parentFolderId }),
      };

      const parsedBody = JSON.stringify(body);

      item = await this.#requestApi<T>('PUT', `${ITEM_PATH}/${itemId}`, {
        body: parsedBody,
        contentType: 'application/json',
      });
    }

    return { item, version };
  }

  async #getItem<T = Item>(itemId: string, props?: GetItemProps) {
    const { showVersions = false } = props || {};
    return await this.#requestApi<ItemWithVersions<T>>(
      'GET',
      `${ITEM_PATH}/${itemId}`,
      {
        query: { showVersions },
      },
    );
  }

  #cleanData(data?: object) {
    return (
      data &&
      Object.entries(data)
        .filter(([, value]) => value !== undefined)
        .reduce(
          (obj, [key, value]) => {
            obj[key as string] = value;
            return obj;
          },
          {} as { [key: string]: unknown },
        )
    );
  }
}
