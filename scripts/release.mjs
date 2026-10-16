// One step for every change: bump the patch version, build the web app (live at once through nginx)
// and the signed APK, and publish it to /projects/mobile_builds/h_chat. Web and Android never drift apart.
//   npm run release            0.3.3 -> 0.3.4
//   npm run release -- minor   0.3.3 -> 0.4.0   (a new milestone)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const [major, minor, patch] = pkg.version.split(".").map(Number);
const next = process.argv[2] === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;

execFileSync("npx", ["vitest", "run"], { cwd: root, stdio: "inherit" });
pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`Releasing ${next}`);
execFileSync("node", [join(root, "scripts/build-apk.mjs")], { cwd: root, stdio: "inherit" });
