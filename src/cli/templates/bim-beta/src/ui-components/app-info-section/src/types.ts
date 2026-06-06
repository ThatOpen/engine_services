import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen-platform/components-beta";

export interface AppInfoSectionState {
  components: OBC.Components;
}

export type AppInfoSectionComponent =
  BUI.StatefullComponent<AppInfoSectionState>;

// Used in App type (app.ts) to type this element slot in the grid.
export type AppInfoSectionGridElement = {
  name: "appInfoSection";
  state: AppInfoSectionState;
};
