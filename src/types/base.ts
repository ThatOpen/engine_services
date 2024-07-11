export interface Base {
  _id: ObjectId;
  createdAt: Date;
  updatedAt?: Date;
  creatingUser: ObjectId;
  creatingToken?: ObjectId;
  archived?: boolean;
}

export type ObjectId = string | any;
