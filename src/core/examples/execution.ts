// description: "Cloud component execution — trigger, track progress via WebSocket, list, get, and abort executions."
import { config } from 'dotenv';
import { resolve } from 'path';
import { EngineServicesClient } from '../client';

config({ path: resolve(__dirname, '.env') });

const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const API_URL = process.env.API_URL;
const PROJECT_ID = process.env.PROJECT_ID;

// Required: a published cloud component ID.
// Obtain it from `listComponents()` or from the platform dashboard.
// Set it as COMPONENT_ID in src/core/examples/.env.
const COMPONENT_ID = process.env.COMPONENT_ID;

if (!ACCESS_TOKEN || !API_URL) {
  throw new Error('ACCESS_TOKEN and API_URL are required in src/core/examples/.env');
}

if (!COMPONENT_ID) {
  throw new Error(
    'COMPONENT_ID is required to run execution.ts.\n' +
    'Get it from `npx tsx src/core/examples/components.ts` once you have a published component,\n' +
    'or from the platform dashboard. Set it as COMPONENT_ID in src/core/examples/.env.',
  );
}

async function main() {
  const client = new EngineServicesClient(ACCESS_TOKEN!, API_URL!);

  // --- Execute ---
  // Pass projectId in executionParams to scope the execution to a project.
  // The backend validates that the component is linked to that project — a foreign projectId returns 403.
  // Omit projectId for personal (ownership) executions.
  const { executionId } = await client.executeComponent(
    COMPONENT_ID!,
    { ...(PROJECT_ID && { projectId: PROJECT_ID }) },
  );
  console.log(`\nStarted execution: [${executionId}]`);

  // --- Track progress via WebSocket ---
  // onExecutionProgress fires on each progress event until the execution completes.
  // The socket is not automatically closed — the callback receives a final event when done.
  await new Promise<void>((resolve) => {
    client.onExecutionProgress(executionId, (data) => {
      if (data.progressUpdate) {
        console.log(`  progress: ${data.progressUpdate.progress}%`);
        if (data.progressUpdate.result) {
          console.log(`  result: ${data.progressUpdate.result}`, data.progressUpdate.resultMessage ?? '');
          resolve();
        }
      }
      if (data.messageUpdate) {
        console.log(`  message: ${data.messageUpdate.content}`);
      }
    });
  });

  // --- Get execution detail ---
  const execution = await client.getExecution(executionId);
  console.log('\nExecution detail:');
  console.log(JSON.stringify(execution, null, 2));

  // --- List executions for the component ---
  const executions = await client.listExecutions(COMPONENT_ID!);
  console.log(`\nTotal executions for component: ${executions.length}`);

  // --- Abort (demonstrates the API — only useful on long-running executions) ---
  // abortExecution on an already-completed execution is a no-op on most backends.
  // In production, call it before the WebSocket resolves to cancel a running execution.
  console.log('\n(Skipping abortExecution — execution already completed.)');
}

main().catch(console.error);
