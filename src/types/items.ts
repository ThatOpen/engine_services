import { Base, ObjectId } from './base';

export interface Item extends Base {
  fileExtension?: string;
  name: string;
  itemType: ItemType;
  folderId?: ObjectId;
  internalId: string;
  iconFileId?: string;
  iconMimeType?: string;
}

export type ItemType = 'APP' | 'TOOL' | 'HIDDEN' | 'FILE';

export interface ItemVersion extends Base {
  itemId: ObjectId;
  tag: string;
  fileVersionId: string;
  fileId: string;
  fileSize: number;
  extraProps?: AppVersionProps | ComponentVersionProps;
  isDraft?: boolean;
}

export interface ItemFolder extends Base {
  name: string;
  parentId?: ObjectId;
}

export type ItemWithVersions<T = Item> = T & { versions: ItemVersion[] };

export type AppVersionProps = {
  isOnline?: boolean;
  url?: string;
  /** When set, the app viewer loads the bundle from this URL instead of the API (for local development). */
  devUrl?: string;
};

export type AppItem = Item & { itemType: 'APP' };

export type AppItemVersion = ItemVersion & {
  extraProps: AppVersionProps;
};

export type ComponentType = 'FRONTEND' | 'CLOUD';

export type ComponentTier = 'FREE' | 'PREMIUM';

export type ComponentItemProps = {
  generatedId: string;
};

export type ComponentVersionProps = {
  isPublic?: boolean;
  isOpenSource?: boolean;
  type: ComponentType;
  tier: ComponentTier;
  executionEngineVersion?: string;
};

export type ComponentItem = Item & {
  itemType: 'TOOL';
};

export type ComponentItemVersion = ItemVersion & {
  extraProps: ComponentVersionProps;
};

export type ItemEntity = Item | AppItem | ComponentItem;
