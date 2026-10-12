import { Router, type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "./db";
import { env } from "./env";

export interface AuthUser {
uid: number;
username: string;
}

interface UserRow {
id: number;
username: string;
password_hash: string;
}

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
const { username, password } = req.body ?? {};
if (typeof username !== "string" || typeof password !== "string") {
return res.status(400).json({ error: "username/password required" });
}
if (username.length < 3 || username.length > 24) {
return res.status(400).json({ error: "username length 3-24" });
}
if (password.length < 6) {
return res.status(400).json({ error: "password min 6" });
}
const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
if (exists) return res.status(409).json({ error: "username taken" });

const hash = await bcrypt.hash(password, 10);
const info = db
.prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)")
.run(username, hash, Date.now());

const uid = Number(info.lastInsertRowid);
const token = signToken({ uid, username });
res.json({ token, user: { id: uid, username } });
});

authRouter.post("/login", async (req, res) => {
const { username, password } = req.body ?? {};
if (typeof username !== "string" || typeof password !== "string") {
return res.status(400).json({ error: "username/password required" });
}
const row = db
.prepare("SELECT id, username, password_hash FROM users WHERE username = ?")
.get(username) as UserRow | undefined;
if (!row) return res.status(401).json({ error: "invalid credentials" });

const ok = await bcrypt.compare(password, row.password_hash);
if (!ok) return res.status(401).json({ error: "invalid credentials" });

const token = signToken({ uid: row.id, username: row.username });
res.json({ token, user: { id: row.id, username: row.username } });
});

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
const h = req.headers.authorization ?? "";
const m = /^Bearer\s+(.+)$/.exec(h);
if (!m) return res.status(401).json({ error: "missing token" });
try {
(req as any).user = jwt.verify(m[1], env.jwtSecret);
next();
} catch {
res.status(401).json({ error: "invalid token" });
}
}

export function signToken(payload: AuthUser): string {
return jwt.sign(payload, env.jwtSecret, { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthUser {
return jwt.verify(token, env.jwtSecret) as AuthUser;
}
