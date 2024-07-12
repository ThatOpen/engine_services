import axios, { Method } from 'axios';
import { ItemFolder } from '../types/items';

const FOLDER_PATH = 'item/folder';
const ITEM_PATH = 'item';
const ITEM_TYPE_FILE = 'FILE';
const ITEM_TYPE_TOOL = 'TOOL';

export class EngineServicesClient {
  apiUrl: string;
  accessToken: string;

  constructor(accessToken: string, apiUrl?: string) {
    const defaultApiUrl = process.env.DEFAULT_API_URL as string;
    if (!apiUrl && !defaultApiUrl) {
      throw new Error(
        'No API URL provided and no default API URL set in environment variables',
      );
    }
    let url = apiUrl || defaultApiUrl;
    if (url.charAt(url.length - 1) === '/') {
      url = url.slice(0, -1);
    }
    this.apiUrl = url;
    this.accessToken = accessToken;
  }

  #buildUrl(path: string) {
    return `${this.apiUrl}/${path}`;
  }

  async #requestApi<T = any>(
    method: Method,
    path: string,
    requestData?: { body?: any; query?: any },
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

  async listFolders(parentFolderId?: string) {
    return await this.#requestApi<ItemFolder[]>('GET', FOLDER_PATH, {
      query: parentFolderId,
    });
  }

  async getFolder(folderId: string) {
    return await this.#requestApi<ItemFolder>(
      'GET',
      `${FOLDER_PATH}/${folderId}`,
    );
  }

  async createFolder(name: string, parentFolderId?: string) {
    return await this.#requestApi<ItemFolder>('POST', FOLDER_PATH, {
      body: { name, parentFolderId },
    });
  }

  async updateFolder(
    folderId: string,
    updateFolderParams: { name?: string; parentFolderId?: string },
  ) {
    const { name, parentFolderId } = updateFolderParams;
    return await this.#requestApi<ItemFolder>(
      'PUT',
      `${FOLDER_PATH}/${folderId}`,
      {
        body: { name, parentFolderId },
      },
    );
  }

  async archiveFolder(folderId: string) {
    return await this.#requestApi<ItemFolder>(
      'DELETE',
      `${FOLDER_PATH}/${folderId}`,
    );
  }

  async listFiles(folderId?: string) {
    if (folderId) {
      return await this.#requestApi<ItemFolder[]>(
        'GET',
        `${ITEM_PATH}/${folderId}/items`,
        { query: { itemType: ITEM_TYPE_FILE } },
      );
    }
    return await this.#requestApi<ItemFolder[]>('GET', `${ITEM_PATH}`, {
      query: { itemType: ITEM_TYPE_FILE },
    });
  }

  async getFile(fileId: string) {
    return await this.#requestApi<ItemFolder>('GET', `${ITEM_PATH}/${fileId}`);
  }

  async createFile(fileData: {
    file: File;
    name: string;
    versionTag: string;
    parentFolderId?: string;
  }) {
    const { name, versionTag, parentFolderId, file } = fileData;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    formData.append('versionTag', versionTag);
    parentFolderId && formData.append('parentFolderId', parentFolderId);

    return await this.#requestApi<ItemFolder>('POST', ITEM_PATH, {
      body: formData,
    });
  }

  async updateFile(
    fileId: string,
    fileData: {
      name?: string;
      parentFolderId?: string;
      file?: File;
      versionTag?: string;
    },
  ) {
    const { name, versionTag, parentFolderId, file } = fileData;
    if (file) {
      const formData = new FormData();
      formData.append('file', file);
      versionTag && formData.append('versionTag', versionTag);
      return await this.#requestApi<ItemFolder>(
        'POST',
        `${ITEM_PATH}/${fileId}/version`,
        {
          body: formData,
        },
      );
    }
    return await this.#requestApi<ItemFolder>('PUT', `${ITEM_PATH}/${fileId}`, {
      body: { name, versionTag, parentFolderId },
    });
  }

  async archiveFile(fileId: string) {
    return await this.#requestApi<ItemFolder>(
      'DELETE',
      `${ITEM_PATH}/${fileId}`,
    );
  }

  async listTools(folderId?: string) {
    if (folderId) {
      return await this.#requestApi<ItemFolder[]>(
        'GET',
        `${ITEM_PATH}/${folderId}/items`,
        { query: { itemType: ITEM_TYPE_TOOL } },
      );
    }
    return await this.#requestApi<ItemFolder[]>('GET', `${ITEM_PATH}`, {
      query: { itemType: ITEM_TYPE_TOOL },
    });
  }

  async getTool(toolId: string) {
    return await this.#requestApi<ItemFolder>('GET', `${ITEM_PATH}/${toolId}`);
  }

  async createTool(toolData: {
    name: string;
    versionTag: string;
    parentFolderId?: string;
  }) {
    const { name, versionTag, parentFolderId } = toolData;
    return await this.#requestApi<ItemFolder>('POST', ITEM_PATH, {
      body: { name, versionTag, parentFolderId },
    });
  }

  async updateTool(
    toolId: string,
    toolData: {
      name?: string;
      parentFolderId?: string;
      versionTag?: string;
    },
  ) {
    const { name, versionTag, parentFolderId } = toolData;
    return await this.#requestApi<ItemFolder>('PUT', `${ITEM_PATH}/${toolId}`, {
      body: { name, versionTag, parentFolderId },
    });
  }

  async archiveTool(toolId: string) {
    return await this.#requestApi<ItemFolder>(
      'DELETE',
      `${ITEM_PATH}/${toolId}`,
    );
  }
}
