import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ---------------------------------------------------------------------------
// Hexagonal layering guard (see docs/architecture.md, "Layering rules").
//
// Flat config REPLACES rule options when several blocks match a file, so the
// more specific blocks below repeat the shared restrictions they still need.
// Regex patterns only match our own paths (`@/...`, `./...`, `../...`), so
// third-party specifiers such as `@trpc/server/adapters/fetch` stay allowed.
// ---------------------------------------------------------------------------

const ext = "{ts,tsx,mts,cts,js,jsx,mjs}";
const OWN_PATH = String.raw`^(@/|(\.\./)+|\./)`;

const restrict = {
  adapters: {
    regex: String.raw`${OWN_PATH}adapters(/|$)`,
    message:
      "Adapters are wired only in src/composition-root.ts. Depend on a port from @/shared/ports instead.",
  },
  compositionRoot: {
    regex: String.raw`${OWN_PATH}composition-root(\.[cm]?[jt]sx?)?$`,
    message:
      "Only routes and UI resolve dependencies from the composition root. Receive ports as parameters instead.",
  },
  next: {
    regex: String.raw`^next(/|$)`,
    message: "Domain and application code must stay framework-free (no Next.js).",
  },
  react: {
    regex: String.raw`^react(-dom)?(/|$)`,
    message: "Domain code must stay framework-free (no React).",
  },
  anthropic: {
    regex: String.raw`^@anthropic-ai/`,
    message: "SDKs belong in adapters. Depend on the LLM port instead.",
  },
  supabase: {
    regex: String.raw`^@supabase/`,
    message: "SDKs belong in adapters. Depend on a repository port instead.",
  },
  appAndComponents: {
    regex: String.raw`^(@/|(\.\./)+)(app|components)(/|$)`,
    message: "Adapters must not depend on routes or UI components.",
  },
  uiLayers: {
    regex: String.raw`${OWN_PATH}(.+/)?ui(/|$)`,
    message: "Adapters must not depend on UI layers.",
  },
};

const noRestrictedImports = (...patterns) => ({
  "no-restricted-imports": ["error", { patterns }],
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    name: "radar/no-adapters-outside-composition-root",
    files: [`src/**/*.${ext}`],
    ignores: ["src/adapters/**", "src/composition-root.ts"],
    rules: noRestrictedImports(restrict.adapters),
  },
  {
    name: "radar/application-and-ports",
    files: [
      `src/modules/**/application/**/*.${ext}`,
      `src/shared/ports/**/*.${ext}`,
    ],
    rules: noRestrictedImports(
      restrict.adapters,
      restrict.compositionRoot,
      restrict.next,
      restrict.anthropic,
      restrict.supabase,
    ),
  },
  {
    name: "radar/pure-domain",
    files: [`src/modules/**/domain/**/*.${ext}`, `src/shared/domain/**/*.${ext}`],
    rules: noRestrictedImports(
      restrict.adapters,
      restrict.compositionRoot,
      restrict.next,
      restrict.react,
      restrict.anthropic,
      restrict.supabase,
    ),
  },
  {
    name: "radar/adapters-stay-outside-ui",
    files: [`src/adapters/**/*.${ext}`],
    rules: noRestrictedImports(
      restrict.appAndComponents,
      restrict.uiLayers,
      restrict.compositionRoot,
    ),
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
  ]),
]);

export default eslintConfig;
