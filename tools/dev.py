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
import tkinter.font as tkfont
from tkinter import scrolledtext

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("PYTHONUTF8", "1")
os.environ.setdefault("PYTHONLEGACYWINDOWSSTDIO", "0")

GAME_PORT = 3000
FONT_MONO = ("Consolas", 10)

DEFAULT_CFG = {
    "geometry": "1100x820",
    "title": "\u5de5\u4f5c\u53f0",
    "header_text": "\u5de5\u4f5c\u53f0",
    "input_label": "\u8f93\u5165\uff1a",
    "output_label": "\u8f93\u51fa\uff1a",
    "run_btn_text": "\u25b6 \u8fd0\u884c\u811a\u672c",
    "paste_btn_text": "\U0001F4CB \u4ece\u526a\u8d34\u677f\u8fd0\u884c",
    "font_ui": "Microsoft YaHei UI",
    "size_ui": 11,
    "font_in": "Consolas",
    "size_in": 10,
    "font_out": "Consolas",
    "size_out": 10,
    "height_in": 10,
    "height_out": 20,
    "btn_style": "default",
}

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
    def __init__(self, parent, specs, bg="#0d0d0f", btn_style="default"):
        super().__init__(parent, bg=bg)
        self.specs = specs
        self.btn_style = btn_style
        self._last_width = 0
        self.bind("<Configure>", self._on_resize)
        self.after(80, self._relayout)

    def _on_resize(self, event):
        if abs(event.width - self._last_width) < 12:
            return
        self._last_width = event.width
        self.after_idle(self._relayout)

    def _make_btn(self, parent, spec):
        if getattr(self, "btn_style", "default") == "gray":
            bg = "#2a2a2a"
            fg = "#d0d0d0"
        else:
            bg = spec.get("bg", "#1c1c20")
            fg = spec.get("fg", "#e6e6e6")
        b = tk.Button(
            parent,
            text=spec["text"],
            command=spec["cmd"],
            bg=bg,
            fg=fg,
            activebackground="#3a3a3a" if getattr(self, "btn_style", "default") == "gray" else "#2a2a30",
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

        self.cfg = self._load_cfg()
        self._apply_global_font()
        root.title(self.cfg.get("title", "工作台"))
        self._load_geometry(root)
        root.minsize(420, 500)
        root.protocol("WM_DELETE_WINDOW", self._on_close)
        root.configure(bg="#0d0d0f")

        top = tk.Frame(root, bg="#0d0d0f")
        top.pack(fill=tk.X, padx=8, pady=(6, 2))
        tk.Label(top, text=self.cfg.get("header_text", "工作台"), fg="#c8a15a", bg="#0d0d0f",
                 font=(self.cfg.get("font_ui", "Microsoft YaHei UI"), self.cfg.get("size_ui", 11), "bold")).pack(side=tk.LEFT)
        self.status_label = tk.Label(top, text="服务器: 未知", fg="#888", bg="#0d0d0f")
        self.status_label.pack(side=tk.RIGHT)

        specs = [
            {"text": "启动服务器", "cmd": self.start_server, "bg": "#2d5a2d", "fg": "#d6ffd6"},
            {"text": "停止", "cmd": self.stop_server, "bg": "#5a2d2d", "fg": "#ffd6d6"},
            {"text": "重启", "cmd": self.restart_server},
            {"text": "typecheck", "cmd": lambda: self.run_short("npm --prefix apps/server run typecheck", "typecheck")},
            {"text": "跑 e2e", "cmd": lambda: self.run_short("node apps/server/scripts/e2e.mjs", "e2e")},
            {"text": "一键三连", "cmd": lambda: self.run_short("node apps/server/scripts/e2e.mjs --triple", "triple")},
            {"text": "线上 e2e", "cmd": lambda: self.run_short("set URL=" + ONLINE_URL + "&& node apps/server/scripts/e2e.mjs", "online"), "bg": "#3d5a5a", "fg": "#a6e0e0"},
            {"text": "线上全测", "cmd": lambda: self.run_short("set URL=" + ONLINE_URL + "&& node apps/server/scripts/e2e.mjs --full", "online"), "bg": "#3d5a5a", "fg": "#a6e0e0"},
            {"text": "本地全测", "cmd": lambda: self.run_short("node apps/server/scripts/e2e.mjs --full", "full"), "bg": "#3d5a5a", "fg": "#a6e0e0"},
            {"text": "git 提交", "cmd": self.git_commit, "bg": "#2d4d5a", "fg": "#a6d8ff"},
            {"text": "部署到线上", "cmd": self.deploy_online, "bg": "#5a3d2d", "fg": "#ffd6a6"},
            {"text": "清日志", "cmd": self.clear_logs},
            {"text": "复制日志", "cmd": self.copy_logs},
            {"text": "设置", "cmd": self._open_settings, "bg": "#4d3d5a", "fg": "#d8c8ff"},
        ]
        self.btn_flow = ButtonFlow(root, specs, bg="#0d0d0f", btn_style=self.cfg.get("btn_style", "default"))
        self.btn_flow.pack(fill=tk.X, padx=8, pady=(2, 6))

        tk.Label(root, text=self.cfg.get("input_label", "输入："),
                 anchor="w", fg="#c8a15a", bg="#0d0d0f").pack(fill=tk.X, padx=8, pady=(4, 0))

        self.input_box = scrolledtext.ScrolledText(
            root, height=self.cfg.get("height_in", 10),
            font=(self.cfg.get("font_in", "Consolas"), self.cfg.get("size_in", 10)),
            bg="#050507", fg="#c8a15a", insertbackground="#c8a15a",
            relief="flat", highlightthickness=1, highlightbackground="#1e1e22")
        self.input_box.pack(fill=tk.BOTH, expand=False, padx=8, pady=4)
        self._hide_scrollbar(self.input_box)

        actions = tk.Frame(root, bg="#0d0d0f")
        actions.pack(fill=tk.X, padx=8)

        run_btn = tk.Button(actions, text=self.cfg.get("run_btn_text", "运行脚本"), command=self.smart_run,
                            bg="#3d7d3d", fg="#fff", activebackground="#4d8d4d",
                            relief="flat", padx=16, pady=6, cursor="hand2",
                            font=(self.cfg.get("font_ui", "Microsoft YaHei UI"), self.cfg.get("size_ui", 11), "bold"))
        run_btn.pack(side=tk.LEFT, padx=2, pady=4)

        paste_btn = tk.Button(actions, text=self.cfg.get("paste_btn_text", "从剪贴板运行"), command=self.run_from_clipboard,
                              bg="#3d5d7d", fg="#fff", activebackground="#4d6d8d",
                              relief="flat", padx=16, pady=6, cursor="hand2",
                              font=(self.cfg.get("font_ui", "Microsoft YaHei UI"), self.cfg.get("size_ui", 11), "bold"))
        paste_btn.pack(side=tk.LEFT, padx=2, pady=4)

        actions2 = tk.Frame(root, bg="#0d0d0f")
        actions2.pack(fill=tk.X, padx=8)

        self.auto_copy = tk.BooleanVar(value=True)
        tk.Checkbutton(actions2, text="执行后自动复制输出到剪贴板",
                       variable=self.auto_copy, bg="#0d0d0f", fg="#aaa",
                       activebackground="#0d0d0f", selectcolor="#1c1c20",
                       highlightthickness=0).pack(side=tk.LEFT, pady=2)

        actions3 = tk.Frame(root, bg="#0d0d0f")
        actions3.pack(fill=tk.X, padx=8)

        self.clear_before = tk.BooleanVar(value=True)
        tk.Checkbutton(actions3, text="每次运行前清空输出框",
                       variable=self.clear_before, bg="#0d0d0f", fg="#aaa",
                       activebackground="#0d0d0f", selectcolor="#1c1c20",
                       highlightthickness=0).pack(side=tk.LEFT, pady=2)

        self.apply_msg = tk.Label(actions2, text="", fg="#8cf", bg="#0d0d0f")
        self.apply_msg.pack(side=tk.LEFT, padx=8)

        tk.Label(root, text=self.cfg.get("output_label", "输出："), anchor="w", fg="#c8a15a", bg="#0d0d0f").pack(
            fill=tk.X, padx=8, pady=(6, 0))

        self.output_box = scrolledtext.ScrolledText(
            root, height=self.cfg.get("height_out", 20),
            font=(self.cfg.get("font_out", "Consolas"), self.cfg.get("size_out", 10)),
            bg="#050507", fg="#7fd67f", insertbackground="#7fd67f",
            relief="flat", highlightthickness=1, highlightbackground="#1e1e22")
        self.output_box.pack(fill=tk.BOTH, expand=True, padx=8, pady=4)
        self._hide_scrollbar(self.output_box)

        self._poll_logs()
        self.root.after(300, self.start_server)
        self.root.after(700, self.load_clipboard_to_input)

    def _apply_global_font(self):
        family = self.cfg.get("font_ui", "Microsoft YaHei UI")
        size = self.cfg.get("size_ui", 11)
        for name in ("TkDefaultFont", "TkTextFont", "TkMenuFont", "TkHeadingFont", "TkCaptionFont", "TkSmallCaptionFont", "TkIconFont", "TkTooltipFont"):
            try:
                tkfont.nametofont(name).configure(family=family, size=size)
            except Exception:
                pass

    def _load_cfg(self):
        cfg = dict(DEFAULT_CFG)
        try:
            with open(self._config_path(), "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                cfg.update(data)
        except Exception:
            pass
        return cfg

    def _save_cfg(self):
        try:
            with open(self._config_path(), "w", encoding="utf-8") as f:
                json.dump(self.cfg, f, ensure_ascii=False, indent=2)
        except Exception as e:
            log_queue.put("[err] save cfg: " + str(e))

    def _open_settings(self):
        if getattr(self, "_settings_win", None) and self._settings_win.winfo_exists():
            self._settings_win.lift()
            return
        win = tk.Toplevel(self.root)
        self._settings_win = win
        win.title("\u8bbe\u7f6e")
        win.configure(bg="#0d0d0f")
        win.geometry("620x700")
        win.transient(self.root)

        # 底部按钮区（固定）
        btns = tk.Frame(win, bg="#0d0d0f")
        btns.pack(side=tk.BOTTOM, fill=tk.X, padx=12, pady=12)
        btns2 = tk.Frame(win, bg="#0d0d0f")
        btns2.pack(side=tk.BOTTOM, fill=tk.X, padx=12, pady=(0, 4))
        msg_label = tk.Label(btns2, text="", fg="#8cf", bg="#0d0d0f")
        msg_label.pack(side=tk.LEFT)

        # 可滚动区域
        scroll_wrap = tk.Frame(win, bg="#0d0d0f")
        scroll_wrap.pack(side=tk.TOP, fill=tk.BOTH, expand=True)
        canvas = tk.Canvas(scroll_wrap, bg="#0d0d0f", highlightthickness=0, bd=0)
        canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        vbar = tk.Scrollbar(scroll_wrap, orient="vertical", command=canvas.yview, width=8)
        vbar.pack(side=tk.RIGHT, fill=tk.Y)
        canvas.configure(yscrollcommand=vbar.set)

        inner = tk.Frame(canvas, bg="#0d0d0f")
        win_id = canvas.create_window((0, 0), window=inner, anchor="nw")

        def _on_inner_config(event):
            canvas.configure(scrollregion=canvas.bbox("all"))
        inner.bind("<Configure>", _on_inner_config)

        def _on_canvas_config(event):
            canvas.itemconfigure(win_id, width=event.width)
        canvas.bind("<Configure>", _on_canvas_config)

        def _on_wheel(event):
            try:
                delta = int(-1 * (event.delta / 120)) if abs(event.delta) >= 120 else (-1 if event.delta > 0 else 1)
            except Exception:
                delta = 0
            canvas.yview_scroll(delta, "units")
        win.bind("<MouseWheel>", _on_wheel)
        canvas.bind("<MouseWheel>", _on_wheel)
        inner.bind("<MouseWheel>", _on_wheel)

        def row(label, key):
            f = tk.Frame(inner, bg="#0d0d0f")
            f.pack(fill=tk.X, padx=12, pady=3)
            tk.Label(f, text=label, fg="#c8a15a", bg="#0d0d0f", width=14, anchor="w").pack(side=tk.LEFT)
            var = tk.StringVar(value=str(self.cfg.get(key, DEFAULT_CFG.get(key, ""))))
            tk.Entry(f, textvariable=var, bg="#0a0a0c", fg="#e6e6e6", insertbackground="#c8a15a",
                     relief="flat", highlightthickness=1, highlightbackground="#2d2d33").pack(
                side=tk.LEFT, fill=tk.X, expand=True)
            return var

        tk.Label(inner, text="\u5de5\u4f5c\u53f0\u8bbe\u7f6e", fg="#c8a15a", bg="#0d0d0f",
                 font=("Microsoft YaHei UI", 13, "bold")).pack(pady=(12, 4))

        tk.Label(inner, text="\u6587\u672c", fg="#888", bg="#0d0d0f", anchor="w").pack(fill=tk.X, padx=12, pady=(10, 0))
        v_title = row("\u7a97\u53e3\u6807\u9898", "title")
        v_header = row("\u9876\u90e8\u6807\u9898", "header_text")
        v_inlabel = row("\u8f93\u5165\u6846\u63d0\u793a", "input_label")
        v_outlabel = row("\u8f93\u51fa\u6846\u63d0\u793a", "output_label")
        v_runbtn = row("\u8fd0\u884c\u6309\u94ae\u6587\u5b57", "run_btn_text")
        v_pastebtn = row("\u526a\u8d34\u677f\u6309\u94ae\u6587\u5b57", "paste_btn_text")

        tk.Label(inner, text="\u5b57\u4f53", fg="#888", bg="#0d0d0f", anchor="w").pack(fill=tk.X, padx=12, pady=(10, 0))
        v_fontui = row("\u754c\u9762\u5b57\u4f53", "font_ui")
        v_sizeui = row("\u754c\u9762\u5b57\u53f7", "size_ui")
        v_fontin = row("\u8f93\u5165\u6846\u5b57\u4f53", "font_in")
        v_sizein = row("\u8f93\u5165\u6846\u5b57\u53f7", "size_in")
        v_fontout = row("\u8f93\u51fa\u6846\u5b57\u4f53", "font_out")
        v_sizeout = row("\u8f93\u51fa\u6846\u5b57\u53f7", "size_out")

        tk.Label(inner, text="\u5e03\u5c40", fg="#888", bg="#0d0d0f", anchor="w").pack(fill=tk.X, padx=12, pady=(10, 0))
        v_hin = row("\u8f93\u5165\u6846\u884c\u6570", "height_in")
        v_hout = row("\u8f93\u51fa\u6846\u884c\u6570", "height_out")

        tk.Label(inner, text="\u6309\u94ae\u98ce\u683c", fg="#888", bg="#0d0d0f", anchor="w").pack(fill=tk.X, padx=12, pady=(10, 0))
        v_style = tk.StringVar(value=self.cfg.get("btn_style", "default"))
        sf = tk.Frame(inner, bg="#0d0d0f")
        sf.pack(fill=tk.X, padx=12, pady=3)
        tk.Radiobutton(sf, text="\u591a\u5f69", variable=v_style, value="default",
                       bg="#0d0d0f", fg="#e6e6e6", selectcolor="#1c1c20",
                       activebackground="#0d0d0f", activeforeground="#c8a15a").pack(side=tk.LEFT)
        tk.Radiobutton(sf, text="\u5168\u7070", variable=v_style, value="gray",
                       bg="#0d0d0f", fg="#e6e6e6", selectcolor="#1c1c20",
                       activebackground="#0d0d0f", activeforeground="#c8a15a").pack(side=tk.LEFT, padx=16)

        tk.Frame(inner, bg="#0d0d0f", height=20).pack()

        def to_int(v, default):
            try:
                return int(v)
            except Exception:
                return default

        def apply():
            self.cfg["title"] = v_title.get()
            self.cfg["header_text"] = v_header.get()
            self.cfg["input_label"] = v_inlabel.get()
            self.cfg["output_label"] = v_outlabel.get()
            self.cfg["run_btn_text"] = v_runbtn.get()
            self.cfg["paste_btn_text"] = v_pastebtn.get()
            self.cfg["font_ui"] = v_fontui.get()
            self.cfg["size_ui"] = to_int(v_sizeui.get(), 11)
            self.cfg["font_in"] = v_fontin.get()
            self.cfg["size_in"] = to_int(v_sizein.get(), 10)
            self.cfg["font_out"] = v_fontout.get()
            self.cfg["size_out"] = to_int(v_sizeout.get(), 10)
            self.cfg["height_in"] = to_int(v_hin.get(), 10)
            self.cfg["height_out"] = to_int(v_hout.get(), 20)
            self.cfg["btn_style"] = v_style.get()
            self._save_cfg()
            msg_label.config(text="\u5df2\u4fdd\u5b58\uff0c\u91cd\u542f\u751f\u6548")
            self.root.after(2500, lambda: msg_label.config(text=""))

        tk.Button(btns, text="\u53d6\u6d88", command=win.destroy, bg="#1c1c20", fg="#e6e6e6",
                  relief="flat", padx=20, pady=6, cursor="hand2").pack(side=tk.RIGHT, padx=4)
        tk.Button(btns, text="\u5e94\u7528", command=apply, bg="#3d7d3d", fg="#fff",
                  relief="flat", padx=20, pady=6, cursor="hand2").pack(side=tk.RIGHT, padx=4)

    def _hide_scrollbar(self, st):
        try:
            if hasattr(st, "vbar") and st.vbar is not None:
                st.vbar.pack_forget()
                try:
                    st.vbar.config(width=0)
                except Exception:
                    pass
                return
            for child in st.master.winfo_children():
                if isinstance(child, tk.Scrollbar):
                    child.pack_forget()
        except Exception:
            pass

    def _config_path(self):
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), ".workbench.json")

    def _load_geometry(self, root):
        default = "1100x820"
        try:
            with open(self._config_path(), "r", encoding="utf-8") as f:
                cfg = json.load(f)
            geo = cfg.get("geometry")
            if isinstance(geo, str) and re.match(r"^\d+x\d+([+-]\d+[+-]\d+)?$", geo):
                root.geometry(geo)
                return
        except Exception:
            pass
        root.geometry(default)

    def _save_geometry(self):
        try:
            st = self.root.state()
            if st == "zoomed":
                return
            self.cfg["geometry"] = self.root.geometry()
            self._save_cfg()
        except Exception:
            pass

    def _on_close(self):
        self._save_geometry()
        try:
            if self.server_proc:
                self.server_proc.terminate()
        except Exception:
            pass
        self.root.destroy()

    def _clear_output_if_needed(self):
        try:
            if self.clear_before.get():
                self.output_box.delete("1.0", tk.END)
        except Exception:
            pass

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
        try:
            y1 = self.output_box.yview()[1]
            if y1 >= 0.999:
                self.output_box.see(tk.END)
        except Exception:
            pass
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
        self._clear_output_if_needed()
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
        self._clear_output_if_needed()
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
        self._open_git_dialog()

    def _open_git_dialog(self):
        if getattr(self, "_git_dlg", None) and self._git_dlg.winfo_exists():
            self._git_dlg.lift()
            return
        import datetime
        win = tk.Toplevel(self.root)
        self._git_dlg = win
        win.title("git \u63d0\u4ea4")
        win.configure(bg="#0d0d0f")
        win.geometry("560x300")
        win.transient(self.root)
        win.grab_set()

        tk.Label(win, text="\u63d0\u4ea4\u4fe1\u606f", fg="#c8a15a", bg="#0d0d0f",
                 font=("Microsoft YaHei UI", 12, "bold")).pack(pady=(14, 6), anchor="w", padx=14)

        clip_msg = (self.read_clipboard() or "").strip()
        if clip_msg and "\n" not in clip_msg and len(clip_msg) <= 200:
            default_msg = clip_msg
        else:
            default_msg = "chore: " + datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        var = tk.StringVar(value=default_msg)
        entry = tk.Entry(win, textvariable=var, bg="#0a0a0c", fg="#e6e6e6",
                         insertbackground="#c8a15a", relief="flat",
                         highlightthickness=1, highlightbackground="#2d2d33",
                         font=(self.cfg.get("font_in", "Consolas"), self.cfg.get("size_in", 10)))
        entry.pack(fill=tk.X, padx=14, pady=(0, 8))
        entry.focus_set()
        try:
            entry.selection_range(0, tk.END)
        except Exception:
            pass

        tk.Label(win, text="\u5feb\u6377\u524d\u7f00", fg="#888", bg="#0d0d0f",
                 anchor="w").pack(fill=tk.X, padx=14, pady=(4, 0))

        prefixes = ["feat", "fix", "chore", "docs", "refactor", "test", "style", "perf"]
        pf = tk.Frame(win, bg="#0d0d0f")
        pf.pack(fill=tk.X, padx=14, pady=(4, 8))

        def set_prefix(p):
            var.set(p + ": ")
            entry.icursor(tk.END)
            entry.focus_set()

        for i, pre in enumerate(prefixes):
            btn = tk.Button(pf, text=pre, command=(lambda p=pre: set_prefix(p)),
                            bg="#1c1c20", fg="#e6e6e6", activebackground="#2a2a30",
                            relief="flat", padx=8, pady=2, cursor="hand2")
            btn.pack(side=tk.LEFT, padx=2, pady=2)

        msg_label = tk.Label(win, text="", fg="#8cf", bg="#0d0d0f")
        msg_label.pack(fill=tk.X, padx=14, pady=(4, 0))

        def do_commit():
            m = var.get().strip()
            if not m:
                msg_label.config(text="\u63d0\u4ea4\u4fe1\u606f\u4e0d\u80fd\u4e3a\u7a7a", fg="#e88")
                return
            self._clear_output_if_needed()
            threading.Thread(target=self._git_commit_worker, args=(m,), daemon=True).start()
            win.destroy()

        def cancel():
            win.destroy()

        btn_row = tk.Frame(win, bg="#0d0d0f")
        btn_row.pack(fill=tk.X, padx=14, pady=(8, 14), side=tk.BOTTOM)
        tk.Button(btn_row, text="\u53d6\u6d88", command=cancel, bg="#1c1c20", fg="#e6e6e6",
                  relief="flat", padx=20, pady=6, cursor="hand2").pack(side=tk.RIGHT, padx=4)
        tk.Button(btn_row, text="\u63d0\u4ea4", command=do_commit, bg="#3d7d3d", fg="#fff",
                  relief="flat", padx=20, pady=6, cursor="hand2").pack(side=tk.RIGHT, padx=4)

        win.bind("<Return>", lambda e: do_commit())
        win.bind("<Escape>", lambda e: cancel())

    def _git_commit_worker(self, msg=None):
        import datetime
        if not msg:
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

    def _latest_patch_from_output(self):
        try:
            txt = self.output_box.get("1.0", tk.END)
        except Exception:
            return None
        candidates = []
        for line in txt.splitlines():
            m = re.search(r"\[apply\] OK (tools/patch-[\w\-]+\.py)", line)
            if m:
                candidates.append(m.group(1))
        if not candidates:
            return None
        return candidates[-1]

    def smart_run(self):
        text = self.input_box.get("1.0", tk.END).strip()
        if not text:
            latest = self._latest_patch_from_output()
            if latest:
                text = latest
                self.input_box.delete("1.0", tk.END)
                self.input_box.insert("1.0", text)
                log_queue.put("[dev] 输入框为空，用输出框最近补丁: " + text)
            else:
                self.apply_msg.config(text="空内容，输出框也没找到 patch")
                return
        self._clear_output_if_needed()
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