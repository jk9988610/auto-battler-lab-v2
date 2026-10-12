import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { env } from "./env";
import { verifyToken, type AuthUser } from "./auth";
import * as Rooms from "./rooms";

export function attachSocket(http: HttpServer) {
const io = new Server(http, {
cors: { origin: env.clientOrigin, credentials: true },
});

io.use(function (socket, next) {
const token = socket.handshake.auth && socket.handshake.auth.token;
if (!token) return next(new Error("no token"));
try {
(socket.data as any).user = verifyToken(token) as AuthUser;
next();
} catch {
next(new Error("bad token"));
}
});

function broadcastRoom(room: Rooms.Room) {
io.to(room.id).emit("room:update", Rooms.sanitizeRoom(room));
}

function broadcastList() {
io.emit("room:list", Rooms.listRooms());
}

io.on("connection", function (socket) {
const user = (socket.data as any).user as AuthUser;
console.log("[socket] connected uid=" + user.uid + " name=" + user.username);
socket.emit("hello", { ok: true, user });
socket.emit("room:list", Rooms.listRooms());

socket.on("ping", function (cb?: (r: unknown) => void) {
if (cb) cb({ t: Date.now() });
});

socket.on("room:list", function (cb?: (r: unknown) => void) {
const list = Rooms.listRooms();
if (cb) cb(list);
socket.emit("room:list", list);
});

socket.on("room:create", function (payload: { name?: string }, cb?: (r: unknown) => void) {
const nm = payload && payload.name ? payload.name : "";
const room = Rooms.createRoom(nm, user, socket.id);
socket.join(room.id);
if (cb) cb({ ok: true, room: Rooms.sanitizeRoom(room) });
broadcastRoom(room);
broadcastList();
});

socket.on("room:join", function (payload: { id: string }, cb?: (r: unknown) => void) {
const r = Rooms.joinRoom(payload.id, user, socket.id);
if ((r as any).error) {
if (cb) cb({ ok: false, error: (r as any).error });
return;
}
const room = r as Rooms.Room;
socket.join(room.id);
if (cb) cb({ ok: true, room: Rooms.sanitizeRoom(room) });
broadcastRoom(room);
broadcastList();
});

socket.on("room:leave", function (cb?: (r: unknown) => void) {
const result = Rooms.leaveRoom(socket.id);
if (result.roomId) socket.leave(result.roomId);
if (result.room) broadcastRoom(result.room);
broadcastList();
if (cb) cb({ ok: true });
});

socket.on("room:ready", function (payload: { ready: boolean }, cb?: (r: unknown) => void) {
const room = Rooms.setReady(socket.id, !!payload.ready);
if (room) {
broadcastRoom(room);
if (cb) cb({ ok: true });
} else {
if (cb) cb({ ok: false, error: "not in room" });
}
});

socket.on("room:start", function (cb?: (r: unknown) => void) {
const result = Rooms.tryStart(socket.id);
if (result.error) {
if (cb) cb({ ok: false, error: result.error });
return;
}
if (result.room) {
broadcastRoom(result.room);
io.to(result.room.id).emit("room:started", { roomId: result.room.id });
broadcastList();
if (cb) cb({ ok: true });
}
});

socket.on("disconnect", function (reason) {
console.log("[socket] disconnect uid=" + user.uid + " reason=" + reason);
const result = Rooms.leaveRoom(socket.id);
if (result.room) broadcastRoom(result.room);
broadcastList();
});
});

return io;
}
