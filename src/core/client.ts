import { io } from 'socket.io-client';
import {
  ExecutionEntity,
  ExecutionSuscriptionReturnType,
} from '../types/execution';
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
import { CreateItemResponse } from '../types/response';
import { Project } from '../types/projects';

const FOLDER_PATH = 'item/folder';
const ITEM_PATH = 'item';
const PROCESS_PATH = 'processor';
const PROJECT_PATH = 'project';
const ITEM_TYPE_FILE = 'FILE';
const ITEM_TYPE_COMPONENT = 'TOOL';
const ITEM_TYPE_APP = 'APP';

export type CreateItemProps = {
  file: File;
  name: string;
  versionTag: string;
  parentFolderId?: string;
  metadata?: Record<string, string>;
};

export type CreateAppProps = CreateItemProps & {
  appProps?: AppVersionProps;
};

export type CreateComponentProps = CreateItemProps & {
  componentProps: ComponentVersionProps;
};

export type GetItemProps = {
  showVersions?: boolean;
};

export type GetItemsParams = { folderId?: string; ShowVersions?: boolean };

export type DownloadItemFileParams = {
  versionTag?: string;
  withDraft?: boolean;
};

export type EngineServicesClientProps = {
  retries?: number;
};

export class EngineServicesClient {
  private apiUrl: string;
  private accessToken: string;
  private wsUrl: string;
  private retries: number;

  constructor(
    accessToken: string,
    apiUrl: string,
    props?: EngineServicesClientProps,
  ) {
    const { retries = 0 } = props || {};
    let url = apiUrl;
    if (url.charAt(url.length - 1) === '/') {
      url = url.slice(0, -1);
    }
    this.apiUrl = `${url}/api`;
    this.accessToken = accessToken;
    this.wsUrl = `${url}?accessToken=${accessToken}`;
    this.retries = retries;
  }

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
      accessToken: this.accessToken,
    };

    try {
      const response = await fetch(
        url + '?' + new URLSearchParams(params).toString(),
        {
          method,
          headers: {
            Accept: 'application/json',
            ...(contentType && { 'Content-Type': contentType }),
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
          retries,
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
      accessToken: this.accessToken,
    };
    const response = await fetch(
      url + '?' + new URLSearchParams(params).toString(),
      { method: 'GET' },
    );

    return response;
  }

  // ─── Files ───

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

  async getFile(fileId: string, props?: GetItemProps) {
    return await this.#getItem<ItemWithVersions<Item>>(fileId, props);
  }

  async createFile(fileData: CreateItemProps) {
    return await this.#createItem(fileData, ITEM_TYPE_FILE);
  }

  async archiveFile(fileId: string) {
    return await this.#requestApi<Item>('DELETE', `${ITEM_PATH}/${fileId}`);
  }

  async downloadFile(fileId: string, params?: DownloadItemFileParams) {
    return await this.#downloadItem(fileId, params);
  }

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

  // ─── Folders ───

  async listFolders(params?: { parentFolderId?: string; archived?: boolean }) {
    const { archived, parentFolderId } = params || {};
    return await this.#requestApi<ItemFolder[]>('GET', FOLDER_PATH, {
      query: { parentFolderId, archived },
    });
  }

  async getFolder(folderId: string) {
    return await this.#requestApi<ItemFolder>(
      'GET',
      `${FOLDER_PATH}/${folderId}`,
    );
  }

  async createFolder(name: string, parentId?: string) {
    return await this.#requestApi<ItemFolder>('POST', FOLDER_PATH, {
      body: JSON.stringify({ name, ...(parentId && { parentId }) }),
      contentType: 'application/json',
    });
  }

  async archiveFolder(folderId: string) {
    return await this.#requestApi<ItemFolder>(
      'DELETE',
      `${FOLDER_PATH}/${folderId}`,
    );
  }

  // ─── Components ───

  async listComponents(params?: GetItemsParams) {
    const { folderId, ShowVersions } = params || {};
    if (folderId) {
      return await this.#requestApi<ComponentItem[]>(
        'GET',
        `${ITEM_PATH}/${folderId}/items`,
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

  async getComponent(componentId: string, props?: GetItemProps) {
    return await this.#getItem<ItemWithVersions<ComponentItem>>(
      componentId,
      props,
    );
  }

  async createComponent(componentData: CreateComponentProps) {
    const { componentProps } = componentData;
    return await this.#createItem<ComponentItem, ComponentVersionProps>(
      componentData,
      ITEM_TYPE_COMPONENT,
      componentProps,
    );
  }

  async downloadComponent(componentId: string, params?: DownloadItemFileParams) {
    return await this.#downloadItem(componentId, params);
  }

  async archiveComponent(componentId: string) {
    return await this.#requestApi<ComponentItem>(
      'DELETE',
      `${ITEM_PATH}/${componentId}`,
    );
  }

  // ─── Apps ───

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

  async createApp(appData: CreateAppProps) {
    const { appProps } = appData;
    return await this.#createItem<AppItem, AppVersionProps>(
      appData,
      ITEM_TYPE_APP,
      appProps,
    );
  }

  async downloadApp(appId: string, params?: DownloadItemFileParams) {
    return await this.#downloadItem(appId, params);
  }

  async archiveApp(appId: string) {
    return await this.#requestApi<AppItem>('DELETE', `${ITEM_PATH}/${appId}`);
  }

  // ─── Execution ───

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

  async abortExecution(executionId: string) {
    return await this.#requestApi<ExecutionEntity>(
      'POST',
      `${PROCESS_PATH}/progress/${executionId}/abort`,
    );
  }

  async listExecutions(componentId: string) {
    return await this.#requestApi<ExecutionEntity[]>(
      'GET',
      `${PROCESS_PATH}/${componentId}/progress`,
    );
  }

  async getExecution(executionId: string) {
    return await this.#requestApi<ExecutionEntity>(
      'GET',
      `${PROCESS_PATH}/progress/${executionId}`,
    );
  }

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

  // ─── General Item Operations ───

  async updateItem(
    itemId: string,
    params: { name?: string; folderId?: string },
  ) {
    return await this.#requestApi<Item>('PUT', `${ITEM_PATH}/${itemId}`, {
      body: JSON.stringify(params),
      contentType: 'application/json',
    });
  }

  async createVersion(
    itemId: string,
    file: File,
    versionTag: string,
    extraProps?: object,
  ) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('versionTag', versionTag);
    extraProps && formData.append('extraProps', JSON.stringify(extraProps));
    return await this.#requestApi<ItemVersion>(
      'POST',
      `${ITEM_PATH}/${itemId}/version`,
      { body: formData },
    );
  }

  // ─── Projects ───

  async getProjectData(projectId: string) {
    return await this.#requestApi<Project>(
      'GET',
      `${PROJECT_PATH}/${projectId}`,
    );
  }

  // ─── Permissions ───

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

  // ─── Private Helpers ───

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
