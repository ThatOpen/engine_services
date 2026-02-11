import { Base, ObjectId } from './base';

export type PermissionSubject =
  | 'PROJECT'
  | 'MEMBERS'
  | 'ROLES'
  | 'APP'
  | 'STORAGE'
  | 'EVENTS'
  | 'ALL';

export type PermissionAction =
  | 'CREATE'
  | 'READ'
  | 'UPDATE'
  | 'DELETE'
  | 'MANAGE';

export interface Permission {
  action: PermissionAction;
  subject?: PermissionSubject;
}

export interface Project extends Base {
  title: string;
  description?: string;
}

export interface ProjectRole extends Base {
  projectId: ObjectId;
  name: string;
  description?: string;
  permissions: Permission[];
  fixed?: boolean;
}

export interface ProjectWithRole {
  project: Project;
  role: ProjectRole | null;
}
