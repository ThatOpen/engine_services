import * as OBC from "@thatopen-platform/components-beta";
import * as BUI from "@thatopen/ui";

export interface CloudRunnerSectionState {
  components: OBC.Components;
}

export type CloudRunnerSectionComponent =
  BUI.StatefullComponent<CloudRunnerSectionState>;

export type CloudRunnerSectionGridElement = {
  name: "cloudRunnerSection";
  state: CloudRunnerSectionState;
};
