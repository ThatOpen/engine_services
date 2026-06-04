// Cloud Component Entry Point
//
// Your component runs on the server as a Node.js process.
// The execution engine provides these globals — do NOT import them:
//
//   thatOpenServices  — pre-authenticated EngineServicesClient
//   executionParams   — parameters passed by the caller (shape defined in ../declarations.json)
//   executionContext  — platform-supplied run context: { projectId?, executionId, toolId, toolVersion }
//                       Use executionContext.projectId to scope uploads/lookups to the launching project.
//                       Undefined when the component is run outside a project context.
//   executionReporter — { message(msg), error(msg), progress(pct) } for live feedback
//
// Parameters are declared in `declarations.json` at the project root. That
// file is bundled alongside this code at publish time so the platform (and
// the CLI's `thatopen run`) knows which parameters the component accepts
// and their types. Whenever you add, remove, or rename a parameter in this
// file you MUST update `declarations.json` to match — `thatopen publish`
// fails if they drift.
//
// Return value — must be { type, message }:
//   type: "SUCCESS" | "FAIL" | "WARNING"

// Globals injected by the execution engine at runtime — keep these for type checking
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const thatOpenServices: import("@thatopen/services").EngineServicesClient;
declare const executionParams: Record<string, unknown>;
declare const executionContext: {
  projectId?: string;
  executionId: string;
  toolId: string;
  toolVersion: string;
};
declare const executionReporter: {
  message(msg: string): void;
  error(msg: string): void;
  progress(pct: number): void;
};

export async function main() {
  const projectName = executionParams.projectName as string | undefined;
  const iterations = Number(executionParams.iterations);

  executionReporter.message(
    `Starting for "${projectName ?? "(unnamed)"}"`,
  );
  executionReporter.message(`Will run ${iterations} iteration(s)`);
  if (executionContext?.projectId) {
    executionReporter.message(`Scoped to project ${executionContext.projectId}`);
  }

  if (!projectName) {
    return { type: "FAIL", message: "projectName parameter is required" };
  }
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return { type: "FAIL", message: "iterations must be a positive number" };
  }

  for (let i = 1; i <= iterations; i++) {
    executionReporter.message(`Iteration ${i} of ${iterations}`);
    executionReporter.progress(Math.round((i / iterations) * 100));
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  executionReporter.message("All iterations completed");

  return {
    type: "SUCCESS",
    message: `Processed "${projectName}" across ${iterations} iteration(s)`,
  };
}
