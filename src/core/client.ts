import axios, { Method } from 'axios';
import { UpdateItemDto, UpdateItemFolderDto } from '../types/item.dto';
import {
  ComponentItem,
  ComponentProps,
  Item,
  ItemFolder,
  ItemType,
  ItemVersion,
} from '../types/items';
import { CreateItemResponse, UpdateItemResponse } from '../types/response';

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
  componentProps: ComponentProps;
};

export type UpdateComponentProps = UpdateItemProps & {
  componentProps: ComponentProps;
};

export class EngineServicesClient {
  apiUrl: string;
  accessToken: string;

  constructor(accessToken: string, apiUrl: string) {
    let url = apiUrl;
    if (url.charAt(url.length - 1) === '/') {
      url = url.slice(0, -1);
    }
    this.apiUrl = url;
    this.accessToken = accessToken;
  }

  #buildUrl(path: string) {
    return `${this.apiUrl}/${path}`;
  }

  async #requestApi<T = object>(
    method: Method,
    path: string,
    requestData?: { body?: object; query?: object },
  ) {
    const { body, query } = requestData || {};
    const url = this.#buildUrl(path);

    const params = {
      ...query,
      accessToken: this.accessToken,
    };

    const response = await axios.request({ method, url, data: body, params });

    return response.data as T;
  }

  async #requestFile(path: string, requestData?: { query?: object }) {
    const { query } = requestData || {};
    const url = this.#buildUrl(path);
    const params = {
      ...query,
      accessToken: this.accessToken,
    };
    const response = await axios.request<ReadableStream>({
      url,
      params,
      responseType: 'stream',
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
      body: { name },
    });
  }

  async updateFolder(folderId: string, updateFolderParams: { name?: string }) {
    const { name } = updateFolderParams;
    return await this.#requestApi<ItemFolder>(
      'PUT',
      `${FOLDER_PATH}/${folderId}`,
      {
        body: { name } as UpdateItemFolderDto,
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

  async downloadFile(fileId: string) {
    return await this.#requestFile(`${ITEM_PATH}/${fileId}/download`);
  }

  async downloadFolder(folderId: string) {
    return await this.#requestFile(`${FOLDER_PATH}/${folderId}/download`);
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
      version = await this.#requestApi<ItemVersion>(
        'POST',
        `${ITEM_PATH}/${itemId}/version`,
        {
          body: formData,
        },
      );
    }
    if (name || parentFolderId || extraProps) {
      const body: UpdateItemDto = {
        ...(name && { name }),
        ...(parentFolderId && { folderId: parentFolderId }),
        ...(extraProps && { extraProps }),
      };

      item = await this.#requestApi<T>('PUT', `${ITEM_PATH}/${itemId}`, {
        body,
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
    return await this.#createItem<ComponentItem, ComponentProps>(
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
    return await this.#updateItem<ComponentItem, ComponentProps>(
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

  async executeComponent(componentId: string) {
    return await this.#requestApi<ComponentItem>(
      'POST',
      `${PROCESS_PATH}/${componentId}/execute`,
    );
  }
}
