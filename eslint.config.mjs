import js from "@eslint/js";
import globals from "globals";

const commonRules = {
  ...js.configs.recommended.rules,
  "no-unused-vars": [
    "error",
    {
      args: "after-used",
      argsIgnorePattern: "^_",
      caughtErrors: "all",
      caughtErrorsIgnorePattern: "^_",
      varsIgnorePattern: "^_"
    }
  ]
};

export default [
  {
    ignores: ["artifacts/**", "dist/**", "node_modules/**"]
  },
  {
    files: ["apps/planner-web/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: globals.browser
    },
    rules: commonRules
  },
  {
    files: ["tests/**/*.cjs", "tests/*.cjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: globals.node
    },
    rules: commonRules
  }
];
