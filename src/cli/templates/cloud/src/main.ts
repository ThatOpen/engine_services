// Cloud Component Entry Point
//
// Your component runs on the server as a Node.js process.
// The execution engine provides these globals — do NOT import them:
//
//   thatOpenServices  — pre-authenticated EngineServicesClient
//   executionParams   — parameters passed by the caller
//   executionReporter — { message(msg), progress(pct) } for live feedback
//   OBC              — @thatopen/components (BIM engine)
//   THREE            — three (3D math/geometry)
//   WEBIFC           — web-ifc (low-level IFC parser, may not be available)
//   fs               — Node.js filesystem module
//
// Return value — must be { type, message }:
//   type: "SUCCESS" | "FAIL" | "WARNING"
//
// Common patterns:
//   Download a file:  const res = await thatOpenServices.downloadFile(fileId);
//   Upload results:   await thatOpenServices.createFile({ file: blob, name, versionTag });
//   List files:       const files = await thatOpenServices.listFiles();
//   Trigger another:  await thatOpenServices.executeComponent(componentId, params);

// Globals injected by the execution engine at runtime — keep these for type checking
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const thatOpenServices: import("thatopen-services").EngineServicesClient;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const executionParams: Record<string, unknown>;
declare const executionReporter: {
  message(msg: string): void;
  progress(pct: number): void;
};
declare const OBC: typeof import("@thatopen/components");
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const THREE: typeof import("three");
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const fs: typeof import("fs");

export async function main() {
  executionReporter.message("Starting...");

  // Read parameters passed by the caller
  // Example: const { inputFileId, outputFolderId } = executionParams;

  const components = new OBC.Components();
  executionReporter.message("Components initialized: " + !!components);

  // Do your work here. Use executionReporter to send progress updates.
  // executionReporter.progress(50);
  // executionReporter.message("Processing...");

  executionReporter.progress(100);
  return { type: "SUCCESS", message: "Done" };
}
