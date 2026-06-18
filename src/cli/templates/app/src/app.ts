import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import { AppManager } from "@thatopen/services";
import { icons } from "./globals";

export type App = {
  icons: (keyof typeof icons)[];
  grid: BUI.Grid<
    ["Explorer", "Files", "Graphics"],
    ["viewer", "explorer", "files", "graphics"]
  >;
};

export const getAppManager = (components: OBC.Components) =>
  components.get(AppManager<App>);
