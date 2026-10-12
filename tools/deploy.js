#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const HOST = process.env.DEPLOY_HOST || "8.133.252.224";
const USER = process.env.DEPLOY_USER || "root";
const ROOT = path.resolve(__dirname, "..");
const LOCAL_TAR = path.join(ROOT, "ab-deploy.tgz");
const REMOTE_TMP = "/tmp/ab-deploy.tgz";
const REMOTE_DIR = "/var/www/auto-battler-lab";

function run(cmd, opts){
  console.log("[deploy] > " + cmd);
  const r = spawnSync(cmd, { shell: true, stdio: "inherit", cwd: ROOT, ...(opts || {}) });
  if (r.status !== 0){
    console.error("[deploy] 失败 code=" + r.status + ": " + cmd);
    process.exit(1);
  }
}

console.log("[deploy] 目标 " + USER + "@" + HOST + ":" + REMOTE_DIR);
console.log("");

console.log("[deploy] [1/3] 打包 ...");
if (fs.existsSync(LOCAL_TAR)) fs.unlinkSync(LOCAL_TAR);
const tarCmd = [
  "tar -czf ab-deploy.tgz",
  "--exclude=node_modules",
  "--exclude=data",
  "--exclude=dist",
  "--exclude=.env",
  "apps/server/src",
  "apps/server/public",
  "apps/server/scripts",
  "apps/server/package.json",
  "apps/server/package-lock.json",
  "apps/server/tsconfig.json"
].join(" ");
run(tarCmd);
const size = (fs.statSync(LOCAL_TAR).size / 1024).toFixed(1);
console.log("[deploy]      tar = ab-deploy.tgz (" + size + " KB)");
console.log("");

console.log("[deploy] [2/3] 上传 ...");
run("scp ab-deploy.tgz " + USER + "@" + HOST + ":" + REMOTE_TMP);
console.log("");

console.log("[deploy] [3/3] 远端解压 + 重启 ...");
const remoteCmd = [
  "cd " + REMOTE_DIR,
  "tar -xzf " + REMOTE_TMP,
  "rm -f " + REMOTE_TMP,
  "cd apps/server",
  "npm install --no-audit --no-fund",
  "pm2 restart ab --update-env",
  "sleep 2",
  "pm2 logs ab --lines 15 --nostream"
].join(" && ");
run("ssh " + USER + "@" + HOST + " \"" + remoteCmd + "\"");

console.log("");
console.log("[deploy] ✅ 完成");
console.log("[deploy] 浏览器打开: https://ab.bykc.click/");