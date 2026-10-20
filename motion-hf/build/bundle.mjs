// Bundle the Laju v2 browser runtime: the Laju compositions from motion/src
// (written for Remotion) compiled against the Preact shim. One IIFE file,
// dist/runtime.js, that every Laju v2 page loads.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const shim = (f) => path.join(root, "shim", f);

await build({
  entryPoints: [path.join(root, "runtime", "entry.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  outfile: path.join(root, "dist", "runtime.js"),
  minify: process.argv.includes("--minify"),
  sourcemap: false,
  jsx: "transform",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  loader: { ".tsx": "tsx", ".ts": "ts", ".json": "json" },
  // the Laju sources import React + Remotion; resolve both to the shim, and
  // their own deps (preact, gsap…) from motion-hf/node_modules
  nodePaths: [path.join(root, "node_modules")],
  alias: {
    react: "preact/compat",
    "react-dom": "preact/compat",
    "react/jsx-runtime": "preact/jsx-runtime",
    remotion: shim("remotion.js"),
  },
  logLevel: "info",
});
