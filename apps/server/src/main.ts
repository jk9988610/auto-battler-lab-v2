import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import express from "express";
import cors from "cors";
import { env } from "./env";
import "./db";
import { authRouter, authMiddleware } from "./auth";
import { attachSocket } from "./socket";

const app = express();
app.use(cors({ origin: env.clientOrigin, credentials: true }));
app.use(express.json());

app.get("/health", function (_req, res) {
res.json({ ok: true, t: Date.now() });
});

app.use("/api/auth", authRouter);
app.get("/api/me", authMiddleware, function (req, res) {
res.json({ user: (req as any).user });
});

const publicDir = path.resolve(__dirname, "../public");
app.use(express.static(publicDir));
console.log("[server] static dir: " + publicDir);

const server = http.createServer(app);
attachSocket(server);

server.listen(env.port, function () {
console.log("[server] listening on port " + env.port);
});
