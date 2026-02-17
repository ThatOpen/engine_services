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
import { CreateHiddenItemResult, HiddenFileEntity } from '../types/files';
import { Project } from '../types/projects';

const FOLDER_PATH = 'item/folder';
const ITEM_PATH = 'item';
const PROCESS_PATH = 'processor';
const PROJECT_PATH = 'project';
const HIDDEN_PATH = 'hidden';
const ITEM_TYPE_FILE = 'FILE';
const ITEM_TYPE_COMPONENT = 'TOOL';
const ITEM_TYPE_APP = 'APP';

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
  /** Optional key-value metadata (max 30 KB when serialized). */
  metadata?: Record<string, string>;
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
  /** Optional key-value metadata for the new version. */
  metadata?: Record<string, string>;
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
    const { retries = 0, useBearer = false } = props || {};
    let url = apiUrl;
    if (url.charAt(url.length - 1) === '/') {
      url = url.slice(0, -1);
    }
    this.apiUrl = `${url}/api`;
    this.accessToken = accessToken;
    this.wsUrl = `${url}?accessToken=${accessToken}`;
    this.retries = retries;
    this.useBearer = useBearer;
  }

  /**
   * Sets the number of automatic retries for failed requests.
   * @param retries - Number of retries (0 = no retries).
   */
  setRetries(retries: number) {
    this.retries = retries;
  }

  #buildUrl(path: string) {
    return `${this.apiUrl}/${path}`;
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

    const params = {
      ...cleanQuery,
      ...(this.useBearer ? {} : { accessToken: this.accessToken }),
    };

    try {
      const response = await fetch(
        url + '?' + new URLSearchParams(params).toString(),
        {
          method,
          headers: {
            Accept: 'application/json',
            ...(contentType && { 'Content-Type': contentType }),
            ...(this.useBearer && { Authorization: `Bearer ${this.accessToken}` }),
          },
          ...(body && { body }),
        },
      );
      if (!response.ok) {
        const textResponse = await response
          .text()
          .then((text) => text)
          .catch(() => undefined);
        throw new Error(
          `Request failed with status ${response.status}: ${response.statusText} - ${textResponse}`,
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

  async #requestFile(path: string, requestData?: { query?: object }) {
    const { query } = requestData || {};
    const url = this.#buildUrl(path);
    const params = {
      ...query,
      ...(this.useBearer ? {} : { accessToken: this.accessToken }),
    };
    const response = await fetch(
      url + '?' + new URLSearchParams(params).toString(),
      {
        method: 'GET',
        ...(this.useBearer && {
          headers: { Authorization: `Bearer ${this.accessToken}` },
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
  async listFiles(filters?: { folderId?: string; archived?: boolean }) {
    const { folderId, archived } = filters || {};
    if (folderId) {
      return await this.#requestApi<Item[]>(
        'GET',
        `${FOLDER_PATH}/${folderId}/items`,
        { query: { itemType: ITEM_TYPE_FILE, archived } },
      );
    }
    return await this.#requestApi<Item[]>('GET', `${ITEM_PATH}`, {
      query: { itemType: ITEM_TYPE_FILE, archived },
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
   * @param fileData - File content, name, version tag, and optional metadata.
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
   * Retrieves the metadata JSON associated with a file version.
   * @param itemId - The file's unique identifier.
   * @param params - Optional version selection parameters.
   * @returns The metadata key-value object.
   */
  async getFileMetadata(itemId: string, params?: DownloadItemFileParams) {
    const { versionTag, withDraft } = params || {};
    return await this.#requestApi<Record<string, string>>(
      'GET',
      `${ITEM_PATH}/${itemId}/metadata`,
      {
        query: {
          ...(versionTag && { versionTag }),
          ...(withDraft && { withDraft }),
        },
      },
    );
  }

  // ─── Folders ─────────────────────────────────────────────────────

  /**
   * Lists all folders accessible by the current token.
   * @param params - Optional filters for parent folder and archive status.
   * @returns Array of folder items.
   */
  async listFolders(params?: { parentFolderId?: string; archived?: boolean }) {
    const { archived, parentFolderId } = params || {};
    return await this.#requestApi<ItemFolder[]>('GET', FOLDER_PATH, {
      query: { parentFolderId, archived },
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
  async createFolder(name: string, parentId?: string) {
    return await this.#requestApi<ItemFolder>('POST', FOLDER_PATH, {
      body: JSON.stringify({ name, ...(parentId && { parentId }) }),
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
  async listComponents(params?: GetItemsParams) {
    const { folderId, ShowVersions } = params || {};
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
   *   expects in scope (e.g. `{ OBC, BUI }`). Defaults to
   *   `window.ThatOpenCompany` if not provided.
   *
   * @example
   * ```ts
   * import { HelloWorld } from "thatopen-services";
   *
   * await client.initBuiltInComponent(HelloWorld, components, { OBC, BUI });
   * const hw = components.get(HelloWorld);
   * hw.greet("World"); // fully typed
   * ```
   */
  async initBuiltInComponent(
    component: { uuid: string },
    components: { get: (c: new (components: any) => any) => any },
    globals?: Record<string, unknown>,
  ): Promise<void> {
    const source = await this.getBuiltInComponent(component.uuid);
    const resolvedGlobals =
      globals ?? (typeof window !== 'undefined' ? (window as any).ThatOpenCompany : {}) ?? {};

    const keys = Object.keys(resolvedGlobals);
    const values = keys.map((k) => resolvedGlobals[k]);

    // eslint-disable-next-line no-new-func
    const factory = new Function(...keys, `${source}\nreturn main;`);
    const main = factory(...values);

    const componentDefinition = main?.componentDefinition ?? main;
    components.get(componentDefinition);
  }

  // ─── Apps ────────────────────────────────────────────────────────

  /**
   * Lists all apps accessible by the current token.
   * @param params - Optional filters for folder and version inclusion.
   * @returns Array of app items.
   */
  async listApps(params?: GetItemsParams) {
    const { folderId, ShowVersions } = params || {};
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
   * @param componentId - The component's unique identifier.
   * @param executionParams - Arbitrary parameters passed to the component's `main()` function.
   * @param versionTag - Optional version to execute (defaults to latest).
   * @returns An object containing the `executionId` to track progress.
   */
  async executeComponent(
    componentId: string,
    executionParams: object,
    versionTag?: string,
  ) {
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
    return await this.#requestApi<ExecutionEntity>(
      'POST',
      `${PROCESS_PATH}/progress/${executionId}/abort`,
    );
  }

  /**
   * Lists all executions for a given component.
   * @param componentId - The component's unique identifier.
   * @returns Array of execution entities.
   */
  async listExecutions(componentId: string) {
    return await this.#requestApi<ExecutionEntity[]>(
      'GET',
      `${PROCESS_PATH}/${componentId}/progress`,
    );
  }

  /**
   * Gets details of a specific execution, including its messages.
   * @param executionId - The execution's unique identifier.
   * @returns The execution entity with progress and result info.
   */
  async getExecution(executionId: string) {
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
    const socket = await io(this.wsUrl);

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
   * @param metadata - Optional key-value metadata for this version.
   * @returns The created version.
   */
  async createVersion(
    itemId: string,
    file: File | Blob,
    versionTag: string,
    extraProps?: object,
    metadata?: Record<string, string>,
  ) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('versionTag', versionTag);
    extraProps && formData.append('extraProps', JSON.stringify(extraProps));
    metadata &&
      formData.append('metadata', JSON.stringify(this.#cleanData(metadata)));
    return await this.#requestApi<ItemVersion>(
      'POST',
      `${ITEM_PATH}/${itemId}/version`,
      { body: formData },
    );
  }

  // ─── Projects ────────────────────────────────────────────────────

  /**
   * Gets project data by ID. Requires JWT auth or a future PublicAuth endpoint.
   * @param projectId - The project's unique identifier.
   * @returns The project entity.
   */
  async getProjectData(projectId: string) {
    return await this.#requestApi<Project>(
      'GET',
      `${PROJECT_PATH}/${projectId}`,
    );
  }

  // ─── Permissions ─────────────────────────────────────────────────

  /**
   * Checks whether the current token has a specific permission within a project.
   * @param params - Resource ID, resource type, action, and project ID.
   * @returns An object with `hasPermission: boolean`.
   */
  async checkPermission(params: {
    resourceId: string;
    resourceType: string;
    action: string;
    projectId: string;
  }) {
    return await this.#requestApi<{ hasPermission: boolean }>(
      'GET',
      `${PROJECT_PATH}/permissions/check`,
      { query: params },
    );
  }

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
    const { name, versionTag, parentFolderId, file, metadata } = fileData;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    formData.append('versionTag', versionTag);
    formData.append('itemType', itemType);
    parentFolderId && formData.append('folderId', parentFolderId);

    extraProps && formData.append('extraProps', JSON.stringify(extraProps));
    metadata &&
      formData.append('metadata', JSON.stringify(this.#cleanData(metadata)));
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
      metadata &&
        formData.append('metadata', JSON.stringify(this.#cleanData(metadata)));
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
