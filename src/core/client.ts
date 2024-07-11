import axios from 'axios';
import { ItemFolder } from '../types/items';

const FOLDER_PATH = 'item/folder';
// const ITEM_PATH = 'item';
// const ITEM_TYPE_FILE = 'FILE';
// const ITEM_TYPE_TOOL = 'TOOL';

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

  async getFolders(parentFolderId?: string) {
    const url = this.#buildUrl(FOLDER_PATH);

    const params = {
      accessToken: this.accessToken,
      parentFolderId,
    };
    const response = (await axios.get(url, { params })).data as ItemFolder[];

    return response;
  }
}
