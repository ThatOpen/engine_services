import * as OBC from "@thatopen-platform/components-beta";
import * as BUI from "@thatopen/ui";
import { AppManager } from "@thatopen/services";
import { icons } from "./globals";
import { AppInfoSectionGridElement, CloudRunnerSectionGridElement } from "./ui-components";

export type App = {
  icons: (keyof typeof icons)[];
  grid: BUI.Grid<
    ["Viewer", "Split"],
    ["viewer", AppInfoSectionGridElement, CloudRunnerSectionGridElement]
  >;
};

export const getAppManager = (components: OBC.Components) =>
  components.get(AppManager<App>);
