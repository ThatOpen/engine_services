import * as BUI from "@thatopen/ui";
import { AppInfoSectionComponent } from "./src";
import { getAppManager } from "../../app";

export const appInfoSectionTemplate: AppInfoSectionComponent = ({
  components,
}) => {
  const app = getAppManager(components);

  const fileItems =
    app.projectData?.files.map(
      (f: { name: string }) => BUI.html`<bim-label>${f.name}</bim-label>`,
    ) ?? [];

  return BUI.html`
    <bim-panel-section label="App Info" icon="solar:info-circle-bold">
      <bim-label>App ID: ${app.client?.context.appId}</bim-label>
      <bim-label>Project ID: ${app.client?.context.projectId}</bim-label>
      <bim-label>API URL: ${app.client?.context.apiUrl}</bim-label>
      <bim-label>Files: ${fileItems.length}</bim-label>
      ${fileItems}
    </bim-panel-section>
  `;
};

export * from "./src";
