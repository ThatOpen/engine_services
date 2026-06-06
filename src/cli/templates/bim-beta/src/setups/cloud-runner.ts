import * as OBC from "@thatopen-platform/components-beta";
import { CloudRunner } from "../bim-components";
import { getUIManager } from "./ui-manager";

export const cloudRunner = (components: OBC.Components) => {
  const runner = components.get(CloudRunner);
  const uis = getUIManager(components);

  // Re-render all appInfoSection instances whenever execution state changes.
  runner.onExecutionUpdated.add(() => {
    uis.custom.get("cloudRunnerSection").updateInstances();
  });
};
