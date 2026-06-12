import * as OBC from "@thatopen/components";

export const initIfcLoader = async (components: OBC.Components): Promise<void> => {
  const ifcLoader = components.get(OBC.IfcLoader);
  await ifcLoader.setup({
    autoSetWasm: false,
    wasm: {
      path: "https://unpkg.com/web-ifc@0.0.77/",
      absolute: true,
    },
  });
};
