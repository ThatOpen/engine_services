import { Base, ObjectId } from './base';
import { ItemVersion } from './items';

export type StorageData = Base & {
  name: string;
  versions?: ItemVersion[];
  size: number;
  type: StorageDataType;
  parentId?: ObjectId;
};

export type StorageDataType = 'folder' | 'file';
