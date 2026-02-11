import { EngineServicesClient } from '../src/core/client';

let client: EngineServicesClient | null = null;

// ─── Logging ───

const logEl = document.getElementById('log')!;

function log(message: string, type: 'info' | 'success' | 'error' = 'info') {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="log-time">${time}</span> ${message}`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

function logResult(label: string, data: unknown) {
  try {
    const formatted =
      typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    log(`<strong>${label}</strong>\n${formatted}`, 'success');
  } catch {
    log(`<strong>${label}</strong>\n${String(data)}`, 'success');
  }
}

function logError(label: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  log(`<strong>${label}</strong> — ${msg}`, 'error');
}

(window as any).clearLog = () => {
  logEl.innerHTML = '';
};

// ─── localStorage persistence ───

const LS_API_URL = 'thatopen_test_apiUrl';
const LS_TOKEN = 'thatopen_test_token';

function loadSavedConfig() {
  const savedUrl = localStorage.getItem(LS_API_URL);
  const savedToken = localStorage.getItem(LS_TOKEN);
  const apiUrlEl = document.getElementById('apiUrl') as HTMLInputElement;
  const tokenEl = document.getElementById('accessToken') as HTMLInputElement;

  if (savedUrl) apiUrlEl.value = savedUrl;
  if (savedToken) tokenEl.value = savedToken;

  if (savedUrl && savedToken) {
    (window as any).connect();
  }
}

// ─── Connection ───

(window as any).connect = () => {
  const apiUrl = (document.getElementById('apiUrl') as HTMLInputElement).value;
  const token = (document.getElementById('accessToken') as HTMLInputElement)
    .value;

  if (!apiUrl || !token) {
    log('Please enter both API URL and Access Token', 'error');
    return;
  }

  localStorage.setItem(LS_API_URL, apiUrl);
  localStorage.setItem(LS_TOKEN, token);

  client = new EngineServicesClient(token, apiUrl);
  log(`Connected to ${apiUrl}`, 'info');

  const btn = document.getElementById('connectBtn')!;
  btn.textContent = 'Connected';
  btn.classList.add('connected');
};

// ─── Helpers ───

function ensureClient(): EngineServicesClient {
  if (!client) throw new Error('Not connected. Click Connect first.');
  return client;
}

function getInput(id: string): string {
  return (document.getElementById(id) as HTMLInputElement)?.value || '';
}

function getFile(id: string): File | null {
  const input = document.getElementById(id) as HTMLInputElement;
  return input?.files?.[0] || null;
}

async function run(label: string, fn: () => Promise<unknown>) {
  log(`Running: ${label}...`, 'info');
  try {
    const result = await fn();
    logResult(label, result);
  } catch (err) {
    logError(label, err);
  }
}

// ─── Test Definitions ───

type TestGroup = {
  title: string;
  tests: TestDef[];
};

type TestDef = {
  label: string;
  inputs?: { id: string; placeholder: string; type?: 'text' | 'file' }[];
  fn: () => Promise<unknown>;
};

const testGroups: TestGroup[] = [
  // ─── Files ───
  {
    title: 'Files',
    tests: [
      {
        label: 'listFiles()',
        fn: () => ensureClient().listFiles(),
      },
      {
        label: 'createFile(file, name, versionTag)',
        inputs: [
          { id: 'crFileFile', placeholder: 'File', type: 'file' },
          { id: 'crFileName', placeholder: 'Name' },
          { id: 'crFileVersion', placeholder: 'Version tag (e.g. 1.0.0)' },
        ],
        fn: () => {
          const file = getFile('crFileFile');
          if (!file) throw new Error('Please select a file');
          return ensureClient().createFile({
            file,
            name: getInput('crFileName') || file.name,
            versionTag: getInput('crFileVersion') || '1.0.0',
          });
        },
      },
      {
        label: 'getFile(fileId)',
        inputs: [{ id: 'getFileId', placeholder: 'File ID' }],
        fn: () =>
          ensureClient().getFile(getInput('getFileId'), {
            showVersions: true,
          }),
      },
      {
        label: 'getFileMetadata(fileId)',
        inputs: [{ id: 'getFileMetaId', placeholder: 'File ID' }],
        fn: () => ensureClient().getFileMetadata(getInput('getFileMetaId')),
      },
      {
        label: 'downloadFile(fileId)',
        inputs: [{ id: 'dlFileId', placeholder: 'File ID' }],
        fn: async () => {
          const resp = await ensureClient().downloadFile(getInput('dlFileId'));
          return `Status: ${resp.status}, Content-Type: ${resp.headers.get('content-type')}, Size: ${resp.headers.get('content-length') || 'unknown'} bytes`;
        },
      },
      {
        label: 'archiveFile(fileId)',
        inputs: [{ id: 'archFileId', placeholder: 'File ID' }],
        fn: () => ensureClient().archiveFile(getInput('archFileId')),
      },
    ],
  },

  // ─── Folders ───
  {
    title: 'Folders',
    tests: [
      {
        label: 'listFolders()',
        fn: () => ensureClient().listFolders(),
      },
      {
        label: 'createFolder(name)',
        inputs: [{ id: 'newFolderName', placeholder: 'Folder name' }],
        fn: () =>
          ensureClient().createFolder(
            getInput('newFolderName') || 'test-folder',
          ),
      },
      {
        label: 'getFolder(folderId)',
        inputs: [{ id: 'getFolderId', placeholder: 'Folder ID' }],
        fn: () => ensureClient().getFolder(getInput('getFolderId')),
      },
      {
        label: 'archiveFolder(folderId)',
        inputs: [{ id: 'archFolderId', placeholder: 'Folder ID' }],
        fn: () => ensureClient().archiveFolder(getInput('archFolderId')),
      },
    ],
  },

  // ─── Components ───
  {
    title: 'Components',
    tests: [
      {
        label: 'listComponents()',
        fn: () => ensureClient().listComponents(),
      },
      {
        label: 'createComponent(file, name, versionTag)',
        inputs: [
          { id: 'crCompFile', placeholder: 'Component file', type: 'file' },
          { id: 'crCompName', placeholder: 'Name' },
          { id: 'crCompVersion', placeholder: 'Version tag (e.g. 1.0.0)' },
        ],
        fn: () => {
          const file = getFile('crCompFile');
          if (!file) throw new Error('Please select a file');
          return ensureClient().createComponent({
            file,
            name: getInput('crCompName') || file.name,
            versionTag: getInput('crCompVersion') || '1.0.0',
            componentProps: { executionEnvironment: 'CLOUD' },
          });
        },
      },
      {
        label: 'getComponent(id)',
        inputs: [{ id: 'getCompId', placeholder: 'Component ID' }],
        fn: () =>
          ensureClient().getComponent(getInput('getCompId'), {
            showVersions: true,
          }),
      },
      {
        label: 'downloadComponent(id)',
        inputs: [{ id: 'dlCompId', placeholder: 'Component ID' }],
        fn: async () => {
          const resp = await ensureClient().downloadComponent(getInput('dlCompId'));
          return `Status: ${resp.status}, Content-Type: ${resp.headers.get('content-type')}, Size: ${resp.headers.get('content-length') || 'unknown'} bytes`;
        },
      },
      {
        label: 'archiveComponent(id)',
        inputs: [{ id: 'archCompId', placeholder: 'Component ID' }],
        fn: () => ensureClient().archiveComponent(getInput('archCompId')),
      },
    ],
  },

  // ─── Apps ───
  {
    title: 'Apps',
    tests: [
      {
        label: 'listApps()',
        fn: () => ensureClient().listApps(),
      },
      {
        label: 'createApp(file, name, versionTag)',
        inputs: [
          { id: 'crAppFile', placeholder: 'App file', type: 'file' },
          { id: 'crAppName', placeholder: 'Name' },
          { id: 'crAppVersion', placeholder: 'Version tag (e.g. 1.0.0)' },
        ],
        fn: () => {
          const file = getFile('crAppFile');
          if (!file) throw new Error('Please select a file');
          return ensureClient().createApp({
            file,
            name: getInput('crAppName') || file.name,
            versionTag: getInput('crAppVersion') || '1.0.0',
          });
        },
      },
      {
        label: 'downloadApp(appId)',
        inputs: [{ id: 'dlAppId', placeholder: 'App ID' }],
        fn: async () => {
          const resp = await ensureClient().downloadApp(getInput('dlAppId'));
          return `Status: ${resp.status}, Content-Type: ${resp.headers.get('content-type')}, Size: ${resp.headers.get('content-length') || 'unknown'} bytes`;
        },
      },
      {
        label: 'archiveApp(appId)',
        inputs: [{ id: 'archAppId', placeholder: 'App ID' }],
        fn: () => ensureClient().archiveApp(getInput('archAppId')),
      },
    ],
  },

  // ─── Execution ───
  {
    title: 'Execution',
    tests: [
      {
        label: 'executeComponent(componentId, params)',
        inputs: [
          { id: 'execCompId', placeholder: 'Component ID' },
          { id: 'execParams', placeholder: 'Params JSON (e.g. {})' },
        ],
        fn: () => {
          const params = getInput('execParams') || '{}';
          return ensureClient().executeComponent(
            getInput('execCompId'),
            JSON.parse(params),
          );
        },
      },
      {
        label: 'listExecutions(componentId)',
        inputs: [{ id: 'listExecCompId', placeholder: 'Component ID' }],
        fn: () =>
          ensureClient().listExecutions(getInput('listExecCompId')),
      },
      {
        label: 'getExecution(executionId)',
        inputs: [{ id: 'getExecId', placeholder: 'Execution ID' }],
        fn: () => ensureClient().getExecution(getInput('getExecId')),
      },
      {
        label: 'abortExecution(executionId)',
        inputs: [{ id: 'abortExecId', placeholder: 'Execution ID' }],
        fn: () => ensureClient().abortExecution(getInput('abortExecId')),
      },
    ],
  },

  // ─── General Item Operations ───
  {
    title: 'Item Operations',
    tests: [
      {
        label: 'updateItem(itemId, { name, folderId })',
        inputs: [
          { id: 'updItemId', placeholder: 'Item ID' },
          { id: 'updItemName', placeholder: 'New name (optional)' },
          { id: 'updItemFolder', placeholder: 'New folder ID (optional)' },
        ],
        fn: () => {
          const name = getInput('updItemName') || undefined;
          const folderId = getInput('updItemFolder') || undefined;
          return ensureClient().updateItem(getInput('updItemId'), { name, folderId });
        },
      },
      {
        label: 'createVersion(itemId, file, versionTag, extraProps)',
        inputs: [
          { id: 'crVerItemId', placeholder: 'Item ID' },
          { id: 'crVerFile', placeholder: 'File', type: 'file' },
          { id: 'crVerTag', placeholder: 'Version tag (e.g. 2.0.0)' },
          { id: 'crVerProps', placeholder: 'Extra props JSON (required for apps/components)' },
        ],
        fn: () => {
          const file = getFile('crVerFile');
          if (!file) throw new Error('Please select a file');
          const propsStr = getInput('crVerProps');
          const extraProps = propsStr ? JSON.parse(propsStr) : undefined;
          return ensureClient().createVersion(
            getInput('crVerItemId'),
            file,
            getInput('crVerTag') || '1.0.0',
            extraProps,
          );
        },
      },
    ],
  },

  // ─── Projects ───
  {
    title: 'Projects',
    tests: [
      {
        label: 'getProjectData(projectId)',
        inputs: [{ id: 'getProjId', placeholder: 'Project ID' }],
        fn: () => ensureClient().getProjectData(getInput('getProjId')),
      },
    ],
  },

  // ─── Permissions ───
  {
    title: 'Permissions',
    tests: [
      {
        label: 'checkPermission(resourceId, resourceType, action, projectId)',
        inputs: [
          { id: 'permResId', placeholder: 'Resource ID' },
          { id: 'permResType', placeholder: 'Resource type (e.g. STORAGE)' },
          { id: 'permAction', placeholder: 'Action (e.g. READ)' },
          { id: 'permProjId', placeholder: 'Project ID' },
        ],
        fn: () =>
          ensureClient().checkPermission({
            resourceId: getInput('permResId'),
            resourceType: getInput('permResType'),
            action: getInput('permAction'),
            projectId: getInput('permProjId'),
          }),
      },
    ],
  },

];

// ─── Render UI ───

function renderMethods() {
  const container = document.getElementById('methods')!;

  for (const group of testGroups) {
    const h3 = document.createElement('h3');
    h3.textContent = group.title;
    container.appendChild(h3);

    for (const test of group.tests) {
      if (test.inputs) {
        const inputRow = document.createElement('div');
        inputRow.className = 'input-row';
        for (const input of test.inputs) {
          const inp = document.createElement('input');
          inp.type = input.type || 'text';
          inp.id = input.id;
          inp.placeholder = input.placeholder;
          if (input.type === 'file') {
            inp.style.fontSize = '11px';
          }
          inputRow.appendChild(inp);
        }
        container.appendChild(inputRow);
      }

      const btn = document.createElement('button');
      btn.className = 'test-btn';
      btn.textContent = test.label;
      btn.addEventListener('click', () => run(test.label, test.fn));
      container.appendChild(btn);
    }
  }
}

renderMethods();
loadSavedConfig();
