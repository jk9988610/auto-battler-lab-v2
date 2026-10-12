#!/usr/bin/env node
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const PORT = 4000;
const GAME_PORT = 3000;
const HTML_PATH = path.join(__dirname, "dev.html");

let serverProc = null;
let starting = false;
const logs = [];
const clients = new Set();

function push(line){
const text = String(line).replace(/[\r\n]+$/, "");
if (!text) return;
for (const l of text.split(/\r?\n/)){
if (!l) continue;
logs.push(l);
if (logs.length > 5000) logs.shift();
broadcast({ type: "log", line: l });
}
}

function broadcast(obj){
const msg = "data: " + JSON.stringify(obj) + "\n\n";
for (const c of clients){
try { c.write(msg); } catch(e){}
}
}

function pushState(){
broadcast({ type: "state", running: !!serverProc });
}

async function killPort(port){
if (process.platform === "win32"){
let out = "";
try { out = execSync("netstat -ano", { encoding: "utf8" }); } catch(e){ return; }
const pids = new Set();
for (const line of out.split(/\r?\n/)){
if (!line.includes(":" + port + " ")) continue;
if (!line.includes("LISTENING")) continue;
const m = line.trim().match(/\s(\d+)\s*$/);
if (m && m[1] !== "0") pids.add(m[1]);
}
for (const pid of pids){
try { execSync("taskkill /F /PID " + pid, { stdio: "ignore" }); } catch(e){}
}
} else {
try { execSync("lsof -ti:" + port + " | xargs -r kill -9", { stdio: "ignore" }); } catch(e){}
}
await new Promise(r => setTimeout(r, 400));
}

function pipeOut(proc, tag){
const handle = d => {
const s = d.toString();
for (const l of s.split(/\r?\n/)){
if (l) push("[" + tag + "] " + l);
}
};
proc.stdout.on("data", handle);
proc.stderr.on("data", handle);
}

async function startServer(){
if (serverProc){ push("[dev] 服务器已在运行"); return; }
if (starting){ push("[dev] 正在启动中"); return; }
starting = true;
push("[dev] 清理端口 " + GAME_PORT);
await killPort(GAME_PORT);
push("[dev] 启动 dev 服务器 ...");
const proc = spawn("npm --prefix apps/server run dev", { cwd: ROOT, shell: true });
serverProc = proc;
pipeOut(proc, "server");
proc.on("exit", (code) => {
push("[dev] 服务器退出 code=" + code);
serverProc = null;
starting = false;
pushState();
});
proc.on("error", (e) => {
push("[dev] 启动失败: " + e.message);
serverProc = null;
starting = false;
pushState();
});
starting = false;
pushState();
}

async function stopServer(){
push("[dev] 停止服务器 ...");
if (serverProc){
try { serverProc.kill(); } catch(e){}
serverProc = null;
}
await killPort(GAME_PORT);
pushState();
}

async function restartServer(){
await stopServer();
await startServer();
}

function runProc(cmdline, tag){
return new Promise((resolve) => {
push("[dev] 执行 " + tag);
const proc = spawn(cmdline, { cwd: ROOT, shell: true });
pipeOut(proc, tag);
proc.on("exit", (code) => {
push("[dev] " + tag + " 结束 code=" + code);
resolve(code);
});
proc.on("error", (e) => {
push("[dev] " + tag + " 错误: " + e.message);
resolve(-1);
});
});
}

function runE2E(){ return runProc("node apps/server/scripts/e2e.mjs", "e2e"); }
function runTriple(){ return runProc("node apps/server/scripts/e2e.mjs --triple", "triple"); }
function runTypecheck(){ return runProc("npm --prefix apps/server run typecheck", "typecheck"); }

function applyHeredoc(text){
const re = /<<<FILE:\s*([^\s]+)(?:\s+eol=(lf|crlf|auto))?\s*\r?\n([\s\S]*?)\r?\nFILE>>>/g;
const results = [];
let m;
while ((m = re.exec(text)) !== null){
const rel = m[1];
const eol = m[2] || "auto";
const content = m[3];
const full = path.resolve(ROOT, rel);
if (!full.startsWith(ROOT + path.sep) && full !== ROOT){
results.push({ ok: false, path: rel, error: "越界路径" });
continue;
}
fs.mkdirSync(path.dirname(full), { recursive: true });
let out = content;
if (eol === "lf") out = content.replace(/\r\n/g, "\n");
else if (eol === "crlf") out = content.replace(/\r?\n/g, "\r\n");
fs.writeFileSync(full, out, "utf8");
results.push({ ok: true, path: rel, bytes: Buffer.byteLength(out, "utf8") });
}
return results;
}

function readBody(req){
return new Promise(resolve => {
let buf = "";
req.on("data", c => { buf += c; if (buf.length > 5_000_000) req.destroy(); });
req.on("end", () => resolve(buf));
});
}

const server = http.createServer(async (req, res) => {
const p = (req.url || "/").split("?")[0];

if (p === "/" || p === "/index.html"){
try {
const html = fs.readFileSync(HTML_PATH, "utf8");
res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
res.end(html);
} catch(e){
res.writeHead(500);
res.end("dev.html missing: " + e.message);
}
return;
}
if (p === "/api/stream"){
res.writeHead(200, {
"Content-Type": "text/event-stream",
"Cache-Control": "no-cache",
"Connection": "keep-alive",
});
res.write(":\n\n");
clients.add(res);
req.on("close", () => clients.delete(res));
return;
}
if (p === "/api/logs"){
res.writeHead(200, { "Content-Type": "application/json" });
res.end(JSON.stringify({ logs }));
return;
}
if (p === "/api/state"){
res.writeHead(200, { "Content-Type": "application/json" });
res.end(JSON.stringify({ running: !!serverProc }));
return;
}
if (req.method === "POST"){
if (p === "/api/start"){ startServer(); res.end("ok"); return; }
if (p === "/api/stop"){ stopServer(); res.end("ok"); return; }
if (p === "/api/restart"){ restartServer(); res.end("ok"); return; }
if (p === "/api/e2e"){ runE2E(); res.end("ok"); return; }
if (p === "/api/triple"){ runTriple(); res.end("ok"); return; }
if (p === "/api/typecheck"){ runTypecheck(); res.end("ok"); return; }
if (p === "/api/clear"){ logs.length = 0; res.end("ok"); return; }
if (p === "/api/apply"){
const body = await readBody(req);
const results = applyHeredoc(body);
results.forEach(r => {
if (r.ok) push("[apply] OK " + r.path + " (" + r.bytes + " bytes)");
else push("[apply] FAIL " + r.path + " " + r.error);
});
res.writeHead(200, { "Content-Type": "application/json" });
res.end(JSON.stringify({ results }));
return;
}
}
res.writeHead(404);
res.end("not found");
});

server.listen(PORT, () => {
console.log("[dev] http://localhost:" + PORT);
try {
if (process.platform === "win32"){
execSync('start "" http://localhost:' + PORT, { stdio: "ignore" });
}
} catch(e){}
startServer();
});

process.on("SIGINT", async () => {
if (serverProc){ try { serverProc.kill(); } catch(e){} }
await killPort(GAME_PORT);
process.exit(0);
});

process.on("SIGTERM", async () => {
if (serverProc){ try { serverProc.kill(); } catch(e){} }
await killPort(GAME_PORT);
process.exit(0);
});
