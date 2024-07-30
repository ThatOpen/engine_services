import { Base, ObjectId } from './base';

export interface Item extends Base {
  fileExtension?: string;
  name: string;
  itemType: ItemType;
  folderId?: string;
}

export type ItemType = 'APP' | 'TOOL' | 'HIDDEN' | 'FILE';

export interface ItemVersion extends Base {
  itemId: ObjectId;
  tag: string;
  fileVersionId: string;
  fileId: string;
  fileSize: number;
}

export interface ItemFolder extends Base {
  name: string;
  parentId?: string;
}

export type ItemWithVersions<T = Item> = T & { versions: ItemVersion[] };

export type AppSource = 'custom' | 'built-in';

export type AppProps = {
  isOnline?: boolean;
  source: AppSource;
  url?: string;
};

export type AppItem = Item & { itemType: 'APP'; extraProps: AppProps };

export type ComponentType = 'FRONTEND' | 'CLOUD';

export type ComponentProps = {
  isPublic?: boolean;
  isOpenSource?: AppSource;
  price?: number;
  componentId: string;
  type: ComponentType;
};

export type ComponentItem = Item & {
  itemType: 'TOOL';
  extraProps: ComponentProps;
};
