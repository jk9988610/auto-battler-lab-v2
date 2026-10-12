// patch-known-cmds.cjs
// 扩展 _try_parse_shell_lines 的命令白名单
// 幂等：检测 known-cmds-v1

const fs = require('fs');
const path = require('path');
const root = __dirname;
const P = path.join(root, 'devtool.py');

if (!fs.existsSync(P)) { console.error('devtool.py not found'); process.exit(1); }
const raw = fs.readFileSync(P, 'utf8');
if (raw.includes('known-cmds-v1')) { console.log('already patched'); process.exit(0); }

const eol = raw.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
let src = raw;

const oldBlock = [
  '        known = {"npm", "npx", "node", "python", "python3", "py", "git",',
  '                 "dir", "type", "findstr", "echo", "del", "copy", "move",',
  '                 "mkdir", "rmdir", "cd", "chdir", "powershell", "cmd",',
  '                 "where", "taskkill", "cls", "attrib", "ren", "rename",',
  '                 "start", "call", "set"}',
].join(eol);

const newBlock = [
  '        known = {"npm", "npx", "node", "python", "python3", "py", "git",  # known-cmds-v1',
  '                 "dir", "type", "findstr", "echo", "del", "copy", "move",',
  '                 "mkdir", "rmdir", "cd", "chdir", "powershell", "cmd",',
  '                 "where", "taskkill", "cls", "attrib", "ren", "rename",',
  '                 "start", "call", "set",',
  '                 "pnpm", "yarn", "bun", "tsc", "vite", "tsx", "deno",',
  '                 "curl", "wget", "ping", "ipconfig", "netstat", "nslookup",',
  '                 "tar", "zip", "unzip", "7z", "xcopy", "robocopy",',
  '                 "which", "cat", "ls", "grep", "find", "sed", "awk",',
  '                 "docker", "kubectl", "cargo", "rustc", "go", "make",',
  '                 "pip", "pip3", "poetry", "uv", "conda",',
  '                 "gh", "glab", "svn", "hg", "nest", "next", "ng"}',
].join(eol);

if (src.indexOf(oldBlock) < 0) { console.error('known block not found'); process.exit(1); }
src = src.replace(oldBlock, newBlock);
console.log('expanded known list');

fs.writeFileSync(P, src, 'utf8');
console.log('done: patch-known-cmds');
