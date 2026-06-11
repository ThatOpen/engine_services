import * as BUI from "@thatopen/ui";
import { CloudRunner } from "../../bim-components";
import { CloudRunnerSectionComponent } from "./src";

export const cloudRunnerSectionTemplate: CloudRunnerSectionComponent = ({
  components,
}) => {
  const runner = components.get(CloudRunner);

  const messageItems = runner.messages.map(
    (m) => BUI.html`<bim-label>${m}</bim-label>`,
  );

  return BUI.html`
    <bim-panel-section label="Cloud Component" icon="solar:code-bold">
      <bim-label>Component ID: ${runner.componentId}</bim-label>
      <bim-label>Local server: ${runner.localServerUrl}</bim-label>
      <div style="display:flex;gap:0.5rem;">
        <bim-button
          label="Run Local"
          icon="solar:play-bold"
          @click=${() => runner.run(true)}
        ></bim-button>
        <bim-button
          label="Run Deployed"
          icon="solar:cloud-bold-duotone"
          @click=${() => runner.run(false)}
        ></bim-button>
      </div>
      <bim-label>${runner.status}</bim-label>
      <bim-label>Progress: ${runner.progress}%</bim-label>
      ${messageItems}
    </bim-panel-section>
  `;
};

export * from "./src";
