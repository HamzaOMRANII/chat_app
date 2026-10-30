#!/usr/bin/env node
// Builds a signed release APK and publishes it to /projects/mobile_builds/h_chat:
//   h_chat-<version>.apk   every version (the newest KEEP are kept)
//   h_chat.apk             copy of the newest (linked from the login page)
//   latest.json            version info read by the web app and the APK's update check
//
// Usage: npm run build:apk -- --notes "What changed"
// The version comes from package.json ("version"); bump it before building a new release.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const KEEP = 5;
const root = resolve(import.meta.dirname, "..");
const outDir = process.env.MOBILE_BUILDS_DIR ?? "/projects/mobile_builds/h_chat";
const notesIndex = process.argv.indexOf("--notes");
const notes = notesIndex > -1 ? process.argv[notesIndex + 1] : undefined;

const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const [major, minor, patch] = version.split(".").map(Number);
const versionCode = major * 10000 + minor * 100 + patch;

if (!existsSync(join(root, "android/keystore.properties"))) {
  throw new Error("android/keystore.properties is missing: the release cannot be signed.");
}

const env = { ...process.env, ANDROID_HOME: process.env.ANDROID_HOME ?? "/opt/android-sdk" };
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, env, stdio: "inherit" });

run("npm", ["run", "build"]);
run("npx", ["cap", "sync", "android"]);
run("./gradlew", ["--no-daemon", "-q", "assembleRelease", `-PhchatVersionCode=${versionCode}`, `-PhchatVersionName=${version}`], join(root, "android"));

const built = join(root, "android/app/build/outputs/apk/release/app-release.apk");
const apksigner = join(env.ANDROID_HOME, "build-tools/36.0.0/apksigner");
execFileSync(apksigner, ["verify", built], { stdio: "inherit" });

const file = `h_chat-${version}.apk`;
copyFileSync(built, join(outDir, file));
copyFileSync(built, join(outDir, "h_chat.apk.tmp"));
renameSync(join(outDir, "h_chat.apk.tmp"), join(outDir, "h_chat.apk"));

const bytes = readFileSync(built);
const latest = {
  version,
  versionCode,
  file,
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  date: new Date().toISOString(),
  ...(notes ? { notes } : {}),
};
writeFileSync(join(outDir, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);

const versions = readdirSync(outDir)
  .filter((f) => /^h_chat-\d+\.\d+\.\d+\.apk$/.test(f))
  .sort((a, b) => statSync(join(outDir, b)).mtimeMs - statSync(join(outDir, a)).mtimeMs);
for (const old of versions.slice(KEEP)) unlinkSync(join(outDir, old));

console.log(`\nPublished ${file} (${Math.round(bytes.length / 1024)} KB) to ${outDir}`);
