import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";

export const initFragments = async (components: OBC.Components): Promise<void> => {
  const fragments = components.get(OBC.FragmentsManager);

  const moduleWorkerUrl = await FRAGS.FragmentsModels.getWorker();
  const workerUrl = await FRAGS.toClassicWorker(moduleWorkerUrl);
  fragments.init(workerUrl, { classicWorker: true });

  fragments.core.models.materials.list.onItemSet.add(({ value: material }) => {
    if (!("isLodMaterial" in material && material.isLodMaterial)) {
      material.polygonOffset = true;
      material.polygonOffsetUnits = 1;
      material.polygonOffsetFactor = Math.random();
    }
  });
};
