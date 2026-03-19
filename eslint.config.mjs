import globals from "globals";
import tseslint from "typescript-eslint";


export default [
  { ignores: ["coverage/", "public/", "dist/", "src/cli/templates/**/dist/"] },
  { languageOptions: { globals: globals.browser } },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
];