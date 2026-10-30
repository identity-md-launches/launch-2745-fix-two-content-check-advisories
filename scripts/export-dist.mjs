// Copies the Next.js static export (out/) to dist/ with relative asset URLs, so the site works at an
// IPFS gateway subpath (https://gateway/ipfs/<cid>/) as well as at the root of an ENS name.
// Run after `npm run build`:  node scripts/export-dist.mjs
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "out");
const dist = join(root, "dist");
if (!existsSync(join(out, "index.html"))) {
  console.error("out/index.html is missing: run `npm run build` first.");
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
cpSync(out, dist, { recursive: true });

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });

let changed = 0;
for (const file of files(dist)) {
  const rel = relative(dist, file);
  const depth = rel.split(sep).length - 1;
  let text;
  if (/\.(html|txt)$/.test(file)) {
    // Pages and RSC payloads: "/_next/..." becomes "./_next/..." (or "../_next/..." one folder down).
    const prefix = depth === 0 ? "./" : "../".repeat(depth);
    text = readFileSync(file, "utf8").replace(/(["'(]|\\")\/_next\//g, `$1${prefix}_next/`);
  } else if (file.endsWith(".css")) {
    // Stylesheets live in _next/static/css/: fonts are in the sibling _next/static/media/.
    text = readFileSync(file, "utf8").replace(/url\(\/_next\/static\//g, "url(../");
  } else if (/[\\/]webpack-[^\\/]+\.js$/.test(file)) {
    // Webpack's public path: derive "<site>/_next/" from this runtime script's own URL.
    const src = readFileSync(file, "utf8");
    const runtime =
      '((document.currentScript&&document.currentScript.src||"").replace(/static\\/chunks\\/webpack-[^/]*$/,"")||"./_next/")';
    text = src.replace('.p="/_next/"', `.p=${runtime}`);
    if (text === src) throw new Error(`public path not found in ${rel}`);
  } else continue;
  if (/["'(]\/_next\//.test(text)) throw new Error(`absolute /_next/ URL left in ${rel}`);
  writeFileSync(file, text);
  changed++;
}
console.log(`dist/ written from out/ (${changed} files rewritten to relative URLs)`);
