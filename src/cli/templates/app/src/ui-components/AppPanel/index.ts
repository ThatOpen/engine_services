import { LitElement, html } from "lit";
import { state } from "lit/decorators.js";
import { consume, createContext } from "@lit/context";
import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import { PlatformClient } from "@thatopen/services";
import type { Item } from "@thatopen/services";
import { CloudRunner } from "../../bim-components";

const componentsContext = createContext<OBC.Components | undefined>("obc-components");
const clientContext = createContext<PlatformClient | undefined>("platform-client");

type FileRow = { Name: string; Extension: string; Load: string };

export class AppPanel extends LitElement {
  @consume({ context: componentsContext, subscribe: true })
  @state() private _components?: OBC.Components;

  @consume({ context: clientContext, subscribe: true })
  @state() private _client?: PlatformClient;

  @state() private _files: Item[] = [];
  @state() private _loaded = new Set<string>();
  @state() private _loading = new Set<string>();

  @state() private _runnerStatus = "Idle";
  @state() private _runnerProgress = 0;
  @state() private _runnerMessages: string[] = [];
  @state() private _runnerComponentId = "your-component-id";
  @state() private _running = false;

  private _runner?: CloudRunner;

  async updated(changed: Map<string, unknown>) {
    if ((changed.has("_components") || changed.has("_client")) && this._components && this._client) {
      if (!this._runner) {
        this._runner = this._components.get(CloudRunner);
        this._runner.client = this._client;
        this._runner.onExecutionUpdated.add(({ status, progress, messages }) => {
          this._runnerStatus = status;
          this._runnerProgress = progress;
          this._runnerMessages = messages;
          if (status.startsWith("SUCCESS") || status.startsWith("ERROR") || status.startsWith("WARNING")) {
            this._running = false;
          }
        });
      } else {
        this._runner.client = this._client;
      }
      await this._fetchFiles();
    }
  }

  private async _fetchFiles() {
    const projectId = (window as any).__THATOPEN_CONTEXT__?.projectId;
    if (!this._client || !projectId) return;
    const all = await this._client.listFiles({ projectId });
    this._files = all.filter(f => f.fileExtension === "ifc" || f.fileExtension === "frag");
  }

  private async _toggleModel(file: Item) {
    const id = file._id;
    if (this._loaded.has(id)) {
      await this._components!.get(OBC.FragmentsManager).core.disposeModel(id).catch(() => {});
      this._loaded = new Set([...this._loaded].filter(x => x !== id));
    } else {
      this._loading = new Set([...this._loading, id]);
      try {
        const response = await this._client!.downloadFile(id);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (file.fileExtension === "frag") {
          await this._components!.get(OBC.FragmentsManager).core.load(bytes, { modelId: id });
        } else {
          await this._components!.get(OBC.IfcLoader).load(bytes, true, id);
        }
        this._loaded = new Set([...this._loaded, id]);
      } finally {
        this._loading = new Set([...this._loading].filter(x => x !== id));
      }
    }
  }

  private async _run(useLocal: boolean) {
    if (!this._runner) return;
    this._runner.componentId = this._runnerComponentId;
    this._running = true;
    await this._runner.run(useLocal);
  }

  private get _tableData(): BUI.TableGroupData<FileRow>[] {
    return this._files.map(f => ({
      data: { Name: f.name, Extension: f.fileExtension ?? "", Load: f._id },
    }));
  }

  private get _dataTransform(): BUI.TableDataTransform<FileRow> {
    return {
      Load: (fileId) => {
        const file = this._files.find(f => f._id === fileId)!;
        const loaded = this._loaded.has(fileId);
        const loading = this._loading.has(fileId);
        return BUI.html`
          <bim-button
            .label=${loaded ? "Unload" : "Load"}
            .icon=${loaded ? "solar:eye-closed-bold" : "solar:eye-bold"}
            .loading=${loading}
            @click=${() => this._toggleModel(file)}
          ></bim-button>
        `;
      },
    };
  }

  render() {
    return html`
      <bim-tabs>
        <bim-tab name="models" label="Models" icon="solar:folder-bold">
          <bim-panel-section label="Project Files">
            <bim-table
              .columns=${["Name", "Extension", "Load"]}
              .data=${this._tableData}
              .dataTransform=${this._dataTransform}
            ></bim-table>
          </bim-panel-section>
        </bim-tab>
        <bim-tab name="runner" label="Cloud Runner" icon="solar:code-bold">
          <bim-panel>
            <bim-panel-section label="Component">
              <bim-text-input
                label="Component ID"
                value=${this._runnerComponentId}
                @change=${(e: Event) => { this._runnerComponentId = (e.target as HTMLInputElement).value; }}
              ></bim-text-input>
              <div style="display:flex;gap:0.5rem;">
                <bim-button
                  label="Run"
                  .icon=${"solar:play-bold"}
                  .loading=${this._running}
                  @click=${() => this._run(false)}
                ></bim-button>
                <bim-button
                  label="Run Local"
                  .icon=${"solar:server-bold"}
                  .loading=${this._running}
                  @click=${() => this._run(true)}
                ></bim-button>
              </div>
            </bim-panel-section>
            <bim-panel-section label="Status">
              <bim-label>${this._runnerStatus}</bim-label>
              ${this._runnerMessages.map(m => html`<bim-label>${m}</bim-label>`)}
            </bim-panel-section>
          </bim-panel>
        </bim-tab>
      </bim-tabs>
    `;
  }
}

customElements.define("app-panel", AppPanel);
