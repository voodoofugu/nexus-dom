import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import del from "rollup-plugin-delete";

export const external = (id) => /^nexus-state(?:\/|$)/.test(id);
const isDevBuild = process.env.NEXUS_DOM_BUILD === "development";

export const createPlugins = ({ clean = false, minify = true } = {}) => [
  ...(clean ? [del({ targets: "dist/*" })] : []),
  resolve(),
  commonjs(),
  typescript({ tsconfig: "./tsconfig.bundle.json" }),
  ...(minify
    ? [
        terser({
          ecma: 2020,
          compress: {
            ecma: 2020,
            passes: 2,
            pure_funcs: ["console.log", "console.debug", "console.info"],
          },
          mangle: { toplevel: true },
          format: { ecma: 2020, comments: false },
        }),
      ]
    : []),
];

const input = {
  index: "./src/index.ts",
  "jsx-runtime": "./src/jsx-runtime.ts",
  "jsx-dev-runtime": "./src/jsx-dev-runtime.ts",
  server: "./src/server.ts",
};

const output = (dir, format) => ({
  dir,
  format,
  entryFileNames: "[name].js",
  chunkFileNames: "chunks/[name]-[hash].js",
  generatedCode: "es2015",
  exports: "named",
});

export default [
  {
    input,
    output: output("dist/esm", "esm"),
    plugins: createPlugins({ clean: true, minify: !isDevBuild }),
    external,
  },
  {
    input,
    output: output("dist/cjs", "cjs"),
    plugins: createPlugins({ minify: !isDevBuild }),
    external,
  },
];
