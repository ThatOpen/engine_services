/**
 * Generates a tsconfig.json for local template development inside the
 * engine_services monorepo. This file is git-ignored and must NOT be
 * included when scaffolding a project — it only exists to fix TypeScript's
 * duplicate-package resolution caused by local symlinks (e.g. @thatopen/services
 * pointing to the workspace root via `file:../../../..`).
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const templates = [
  resolve(__dirname, "../src/cli/templates/bim"),
];

const tsconfig = {
  compilerOptions: {
    target: "ES2020",
    module: "ESNext",
    moduleResolution: "bundler",
    strict: true,
    preserveSymlinks: true,
    paths: {
      "@thatopen/components": [
        "./node_modules/@thatopen/components/dist/index.d.ts",
      ],
      "@thatopen/components/*": ["./node_modules/@thatopen/components/*"],
      "@thatopen/ui": ["./node_modules/@thatopen/ui/dist/index.d.ts"],
      "@thatopen/ui/*": ["./node_modules/@thatopen/ui/*"],
    },
  },
  include: ["src"],
};

for (const dir of templates) {
  const dest = resolve(dir, "tsconfig.json");
  writeFileSync(dest, JSON.stringify(tsconfig, null, 2) + "\n");
  console.log(`Generated ${dest}`);
}
