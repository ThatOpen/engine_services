import * as OBC from "@thatopen/components";
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
