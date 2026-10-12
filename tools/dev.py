#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""工作台"""

import os
import re
import sys
import json
import queue
import threading
import subprocess
import tkinter as tk
from tkinter import scrolledtext

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("PYTHONUTF8", "1")
os.environ.setdefault("PYTHONLEGACYWINDOWSSTDIO", "0")

GAME_PORT = 3000
FONT_MONO = ("Consolas", 10)

DEPLOY_HOST = "8.133.252.224"
DEPLOY_USER = "root"
DEPLOY_REMOTE = "/var/www/auto-battler-lab"
ONLINE_URL = "https://ab.bykc.click"

_START = "<" * 3 + "FILE:"
_END = "FILE" + ">" * 3
HEREDOC_RE = re.compile(
    re.escape(_START) + r"\s*([^\s]+)(?:\s+eol=(lf|crlf|auto))?\s*\r?\n([\s\S]*?)\r?\n" + re.escape(_END)
)

log_queue = queue.Queue()


def kill_port(port):
    try:
        if sys.platform == "win32":
            out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True,
                                 encoding="utf-8", errors="replace").stdout
            pids = set()
            for line in out.splitlines():
                s = line.strip()
                if (":" + str(port) + " ") in s and "LISTENING" in s:
                    m = re.search(r"\s(\d+)\s*$", s)
                    if m and m.group(1) != "0":
                        pids.add(m.group(1))
            for pid in pids:
                subprocess.run(["taskkill", "/F", "/PID", pid], capture_output=True)
        else:
            subprocess.run("lsof -ti:" + str(port) + " | xargs -r kill -9",
                           shell=True, capture_output=True)
    except Exception as e:
        log_queue.put("[err] kill_port: " + str(e))


def normalize_eol(content, eol):
    if eol == "lf":
        return content.replace("\r\n", "\n")
    if eol == "crlf":
        return re.sub(r"\r?\n", "\r\n", content)
    return content


class ButtonFlow(tk.Frame):
    def __init__(self, parent, specs, bg="#0d0d0f"):
        super().__init__(parent, bg=bg)
        self.specs = specs
        self._last_width = 0
        self.bind("<Configure>", self._on_resize)
        self.after(80, self._relayout)

    def _on_resize(self, event):
        if abs(event.width - self._last_width) < 12:
            return
        self._last_width = event.width
        self.after_idle(self._relayout)

    def _make_btn(self, parent, spec):
        b = tk.Button(
            parent,
            text=spec["text"],
            command=spec["cmd"],
            bg=spec.get("bg", "#1c1c20"),
            fg=spec.get("fg", "#e6e6e6"),
            activebackground="#2a2a30",
            activeforeground="#fff",
            relief="flat",
            padx=10, pady=4,
            cursor="hand2",
        )
        if spec.get("font"):
            b.configure(font=spec["font"])
        return b

    def _relayout(self):
        for w in self.winfo_children():
            w.destroy()

        max_w = self.winfo_width()
        if max_w < 300:
            max_w = 1200

        widths = []
        for spec in self.specs:
            b = self._make_btn(self, spec)
            b.update_idletasks()
            widths.append(b.winfo_reqwidth() + 8)
            b.destroy()

        rows = []
        row = []
        row_w = 0
        for i, w in enumerate(widths):
            if row and row_w + w > max_w:
                rows.append(row)
                row = []
                row_w = 0
            row.append(i)
            row_w += w
        if row:
            rows.append(row)

        for row_idxs in rows:
            f = tk.Frame(self, bg=self.cget("bg"))
            f.pack(fill=tk.X, pady=1)
            for i in row_idxs:
                spec = self.specs[i]
                b = self._make_btn(f, spec)
                b.pack(side=tk.LEFT, padx=2)


class App:
    def __init__(self, root):
        self.root = root
        self.server_proc = None
        self.server_lock = threading.Lock()

        root.title("工作台")
        root.geometry("1100x820")
        root.minsize(420, 500)
        root.configure(bg="#0d0d0f")

        top = tk.Frame(root, bg="#0d0d0f")
        top.pack(fill=tk.X, padx=8, pady=(6, 2))
        tk.Label(top, text="工作台", fg="#c8a15a", bg="#0d0d0f",
                 font=("Microsoft YaHei UI", 11, "bold")).pack(side=tk.LEFT)
        self.status_label = tk.Label(top, text="服务器: 未知", fg="#888", bg="#0d0d0f")
        self.status_label.pack(side=tk.RIGHT)

        specs = [
            {"text": "启动服务器", "cmd": self.start_server, "bg": "#2d5a2d", "fg": "#d6ffd6"},
            {"text": "停止", "cmd": self.stop_server, "bg": "#5a2d2d", "fg": "#ffd6d6"},
            {"text": "重启", "cmd": self.restart_server},
            {"text": "typecheck", "cmd": lambda: self.run_short("npm --prefix apps/server run typecheck", "typecheck")},
            {"text": "跑 e2e", "cmd": lambda: self.run_short("node apps/server/scripts/e2e.mjs", "e2e")},
            {"text": "一键三连", "cmd": lambda: self.run_short("node apps/server/scripts/e2e.mjs --triple", "triple")},
            {"text": "\U0001F310 线上 e2e", "cmd": lambda: self.run_short("set URL=" + ONLINE_URL + "&& node apps/server/scripts/e2e.mjs", "online"), "bg": "#3d5a5a", "fg": "#a6e0e0"},
            {"text": "🌐 线上全测", "cmd": lambda: self.run_short("set URL=" + ONLINE_URL + "&& node apps/server/scripts/e2e.mjs --full", "online"), "bg": "#3d5a5a", "fg": "#a6e0e0"},
            {"text": "本地全测", "cmd": lambda: self.run_short("node apps/server/scripts/e2e.mjs --full", "full"), "bg": "#3d5a5a", "fg": "#a6e0e0"},
            {"text": "\U0001F4BE git 提交", "cmd": self.git_commit, "bg": "#2d4d5a", "fg": "#a6d8ff"},
            {"text": "\U0001F680 部署到线上", "cmd": self.deploy_online, "bg": "#5a3d2d", "fg": "#ffd6a6"},
            {"text": "清日志", "cmd": self.clear_logs},
            {"text": "复制日志", "cmd": self.copy_logs},
        ]
        self.btn_flow = ButtonFlow(root, specs, bg="#0d0d0f")
        self.btn_flow.pack(fill=tk.X, padx=8, pady=(2, 6))

        tk.Label(root, text="指令区（可手动粘贴，或点下方「📋 从剪贴板运行」自动填入并执行）：",
                 anchor="w", fg="#c8a15a", bg="#0d0d0f").pack(fill=tk.X, padx=8, pady=(4, 0))

        self.input_box = scrolledtext.ScrolledText(
            root, height=10, font=FONT_MONO,
            bg="#050507", fg="#c8a15a", insertbackground="#c8a15a",
            relief="flat", highlightthickness=1, highlightbackground="#1e1e22")
        self.input_box.pack(fill=tk.BOTH, expand=False, padx=8, pady=4)

        actions = tk.Frame(root, bg="#0d0d0f")
        actions.pack(fill=tk.X, padx=8)

        run_btn = tk.Button(actions, text="▶ 运行脚本", command=self.smart_run,
                            bg="#3d7d3d", fg="#fff", activebackground="#4d8d4d",
                            relief="flat", padx=16, pady=6, cursor="hand2",
                            font=("Microsoft YaHei UI", 11, "bold"))
        run_btn.pack(side=tk.LEFT, padx=2, pady=4)

        paste_btn = tk.Button(actions, text="📋 从剪贴板运行", command=self.run_from_clipboard,
                              bg="#3d5d7d", fg="#fff", activebackground="#4d6d8d",
                              relief="flat", padx=16, pady=6, cursor="hand2",
                              font=("Microsoft YaHei UI", 11, "bold"))
        paste_btn.pack(side=tk.LEFT, padx=2, pady=4)

        actions2 = tk.Frame(root, bg="#0d0d0f")
        actions2.pack(fill=tk.X, padx=8)

        self.auto_copy = tk.BooleanVar(value=True)
        tk.Checkbutton(actions2, text="执行后自动复制输出到剪贴板",
                       variable=self.auto_copy, bg="#0d0d0f", fg="#aaa",
                       activebackground="#0d0d0f", selectcolor="#1c1c20",
                       highlightthickness=0).pack(side=tk.LEFT, pady=2)

        self.apply_msg = tk.Label(actions2, text="", fg="#8cf", bg="#0d0d0f")
        self.apply_msg.pack(side=tk.LEFT, padx=8)

        tk.Label(root, text="输出：", anchor="w", fg="#c8a15a", bg="#0d0d0f").pack(
            fill=tk.X, padx=8, pady=(6, 0))

        self.output_box = scrolledtext.ScrolledText(
            root, height=20, font=FONT_MONO,
            bg="#050507", fg="#7fd67f", insertbackground="#7fd67f",
            relief="flat", highlightthickness=1, highlightbackground="#1e1e22")
        self.output_box.pack(fill=tk.BOTH, expand=True, padx=8, pady=4)

        self._poll_logs()
        self.root.after(300, self.start_server)
        self.root.after(700, self.load_clipboard_to_input)

    def _poll_logs(self):
        try:
            while True:
                line = log_queue.get_nowait()
                tag = None
                if line.startswith("[err]") or "FAIL" in line or "ERROR" in line or "code=-" in line:
                    tag = "err"
                elif line.startswith("[apply]") or line.startswith("[read]") or line.startswith("[deploy]") or line.startswith("[git]"):
                    tag = "apply"
                elif "PASS" in line or "listening" in line or "code=0" in line or "\u2705" in line:
                    tag = "ok"
                elif line.startswith("[dev]"):
                    tag = "dev"
                self.output_box.insert(tk.END, line + "\n", tag)
        except queue.Empty:
            pass
        self.output_box.tag_config("err", foreground="#e88")
        self.output_box.tag_config("ok", foreground="#7fd67f")
        self.output_box.tag_config("dev", foreground="#666")
        self.output_box.tag_config("apply", foreground="#8cf")
        self.output_box.see(tk.END)
        self.root.after(80, self._poll_logs)

    def clear_logs(self):
        self.output_box.delete("1.0", tk.END)

    def copy_logs(self):
        text = self.output_box.get("1.0", tk.END)
        self.root.clipboard_clear()
        self.root.clipboard_append(text)
        n = len(text.splitlines())
        self.apply_msg.config(text="已复制 " + str(n) + " 行")
        self.root.after(2000, lambda: self.apply_msg.config(text=""))

    def read_clipboard(self):
        try:
            return self.root.clipboard_get()
        except tk.TclError:
            return ""

    def load_clipboard_to_input(self):
        text = self.read_clipboard()
        if text and not self.input_box.get("1.0", tk.END).strip():
            self.input_box.delete("1.0", tk.END)
            self.input_box.insert("1.0", text)
            self.apply_msg.config(text="已从剪贴板载入")
            self.root.after(2000, lambda: self.apply_msg.config(text=""))

    def run_from_clipboard(self):
        text = self.read_clipboard()
        if not text.strip():
            self.apply_msg.config(text="剪贴板为空")
            return
        self.input_box.delete("1.0", tk.END)
        self.input_box.insert("1.0", text)
        self.apply_msg.config(text="剪贴板已载入，执行中...")
        self.root.after(150, self.smart_run)

    def _update_status(self, running):
        def do():
            if running:
                self.status_label.config(text="服务器: 运行中", fg="#7fd67f")
            else:
                self.status_label.config(text="服务器: 已停止", fg="#c66")
        self.root.after(0, do)

    def start_server(self):
        with self.server_lock:
            if self.server_proc and self.server_proc.poll() is None:
                log_queue.put("[dev] 服务器已在运行")
                return
            log_queue.put("[dev] 清理端口 " + str(GAME_PORT))
            kill_port(GAME_PORT)
            log_queue.put("[dev] 启动 dev 服务器 ...")
            try:
                self.server_proc = subprocess.Popen(
                    "chcp 65001 >nul && npm --prefix apps/server run dev",
                    cwd=ROOT, shell=True,
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, encoding="utf-8", errors="replace",
                    bufsize=1,
                )
            except Exception as e:
                log_queue.put("[err] 启动失败: " + str(e))
                return
            threading.Thread(target=self._stream_server, daemon=True).start()
            self._update_status(True)

    def _stream_server(self):
        proc = self.server_proc
        try:
            for line in proc.stdout:
                log_queue.put("[server] " + line.rstrip())
        except Exception as e:
            log_queue.put("[err] 读取服务器输出: " + str(e))
        proc.wait()
        log_queue.put("[dev] 服务器退出 code=" + str(proc.returncode))
        self.server_proc = None
        self._update_status(False)

    def stop_server(self):
        with self.server_lock:
            if self.server_proc:
                log_queue.put("[dev] 停止服务器 ...")
                try:
                    self.server_proc.terminate()
                except Exception:
                    pass
                self.server_proc = None
            kill_port(GAME_PORT)
            self._update_status(False)

    def restart_server(self):
        self.stop_server()
        self.root.after(600, self.start_server)

    def run_short(self, cmdline, tag):
        def worker():
            log_queue.put("[dev] 执行 " + tag)
            try:
                proc = subprocess.Popen(
                    "chcp 65001 >nul && " + cmdline, cwd=ROOT, shell=True,
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, encoding="utf-8", errors="replace", bufsize=1)
            except Exception as e:
                log_queue.put("[err] " + str(e))
                return
            for line in proc.stdout:
                log_queue.put("[" + tag + "] " + line.rstrip())
            proc.wait()
            log_queue.put("[dev] " + tag + " 结束 code=" + str(proc.returncode))
            if self.auto_copy.get():
                self.root.after(150, self.copy_logs)
        threading.Thread(target=worker, daemon=True).start()

    def deploy_online(self):
        if getattr(self, "_deploying", False):
            log_queue.put("[deploy] 已有部署在跑，忽略本次点击")
            return
        self._deploying = True
        self.apply_msg.config(text="部署中...")
        threading.Thread(target=self._deploy_worker, daemon=True).start()
        self.root.after(120000, self._unlock_deploy)

    def _unlock_deploy(self):
        if getattr(self, "_deploying", False):
            self._deploying = False
            self.apply_msg.config(text="")
            log_queue.put("[deploy] 超时自动解锁")

    def _deploy_worker(self):
        def run_capture(cmdline, tag):
            log_queue.put("[deploy] $ " + cmdline)
            try:
                proc = subprocess.Popen(
                    "chcp 65001 >nul && " + cmdline, cwd=ROOT, shell=True,
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, encoding="utf-8", errors="replace", bufsize=1)
            except Exception as e:
                log_queue.put("[err] " + str(e))
                return -1
            for line in proc.stdout:
                log_queue.put("[" + tag + "] " + line.rstrip())
            proc.wait()
            return proc.returncode

        try:
            log_queue.put("[deploy] 目标 " + DEPLOY_USER + "@" + DEPLOY_HOST + ":" + DEPLOY_REMOTE)
            log_queue.put("")

            log_queue.put("[deploy] [1/3] 打包 ...")
            tar_file = os.path.join(ROOT, "ab-deploy.tgz")
            if os.path.exists(tar_file):
                os.remove(tar_file)
            tar_cmd = (
                "tar -czf ab-deploy.tgz "
                "--exclude=node_modules --exclude=data --exclude=dist --exclude=.env "
                "apps/server/src apps/server/public apps/server/scripts "
                "apps/server/package.json apps/server/package-lock.json apps/server/tsconfig.json"
            )
            rc = run_capture(tar_cmd, "deploy")
            if rc != 0:
                log_queue.put("[deploy] 打包失败 code=" + str(rc))
                return
            size = os.path.getsize(tar_file) / 1024.0
            log_queue.put("[deploy] tar = ab-deploy.tgz (" + str(round(size, 1)) + " KB)")
            log_queue.put("")

            log_queue.put("[deploy] [2/3] 上传 ...")
            scp_cmd = "scp ab-deploy.tgz " + DEPLOY_USER + "@" + DEPLOY_HOST + ":/tmp/ab-deploy.tgz"
            rc = run_capture(scp_cmd, "deploy")
            if rc != 0:
                log_queue.put("[deploy] 上传失败 code=" + str(rc))
                return
            log_queue.put("")

            log_queue.put("[deploy] [3/3] 远端解压 + 重启 ...")
            remote_cmd = (
                "cd " + DEPLOY_REMOTE + " && "
                "tar -xzf /tmp/ab-deploy.tgz && "
                "rm -f /tmp/ab-deploy.tgz && "
                "cd apps/server && "
                "npm install --no-audit --no-fund && "
                "pm2 restart ab --update-env && "
                "sleep 2 && "
                "pm2 logs ab --lines 15 --nostream"
            )
            ssh_cmd = 'ssh ' + DEPLOY_USER + "@" + DEPLOY_HOST + ' "' + remote_cmd + '"'
            rc = run_capture(ssh_cmd, "deploy")
            if rc != 0:
                log_queue.put("[deploy] 部署失败 code=" + str(rc))
                return

            log_queue.put("")
            log_queue.put("[deploy] \u2705 完成 " + ONLINE_URL + "/")

            def done():
                self._deploying = False
                self.apply_msg.config(text="部署完成")
                self.root.after(3000, lambda: self.apply_msg.config(text=""))
                if self.auto_copy.get():
                    self.copy_logs()
            self.root.after(100, done)
        except Exception as e:
            self._deploying = False
            self.root.after(0, lambda: self.apply_msg.config(text="部署失败"))
            log_queue.put("[err] deploy: " + str(e))

    def git_commit(self):
        threading.Thread(target=self._git_commit_worker, daemon=True).start()

    def _git_commit_worker(self):
        import datetime
        msg = "chore: auto commit " + datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        def run_step(cmdline):
            log_queue.put("[git] $ " + cmdline)
            try:
                proc = subprocess.Popen(
                    "chcp 65001 >nul && " + cmdline, cwd=ROOT, shell=True,
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, encoding="utf-8", errors="replace", bufsize=1)
            except Exception as e:
                log_queue.put("[err] " + str(e))
                return -1
            for line in proc.stdout:
                log_queue.put("[git] " + line.rstrip())
            proc.wait()
            return proc.returncode

        try:
            if run_step("git add -A") != 0:
                log_queue.put("[git] add 失败")
                return
            run_step("git status --short")
            rc = run_step('git commit -m "' + msg + '"')
            if rc != 0:
                log_queue.put("[git] commit 返回 " + str(rc) + "（可能无变更）")
            run_step("git log --oneline -5")
            log_queue.put("[git] OK")
            if self.auto_copy.get():
                self.root.after(200, self.copy_logs)
        except Exception as e:
            log_queue.put("[err] git: " + str(e))

    def smart_run(self):
        text = self.input_box.get("1.0", tk.END)
        if not text.strip():
            self.apply_msg.config(text="空内容")
            return
        self.apply_msg.config(text="执行中...")
        threading.Thread(target=self._smart_run_worker, args=(text,), daemon=True).start()

    def _smart_run_worker(self, text):
        try:
            # ---- 优先识别：脚本名（宽松版） ----
            lines = [l.strip() for l in text.splitlines() if l.strip()]
            script_name = None
            if len(lines) == 1:
                cand = lines[0]
                if cand.startswith("python "):
                    cand = cand[7:].strip()
                if cand.endswith(".py") and " " not in cand:
                    # 如果没写路径，优先 tools/ 下的同名文件
                    if "/" not in cand and "\\" not in cand:
                        cand2 = "tools/" + cand
                        if os.path.exists(os.path.join(ROOT, cand2)):
                            cand = cand2
                    script_name = cand
            if script_name:
                log_queue.put("[run] python " + script_name)
                proc = subprocess.Popen(
                    "chcp 65001 >nul && python " + script_name,
                    cwd=ROOT, shell=True,
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, encoding="utf-8", errors="replace", bufsize=1)
                for line in proc.stdout:
                    log_queue.put("[run] " + line.rstrip())
                proc.wait()
                log_queue.put("[run] 结束 code=" + str(proc.returncode))
                self.root.after(0, lambda: self.input_box.delete("1.0", tk.END))
                if self.auto_copy.get():
                    self.root.after(300, self.copy_logs)
                return

            heredocs = HEREDOC_RE.findall(text)
            if heredocs:
                results = []
                for rel, eol, content in heredocs:
                    full = os.path.abspath(os.path.join(ROOT, rel))
                    if not full.startswith(ROOT + os.sep) and full != ROOT:
                        results.append("FAIL " + rel + " 越界路径")
                        continue
                    try:
                        os.makedirs(os.path.dirname(full), exist_ok=True)
                        out = normalize_eol(content, eol or "auto")
                        with open(full, "w", encoding="utf-8", newline="") as f:
                            f.write(out)
                        results.append("OK " + rel + " (" + str(len(out.encode("utf-8"))) + " bytes)")
                    except Exception as e:
                        results.append("FAIL " + rel + " " + str(e))
                for r in results:
                    log_queue.put("[apply] " + r)
                self.root.after(0, lambda: self.apply_msg.config(
                    text="完成 " + str(len(results)) + " 项"))
                self.root.after(0, lambda: self.input_box.delete("1.0", tk.END))
                if self.auto_copy.get():
                    self.root.after(300, self.copy_logs)
                return

            stripped = text.strip()
            if stripped.startswith("[") and stripped.endswith("]"):
                try:
                    ops = json.loads(stripped)
                    self._run_json_ops(ops)
                    self.root.after(0, lambda: self.input_box.delete("1.0", tk.END))
                    if self.auto_copy.get():
                        self.root.after(300, self.copy_logs)
                    return
                except Exception as e:
                    log_queue.put("[err] JSON 解析失败: " + str(e))
                    return

            log_queue.put("[shell] 执行 " + str(len(stripped.splitlines())) + " 行")
            proc = subprocess.Popen("chcp 65001 >nul && " + stripped, cwd=ROOT, shell=True,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, encoding="utf-8", errors="replace", bufsize=1)
            for line in proc.stdout:
                log_queue.put("[shell] " + line.rstrip())
            proc.wait()
            log_queue.put("[shell] 结束 code=" + str(proc.returncode))
            self.root.after(0, lambda: self.input_box.delete("1.0", tk.END))
            if self.auto_copy.get():
                self.root.after(300, self.copy_logs)
        except Exception as e:
            log_queue.put("[err] smart_run: " + str(e))

    def _run_json_ops(self, ops):
        for op in ops:
            kind = op.get("op")
            try:
                if kind == "write":
                    p = os.path.abspath(os.path.join(ROOT, op["path"]))
                    os.makedirs(os.path.dirname(p), exist_ok=True)
                    content = normalize_eol(op.get("content", ""), op.get("eol", "auto"))
                    with open(p, "w", encoding="utf-8", newline="") as f:
                        f.write(content)
                    log_queue.put("[apply] OK " + op["path"])
                elif kind == "append":
                    p = os.path.abspath(os.path.join(ROOT, op["path"]))
                    os.makedirs(os.path.dirname(p), exist_ok=True)
                    with open(p, "a", encoding="utf-8", newline="") as f:
                        f.write(op.get("content", ""))
                    log_queue.put("[apply] APPEND " + op["path"])
                elif kind == "delete":
                    p = os.path.abspath(os.path.join(ROOT, op["path"]))
                    if os.path.exists(p):
                        os.remove(p)
                        log_queue.put("[apply] DELETE " + op["path"])
                elif kind == "mkdir":
                    p = os.path.abspath(os.path.join(ROOT, op["path"]))
                    os.makedirs(p, exist_ok=True)
                    log_queue.put("[apply] MKDIR " + op["path"])
                elif kind == "read":
                    p = os.path.abspath(os.path.join(ROOT, op["path"]))
                    with open(p, "r", encoding="utf-8", errors="replace") as f:
                        content = f.read()
                    log_queue.put("[read] " + op["path"] + " (" + str(len(content)) + " chars)")
                    lines = content.splitlines()
                    limit = op.get("lines")
                    if limit and len(limit) == 2:
                        lines = lines[limit[0]:limit[1]]
                    for l in lines[:80]:
                        log_queue.put("[read]   " + l)
                    if len(lines) > 80:
                        log_queue.put("[read]   ... (" + str(len(lines) - 80) + " more)")
                elif kind == "shell":
                    cmd = op.get("cmd", "")
                    log_queue.put("[shell] $ " + cmd)
                    proc = subprocess.Popen("chcp 65001 >nul && " + cmd, cwd=ROOT, shell=True,
                                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                            text=True, encoding="utf-8", errors="replace")
                    out, _ = proc.communicate()
                    for line in out.splitlines():
                        log_queue.put("[shell] " + line)
                    log_queue.put("[shell] exit " + str(proc.returncode))
                else:
                    log_queue.put("[apply] 未知 op: " + str(kind))
            except Exception as e:
                log_queue.put("[apply] FAIL " + str(kind) + " " + str(op.get("path", "")) + ": " + str(e))


def main():
    root = tk.Tk()
    app = App(root)
    root.mainloop()


if __name__ == "__main__":
    main()