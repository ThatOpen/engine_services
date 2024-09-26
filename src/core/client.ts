import axios, { Method, ResponseType } from 'axios';
import { UpdateItemDto, UpdateItemFolderDto } from '../types/item.dto';
import {
  ComponentItem,
  ComponentVersionProps,
  Item,
  ItemFolder,
  ItemType,
  ItemVersion,
} from '../types/items';
import { CreateItemResponse, UpdateItemResponse } from '../types/response';
import {
  ExecutionEntity,
  ExecutionSuscriptionReturnType,
  // ExecutionSuscriptionReturnType,
} from '../types/execution';
import { io } from 'socket.io-client';

const FOLDER_PATH = 'item/folder';
const ITEM_PATH = 'item';
const PROCESS_PATH = 'processor';
const ITEM_TYPE_FILE = 'FILE';
const ITEM_TYPE_COMPONENT = 'TOOL';

export type CreateItemProps = {
  file: File;
  name: string;
  versionTag: string;
  parentFolderId?: string;
};

export type UpdateItemProps = {
  name?: string;
  parentFolderId?: string;
  file?: File;
  versionTag?: string;
};

export type CreateComponentProps = CreateItemProps & {
  componentProps: ComponentVersionProps;
};

export type UpdateComponentProps = UpdateItemProps & {
  componentProps: ComponentVersionProps;
};

export class EngineServicesClient {
  apiUrl: string;
  accessToken: string;
  wsUrl: string;

  constructor(accessToken: string, apiUrl: string) {
    let url = apiUrl;
    if (url.charAt(url.length - 1) === '/') {
      url = url.slice(0, -1);
    }
    this.apiUrl = `${url}/api`;
    this.accessToken = accessToken;
    this.wsUrl = `${url}?accessToken=${accessToken}`;
  }

  #buildUrl(path: string) {
    return `${this.apiUrl}/${path}`;
  }

  async #requestApi<T = object>(
    method: Method,
    path: string,
    requestData?: {
      body?: BodyInit;
      query?: object;
      contentType?:
        | 'application/json'
        | 'multipart/form-data'
        | 'application/x-www-form-urlencoded';
    },
  ) {
    const { body, query, contentType } = requestData || {};
    const url = this.#buildUrl(path);

    const cleanQuery = this.#cleanData(query);

    const params = {
      ...cleanQuery,
      accessToken: this.accessToken,
    };

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
      .catch(() => undefined);
  }

  async #requestFile<T = ReadableStream>(
    path: string,
    requestData?: { query?: object; responseType?: ResponseType },
  ) {
    const { query, responseType = 'stream' } = requestData || {};
    const url = this.#buildUrl(path);
    const params = {
      ...query,
      accessToken: this.accessToken,
    };
    const response = await axios.request<T>({
      url,
      params,
      responseType: responseType,
    });

    return response.data;
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
  async createFolder(name: string) {
    return await this.#requestApi<ItemFolder>('POST', FOLDER_PATH, {
      body: JSON.stringify({ name }),
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

  async getFile(fileId: string) {
    return await this.#requestApi<Item>('GET', `${ITEM_PATH}/${fileId}`);
  }

  async downloadFile<T = ReadableStream>(
    fileId: string,
    responseType?: ResponseType,
  ) {
    return await this.#requestFile<T>(`${ITEM_PATH}/${fileId}/download`, {
      responseType,
    });
  }

  async downloadComponentBundle<T = ReadableStream>(
    componentId: string,
    responseType?: ResponseType,
  ) {
    return await this.#requestFile<T>(`${ITEM_PATH}/${componentId}/download`, {
      responseType,
    });
  }

  async downloadAppBundle<T = ReadableStream>(
    appId: string,
    responseType?: ResponseType,
  ) {
    return await this.#requestFile<T>(`${ITEM_PATH}/${appId}/download`, {
      responseType,
    });
  }

  async downloadFolder<T = ReadableStream>(
    folderId: string,
    responseType?: ResponseType,
  ) {
    return await this.#requestFile<T>(`${FOLDER_PATH}/${folderId}/download`, {
      responseType,
    });
  }

  async #createItem<T = Item, P extends object = object>(
    fileData: CreateItemProps,
    itemType: ItemType,
    extraProps?: P,
  ) {
    const { name, versionTag, parentFolderId, file } = fileData;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    formData.append('versionTag', versionTag);
    formData.append('itemType', itemType);
    parentFolderId && formData.append('folderId', parentFolderId);

    extraProps && formData.append('extraProps', JSON.stringify(extraProps));
    return await this.#requestApi<CreateItemResponse<T>>('POST', ITEM_PATH, {
      body: formData,
    });
  }

  async #updateItem<T = Item, P extends object = object>(
    itemId: string,
    fileData: UpdateItemProps,
    extraProps?: P,
  ): Promise<UpdateItemResponse<T>> {
    const { name, versionTag, parentFolderId, file } = fileData;

    let item: T | undefined;
    let version: ItemVersion | undefined;
    if (file) {
      const formData = new FormData();
      formData.append('file', file);
      versionTag && formData.append('versionTag', versionTag);
      extraProps && formData.append('extraProps', JSON.stringify(extraProps));
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

  async listComponents(folderId?: string) {
    if (folderId) {
      return await this.#requestApi<ComponentItem[]>(
        'GET',
        `${ITEM_PATH}/${folderId}/items`,
        { query: { itemType: ITEM_TYPE_COMPONENT } },
      );
    }
    return await this.#requestApi<ComponentItem[]>('GET', `${ITEM_PATH}`, {
      query: { itemType: ITEM_TYPE_COMPONENT },
    });
  }

  async getComponent(componentId: string) {
    return await this.#requestApi<ComponentItem>(
      'GET',
      `${ITEM_PATH}/${componentId}`,
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

  /** @function
   * @name myFunction
   * @param {string} executionId - Identifier of the execution.
   * @param {string} onUpdateCallback - Callback function to be called when the execution is updated.
   * @returns {function} - Function to close the socket connection.
   * */

  async onExecutionProgress(
    executionId: string,
    onUpdateCallback: (data: ExecutionSuscriptionReturnType) => void,
  ) {
    const socket = io(this.wsUrl);

    socket.on('connect', () => {
      socket.emit('executionSubscription', JSON.stringify({ executionId }));
      socket.on('execution', (data: ExecutionSuscriptionReturnType) => {
        onUpdateCallback(data);
      });
    });

    socket.on('connect_error', function (e: any) {
      throw e;
    });

    return socket.close;
  }

  #cleanData(data?: object) {
    return (
      data &&
      Object.entries(data)
        .filter(([_, value]) => value !== undefined)
        .reduce(
          (obj, [key, value]) => {
            obj[key as string] = value;
            return obj;
          },
          {} as { [key: string]: any },
        )
    );
  }
}
