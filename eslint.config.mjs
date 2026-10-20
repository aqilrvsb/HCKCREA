import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Remotion renderer — own package, built into the Modal image.
    "motion/**",
    // Laju v2: the Motion compositions on HyperFrames — own package, built into the Modal image.
    "motion-hf/**",
    // VGC engine starter — built into the Modal image (modal_vgc.py).
    "vgc-template/**",
    // runs inside the VGC vault page (uploaded by scripts/vgc-sync.mjs), not the app
    "vgc-bridge/**",
  ]),
]);

export default eslintConfig;
