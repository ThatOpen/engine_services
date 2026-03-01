import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface ThatOpenConfig {
  accessToken: string;
  apiUrl: string;
}

const CONFIG_DIR = join(homedir(), '.thatopen');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export function readConfig(): ThatOpenConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as ThatOpenConfig;
  } catch {
    return null;
  }
}

export function writeConfig(config: ThatOpenConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function requireConfig(): ThatOpenConfig {
  const config = readConfig();
  if (!config) {
    console.error('Not logged in. Run `thatopen login` first.');
    process.exit(1);
  }
  return config;
}

// ---------------------------------------------------------------------------
// Local project config (.thatopen in project root)
// ---------------------------------------------------------------------------

export type ProjectType = 'APP' | 'COMPONENT';

export interface ThatOpenLocalConfig {
  accessToken: string;
  apiUrl: string;
  appId?: string;
  componentId?: string;
  /** Project type marker set by `thatopen create`. */
  itemType?: ProjectType;
  /** Path to an icon file (PNG, WebP, or ICO) uploaded on publish. */
  iconPath?: string;
}

const LOCAL_CONFIG_FILE = '.thatopen';

export function readLocalConfig(cwd?: string): ThatOpenLocalConfig | null {
  const dir = cwd || process.cwd();
  const filePath = join(dir, LOCAL_CONFIG_FILE);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as ThatOpenLocalConfig;
  } catch {
    return null;
  }
}

export function writeLocalConfig(
  config: ThatOpenLocalConfig,
  cwd?: string,
): void {
  const dir = cwd || process.cwd();
  writeFileSync(join(dir, LOCAL_CONFIG_FILE), JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function updateLocalConfig(
  updates: Partial<ThatOpenLocalConfig>,
  cwd?: string,
): void {
  const existing = readLocalConfig(cwd) || ({} as ThatOpenLocalConfig);
  writeLocalConfig({ ...existing, ...updates }, cwd);
}

/** Resolve config: local .thatopen first, then global ~/.thatopen/config.json */
export function resolveConfig(cwd?: string): ThatOpenConfig | null {
  const local = readLocalConfig(cwd);
  if (local?.accessToken && local?.apiUrl) {
    return { accessToken: local.accessToken, apiUrl: local.apiUrl };
  }
  return readConfig();
}

/** Like requireConfig but checks local config first. */
export function requireResolvedConfig(cwd?: string): ThatOpenConfig {
  const config = resolveConfig(cwd);
  if (!config) {
    console.error(
      'Not logged in. Run `npm run login -- --token <token>` or `thatopen login` first.',
    );
    process.exit(1);
  }
  return config;
}
