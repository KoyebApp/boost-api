import { readFileSync, writeFileSync, existsSync, renameSync } from "fs";
import { join, resolve } from "path";

const pkgDir = resolve("node_modules/kinetex");
if (!existsSync(join(pkgDir, "package.json"))) process.exit(0);

const pkgJson = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const candidates = [
  pkgJson.exports?.["."]?.workerd, pkgJson.exports?.["."]?.worker,
  pkgJson.exports?.["."]?.import, pkgJson.exports?.["."],
  pkgJson.module, pkgJson.main
].flatMap(val => (val && typeof val === 'object' ? Object.values(val) : val))
 .filter(c => typeof c === 'string' && !c.endsWith(".d.ts"));

let entry = null;
for (const c of candidates) {
  const p = join(pkgDir, c);
  if (existsSync(p)) { entry = p; break; }
}

// Prevent double-patching if the real file already exists
if (!entry || entry.includes("index.real.js")) process.exit(0);

const entryDir = resolve(entry, "..");
const entryFileName = entry.split('/').pop();
const realFileName = entryFileName.replace(/\.(m?)js$/, ".real.$1js");
const realPath = join(entryDir, realFileName);

// 1. Move original to .real.js
if (!existsSync(realPath)) {
  renameSync(entry, realPath);
}

// 2. Create the Proxy Wrapper that RE-EXPORTS everything
const proxyCode = `/* kinetex-cf-patched */
import * as RealModule from "./${realFileName}";

// Re-export EVERYTHING (auth, create, errors, etc.)
export * from "./${realFileName}";

let __kx__;
const getKx = () => {
  if (!__kx__) {
    // Access the default export or the named 'kinetex' export from the real module
    __kx__ = RealModule.default || RealModule.kinetex;
  }
  return __kx__;
};

// The lazy proxy for the default export
const __kx_proxy__ = new Proxy(function(){}, {
  get(_, prop) {
    const target = getKx();
    return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
  },
  apply(_, thisArg, args) {
    return getKx()(...args);
  }
});

export default __kx_proxy__;
// If they import { kinetex }, give them the proxy too
export const kinetex = __kx_proxy__;
`;

writeFileSync(entry, proxyCode, "utf8");
console.log("[patch-kinetex] Wrapper created with all exports preserved.");
