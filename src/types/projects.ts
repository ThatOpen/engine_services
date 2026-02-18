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

// ─── Project Data DTO ─────────────────────────────────────────────

/** Stripped-down user info safe for app consumption. */
export interface ProjectDataUser {
  _id: string;
  fullName: string;
  email: string;
}

/** A project member with their role info. */
export interface ProjectDataMember {
  projectUserId: string;
  user: ProjectDataUser;
  role: ProjectRole;
}

/** Minimal file info for the project data. */
export interface ProjectDataFile {
  _id: string;
  name: string;
  fileExtension?: string;
  folderId?: string;
  itemType: string;
  createdAt: string;
}

/** Minimal folder info for the project data. */
export interface ProjectDataFolder {
  _id: string;
  name: string;
  parentId?: string;
}

/** Aggregated project data returned by `getProjectData()`. */
export interface ProjectData {
  project: Project;
  currentUser: ProjectDataMember | null;
  users: ProjectDataMember[];
  roles: ProjectRole[];
  files: ProjectDataFile[];
  folders: ProjectDataFolder[];
}
