import * as OBC from "@thatopen-platform/components-beta";
import * as BUI from "@thatopen/ui";
import { UIManager } from "@thatopen/services";
import {
  appInfoSectionTemplate,
  AppInfoSectionState,
  cloudRunnerSectionTemplate,
  CloudRunnerSectionState,
} from "../ui-components";

export type CustomUIs = {
  appInfoSection: { type: BUI.PanelSection; state: AppInfoSectionState };
  cloudRunnerSection: { type: BUI.PanelSection; state: CloudRunnerSectionState };
};

export const getUIManager = (components: OBC.Components) =>
  components.get(UIManager<CustomUIs>);

export const uiManager = (components: OBC.Components) => {
  const uis = getUIManager(components);
  uis.registerTemplate("appInfoSection", {
    template: appInfoSectionTemplate,
  });
  uis.registerTemplate("cloudRunnerSection", {
    template: cloudRunnerSectionTemplate,
  });
};
