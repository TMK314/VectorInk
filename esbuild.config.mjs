import esbuild from "esbuild";
import process from "process";

const buildOptions = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: false,
  outfile: "main.js",
};

const production = process.argv.includes("production");

try {
  if (production) {
    await esbuild.build({
      ...buildOptions,
      minify: true,
    });
    console.log("✅ Production build complete");
  } else {
    const ctx = await esbuild.context({
      ...buildOptions,
      minify: false,
    });
    await ctx.watch();
    console.log("👀 Watching for changes...");
  }
} catch (e) {
  console.error("❌ Build failed:", e);
  process.exit(1);
}