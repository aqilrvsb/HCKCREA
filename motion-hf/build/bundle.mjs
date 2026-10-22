// Bundle the Laju v2 browser runtime: the Laju compositions from motion/src
// (written for Remotion) compiled against the Preact shim. One IIFE file,
// dist/runtime.js, that every Laju v2 page loads.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const shim = (f) => path.join(root, "shim", f);

// "@remotion/google-fonts/PermanentMarker" → loadFont() returning its family
// (the page declares the faces; HyperFrames resolves / embeds them)
const FAMILY = { PermanentMarker: "Permanent Marker", PatrickHand: "Patrick Hand", ArchivoBlack: "Archivo Black", Inter: "Inter", Montserrat: "Montserrat" };
const lajuShims = {
  name: "laju-shims",
  setup(b) {
    b.onResolve({ filter: /^@remotion\/google-fonts\/.+$/ }, (a) => ({ path: a.path.split("/").pop(), namespace: "gfont" }));
    b.onLoad({ filter: /.*/, namespace: "gfont" }, (a) => ({
      contents: `export const loadFont = () => ({ fontFamily: ${JSON.stringify(FAMILY[a.path] || a.path.replace(/([a-z])([A-Z])/g, "$1 $2"))}, waitUntilDone: () => Promise.resolve() });`,
      loader: "js",
    }));
    // motion/src/emoji.tsx loads Lottie JSON asynchronously (delayRender); the
    // Laju v2 build reads the page's preload synchronously instead
    b.onResolve({ filter: /^\.\/emoji$/ }, (a) =>
      a.importer.replace(/\\/g, "/").includes("/motion/src/") ? { path: path.join(root, "overrides", "emoji.tsx") } : undefined);
  },
};

const common = {
  bundle: true,
  sourcemap: false,
  jsx: "transform",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  loader: { ".tsx": "tsx", ".ts": "ts", ".json": "json" },
  nodePaths: [path.join(root, "node_modules")],
  plugins: [lajuShims],
  logLevel: "info",
};
const aliases = {
  react: "preact/compat",
  "react-dom": "preact/compat",
  "react/jsx-runtime": "preact/jsx-runtime",
  remotion: shim("remotion.js"),
  "@remotion/transitions": shim("transitions.js"),
  "@remotion/transitions/wipe": shim("transitions.js"),
  "@remotion/transitions/clock-wipe": shim("transitions.js"),
  "@remotion/transitions/iris": shim("transitions.js"),
  "@remotion/transitions/slide": shim("transitions.js"),
  "@remotion/transitions/flip": shim("transitions.js"),
  "@remotion/noise": shim("noise.js"),
  "@remotion/rounded-text-box": shim("rounded-text-box.js"),
  "@remotion/lottie": shim("lottie.js"),
};

// Node-side media planner (build/laju-page.mjs imports it)
await build({
  ...common,
  entryPoints: [path.join(root, "runtime", "planner.js")],
  format: "esm",
  platform: "node",
  target: ["node20"],
  outfile: path.join(root, "dist", "planner.mjs"),
  alias: { ...aliases, "@remotion/lottie": shim("lottie-node.js") },
});

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
  nodePaths: [path.join(root, "node_modules")],
  plugins: [lajuShims],
  alias: {
    react: "preact/compat",
    "react-dom": "preact/compat",
    "react/jsx-runtime": "preact/jsx-runtime",
    remotion: shim("remotion.js"),
    "@remotion/transitions": shim("transitions.js"),
    "@remotion/transitions/wipe": shim("transitions.js"),
    "@remotion/transitions/clock-wipe": shim("transitions.js"),
    "@remotion/transitions/iris": shim("transitions.js"),
    "@remotion/transitions/slide": shim("transitions.js"),
    "@remotion/transitions/flip": shim("transitions.js"),
    "@remotion/noise": shim("noise.js"),
    "@remotion/rounded-text-box": shim("rounded-text-box.js"),
    "@remotion/lottie": shim("lottie.js"),
  },
  logLevel: "info",
});

// The CLIPPER Studio's live preview (Next.js serves it from public/clipper-preview/): the same MotionEditPro,
// drawn in the client's browser over the clip's own <video>. Rebuild it whenever the compositions change
// (node build/bundle.mjs) and commit public/clipper-preview/preview.js with them.
await build({
  entryPoints: [path.join(root, "runtime", "preview.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome110", "safari16"],
  outfile: path.join(root, "..", "public", "clipper-preview", "preview.js"),
  minify: true,
  sourcemap: false,
  jsx: "transform",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  loader: { ".tsx": "tsx", ".ts": "ts", ".json": "json" },
  nodePaths: [path.join(root, "node_modules")],
  plugins: [lajuShims],
  alias: {
    react: "preact/compat",
    "react-dom": "preact/compat",
    "react/jsx-runtime": "preact/jsx-runtime",
    remotion: shim("remotion.js"),
    "@remotion/transitions": shim("transitions.js"),
    "@remotion/transitions/wipe": shim("transitions.js"),
    "@remotion/transitions/clock-wipe": shim("transitions.js"),
    "@remotion/transitions/iris": shim("transitions.js"),
    "@remotion/transitions/slide": shim("transitions.js"),
    "@remotion/transitions/flip": shim("transitions.js"),
    "@remotion/noise": shim("noise.js"),
    "@remotion/rounded-text-box": shim("rounded-text-box.js"),
    "@remotion/lottie": shim("lottie.js"),
  },
  logLevel: "info",
});
