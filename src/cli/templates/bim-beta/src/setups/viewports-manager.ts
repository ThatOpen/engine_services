import * as OBC from "@thatopen-platform/components-beta";
import { ViewportsManager } from "@thatopen/services";

export const viewportsManager = async (components: OBC.Components) => {
  const viewports = components.get(ViewportsManager);
  const { element, world } = await viewports.create();

  // Load a sample model. Replace with client.downloadFile(fileId) to load
  // a model from the platform:
  //   const response = await client.downloadFile(fileId);
  //   const buffer = await response.arrayBuffer();
  const fragments = components.get(OBC.FragmentsManager);
  const file = await fetch(
    "https://thatopen.github.io/engine_components/resources/frags/school_arq.frag",
  );
  const buffer = await file.arrayBuffer();
  await fragments.core.load(buffer, { modelId: "school_arq" });
  await world.camera.controls.setLookAt(68, 23, -8.5, 21.5, -5.5, 23);
  await fragments.core.update(true);

  return element;
};
