/**
 * Controller returned by each toolbar mode-tool setup (`clipper`,
 * `lengthMeasurement`, `areaMeasurement`, …). The toolbar — owned by Worker 2 —
 * calls {@link activate} to enter the tool's mode and {@link deactivate} to exit
 * it, and guarantees only one mode is active at a time (mutual exclusion).
 *
 * Contract:
 *  - `activate()`   — enable the tool's pointer/keyboard listeners + cursor.
 *  - `deactivate()` — remove those listeners and drop any transient in-progress
 *                     state. It must NOT discard finished results (e.g. existing
 *                     section planes / measurements persist across mode switches).
 *  Both are idempotent.
 */
export interface ModeTool {
  /** Human label, used for the toolbar button tooltip. */
  label: string;
  /** Iconify icon name, e.g. "mdi:scissors-cutting". */
  icon: string;
  /** Enter the tool's mode. */
  activate(): void;
  /** Exit the tool's mode and clean up transient state. */
  deactivate(): void;
}
