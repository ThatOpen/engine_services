/**
 * Generates the local execution engine script.
 *
 * Mirrors the server-side `v1/thatOpenEngine.js` template:
 * - Provides the same globals (OBC, THREE, WEBIFC, fs, executionReporter,
 *   thatOpenServices, executionParams).
 * - Inlines the IIFE bundle code (which ends with `var main = ...`).
 * - Calls `main()` and sends the result back via IPC.
 */
export function buildEngineScript(
  bundleCode: string,
  accessToken: string,
  apiUrl: string,
  executionParams: object,
): string {
  return `/* eslint-disable */
const { EngineServicesClient } = require('thatopen-services');

const OBC = require('@thatopen/components');
const THREE = require('three');
let WEBIFC; try { WEBIFC = require('web-ifc'); } catch {}
const fs = require('fs');

const executionReporter = {
  message: (message) => {
    process.send({ type: 'MESSAGE', message });
  },
  progress: (message) => {
    process.send({ type: 'PROGRESS', message });
  },
};

let thatOpenServices, executionParams;

// --- User bundle code (IIFE) ---
${bundleCode}
// --- End user bundle code ---

if (typeof main !== 'function') {
  process.send({ type: 'FAIL', message: 'Bundle does not export a main() function' });
  process.exit(1);
}

const executeAndReportProcess = async (newThatOpenServices, newExecutionParams) => {
  thatOpenServices = newThatOpenServices;
  executionParams = newExecutionParams;

  try {
    const result = await main();
    if (!result) {
      process.send({
        type: 'WARNING',
        message: 'No result returned from main function of the component',
      });
      return;
    }
    process.send(result);
  } catch (error) {
    process.send({
      type: 'FAIL',
      message: error.message,
    });
  }
};

// Start execution immediately
const thatOpenServicesInstance = new EngineServicesClient(
  ${JSON.stringify(accessToken)},
  ${JSON.stringify(apiUrl)},
);

executeAndReportProcess(thatOpenServicesInstance, ${JSON.stringify(executionParams)});
`;
}
