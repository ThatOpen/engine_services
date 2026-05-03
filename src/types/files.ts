import { Readable } from 'stream';
import { ObjectId } from './base';

export type FileType = string | Uint8Array | Buffer | Readable;

export type HiddenFileEntity = {
  fileId: string;
  _id: ObjectId;
  parentItemId: ObjectId;
};

export type CreateHiddenItemResult = {
  hiddenFileId: string;
};

export type MetadataValue = string | number | boolean | null;

export type Metadata = Record<string, MetadataValue>;

export const METADATA_LIMITS = {
  MAX_FIELDS: 200,
  MAX_KEY_LENGTH: 50,
  MAX_VALUE_LENGTH: 50,
} as const;
