// ESLint configuration for CI (`npm run lint`).
//
// The rules are deliberately a small, high-signal set rather than a style guide.
// They exist because of one bug class that the test suites could not catch:
// code that was never executed until a scheduler fired in production.
//
//   • netlify/functions/api.mjs caught an error and read an undefined `status`
//     in the same catch — every API failure returned a 500 from a crash inside
//     the error handler.
//   • netlify/functions/push-send.mjs referenced four variables that were out of
//     scope, so every run with a subscription threw after sending notifications;
//     alert state was never persisted and the same pushes repeated every 15 min.
//
// Both are `no-undef`, and both shipped because nothing ran the files. ESLint
// with these rules would have failed the pull request that introduced them.
//
// Style is not enforced here. The project has its own voice and a formatter's
// opinion about it is not worth arguing with in a build.
import globals from "globals";

// Node's own globals cover the runtime; `globals.nodeBuiltin` leaves `fetch` and
// friends out, so use the full set for server code (Netlify's Node 24 has them).
const server = {
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    globals: { ...globals.node },
  },
};

const offered = {
  "no-undef": "error",
  "no-dupe-args": "error",
  "no-dupe-keys": "error",
  "no-func-assign": "error",
  "no-const-assign": "error",
  "no-self-assign": "error",
  "no-unreachable": "error",
  "no-unsafe-negation": "error",
  "use-isnan": "error",
  "valid-typeof": "error",
};

export default [
  {
    // Generated output, vendored code and the browser client are not ours to
    // lint here: site/ is served as-is (its modules share globals through the
    // page, which a per-file linter cannot model), and the production bugs this
    // config exists for all lived in the function and script layer.
    ignores: ["node_modules/**", ".netlify/**", "site/**", "**/*.min.js"],
  },
  {
    ...server,
    files: ["**/*.mjs", "**/*.js", "**/*.cjs"],
    rules: offered,
  },
];
