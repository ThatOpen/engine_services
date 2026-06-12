import * as OBC from "@thatopen/components";
import { EngineServicesClient } from "@thatopen/services";
import { CloudRunner } from "../bim-components";

export const setupCloudRunner = (components: OBC.Components, client: EngineServicesClient) => {
  const runner = components.get(CloudRunner);
  runner.client = client;
  return runner;
};
