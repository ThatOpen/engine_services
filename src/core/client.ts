import { io } from 'socket.io-client';
import {
  ExecutionEntity,
  ExecutionSuscriptionReturnType,
} from '../types/execution';
import { UpdateItemDto, UpdateItemFolderDto } from '../types/item.dto';
import {
  ComponentItem,
  ComponentVersionProps,
  Item,
  ItemFolder,
  ItemType,
  ItemVersion,
  ItemWithVersions,
} from '../types/items';
import { CreateItemResponse, UpdateItemResponse } from '../types/response';
import { CreateHiddenItemResult, HiddenFileEntity } from '../types/files';

const FOLDER_PATH = 'item/folder';
const ITEM_PATH = 'item';
const PROCESS_PATH = 'processor';
const ITEM_TYPE_FILE = 'FILE';
const ITEM_TYPE_COMPONENT = 'TOOL';
const HIDDEN_PATH = 'hidden';

export type CreateItemProps = {
  file: File;
  name: string;
  versionTag: string;
  parentFolderId?: string;
  metadata?: Record<string, string>;
};

export type UpdateItemProps = {
  name?: string;
  parentFolderId?: string;
  file?: File;
  versionTag?: string;
  metadata?: Record<string, string>;
};

export type GetItemProps = {
  showVersions?: boolean;
};

export type CreateComponentProps = CreateItemProps & {
  componentProps: ComponentVersionProps;
};

export type UpdateComponentProps = UpdateItemProps & {
  componentProps: ComponentVersionProps;
};

export type DownloadItemFileParams = {
  versionTag?: string;
  withDraft?: boolean;
};

export type EngineServicesClientProps = {
  retries?: number;
};

export type GetItemsParams = { folderId?: string; ShowVersions?: boolean };

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

  async listFolders(params: { parentFolderId?: string; archived?: boolean }) {
    const { archived, parentFolderId } = params;
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

  // TODO allow nested folders
  async createFolder(name: string, parentId?: string) {
    return await this.#requestApi<ItemFolder>('POST', FOLDER_PATH, {
      body: JSON.stringify({ name, ...(parentId && { parentId }) }),
      contentType: 'application/json',
    });
  }

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

  async archiveFolder(folderId: string) {
    return await this.#requestApi<ItemFolder>(
      'DELETE',
      `${FOLDER_PATH}/${folderId}`,
    );
  }

  async recoverFolder(folderId: string) {
    return await this.#requestApi<ItemFolder>(
      'PUT',
      `${FOLDER_PATH}/${folderId}/recover`,
    );
  }

  async recoverFile(fileId: string) {
    return await this.#requestApi<ItemFolder>(
      'PUT',
      `${ITEM_PATH}/${fileId}/recover`,
    );
  }

  async listFiles(filters?: { folderId?: string; archived?: boolean }) {
    const { folderId, archived } = filters || {};
    if (folderId) {
      return await this.#requestApi<ItemFolder[]>(
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

  async downloadFile(
    fileId: string,

    params?: DownloadItemFileParams,
  ) {
    const { versionTag, withDraft } = params || {};
    return await this.#requestFile(
      `${ITEM_PATH}/${fileId}/download`,

      {
        query: {
          ...(versionTag && { versionTag }),
          ...(withDraft && { withDraft }),
        },
      },
    );
  }

  async downloadComponent(
    componentId: string,

    params?: DownloadItemFileParams,
  ) {
    const { versionTag, withDraft } = params || {};
    return await this.#requestFile(
      `${ITEM_PATH}/${componentId}/download`,

      {
        query: {
          ...(versionTag && { versionTag }),
          ...(withDraft && { withDraft }),
        },
      },
    );
  }

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

  async downloadApp(
    appId: string,

    params?: DownloadItemFileParams,
  ) {
    const { versionTag, withDraft } = params || {};

    return await this.#requestFile(
      `${ITEM_PATH}/${appId}/download`,

      {
        query: {
          ...(versionTag && { versionTag }),
          ...(withDraft && { withDraft }),
        },
      },
    );
  }

  async downloadFolder(folderId: string) {
    return await this.#requestFile(`${FOLDER_PATH}/${folderId}/download`);
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

  async createFile(fileData: CreateItemProps) {
    return await this.#createItem(fileData, ITEM_TYPE_FILE);
  }

  async updateFile(
    fileId: string,
    fileData: UpdateItemProps,
  ): Promise<UpdateItemResponse> {
    return await this.#updateItem(fileId, fileData);
  }

  async archiveFile(fileId: string) {
    return await this.#requestApi<Item>('DELETE', `${ITEM_PATH}/${fileId}`);
  }

  async listComponents(params: GetItemsParams) {
    const { folderId, ShowVersions } = params;
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

  async getComponent(componentId: string, props: GetItemProps) {
    return await this.#getItem<ItemWithVersions<ComponentItem>>(
      componentId,
      props,
    );
  }

  /**
   * Create a new component.
   * @functionß
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
   * Update a component.
   * @function
   */

  async updateComponent(
    fileId: string,
    componentData: UpdateComponentProps,
  ): Promise<UpdateItemResponse> {
    const { componentProps } = componentData;
    return await this.#updateItem<ComponentItem, ComponentVersionProps>(
      fileId,
      componentData,
      componentProps,
    );
  }

  async archiveComponent(componentId: string) {
    return await this.#requestApi<ComponentItem>(
      'DELETE',
      `${ITEM_PATH}/${componentId}`,
    );
  }

  async recoverComponent(componentId: string) {
    return await this.#requestApi<ComponentItem>(
      'PUT',
      `${ITEM_PATH}/${componentId}/recover`,
    );
  }

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

  async abortExecution(executionId: string) {
    return await this.#requestApi<ExecutionEntity>(
      'POST',
      `${PROCESS_PATH}/progress/${executionId}/abort`,
    );
  }

  /** @function
   * @name myFunction
   * @param {string} executionId - Identifier of the execution.
   * @param {string} onUpdateCallback - Callback function to be called when the execution is updated.
   * @returns {void} - Nothing is returned. Connection is closed on its own
   * */

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

  /** @function
   * @name createHiddenFile
   * @returns {string} - Returns id of the created hidden file.
   * */

  async createHiddenFile(file: File, parentFileId: string) {
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

  async deleteHiddenFile(hiddenId: string) {
    return await this.#requestApi<Item>(
      'DELETE',
      `${ITEM_PATH}/${HIDDEN_PATH}/${hiddenId}`,
    );
  }

  async getHiddenFile(hiddenId: string) {
    return await this.#requestApi<HiddenFileEntity>(
      'GET',
      `${ITEM_PATH}/${HIDDEN_PATH}/${hiddenId}`,
    );
  }

  async downloadHiddenFile(hiddenId: string) {
    return await this.#requestFile(
      `${ITEM_PATH}/${HIDDEN_PATH}/${hiddenId}/download`,
    );
  }

  async getHiddenFilesByParent(parentFileId: string) {
    return await this.#requestApi<HiddenFileEntity[]>(
      'GET',
      `${ITEM_PATH}/${parentFileId}/${HIDDEN_PATH}`,
    );
  }

  async deleteHiddenFileByParent(parentFileId: string) {
    return await this.#requestApi<Item[]>(
      'DELETE',
      `${ITEM_PATH}/${parentFileId}/${HIDDEN_PATH}`,
    );
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
