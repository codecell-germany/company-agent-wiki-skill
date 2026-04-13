import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: false,
  external: ["better-sqlite3"]
};

await build({
  ...common,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  banner: {
    js: "#!/usr/bin/env node"
  }
});

await build({
  ...common,
  entryPoints: ["src/installer.ts"],
  outfile: "dist/installer.js",
  banner: {
    js: "#!/usr/bin/env node"
  }
});

