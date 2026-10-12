import type { Server as IOServer } from "socket.io";

export interface Player {
uid: number;
username: string;
socketId: string;
ready: boolean;
isHost: boolean;
}

export interface Room {
id: string;
name: string;
hostUid: number;
maxPlayers: number;
status: "waiting" | "playing";
players: Player[];
createdAt: number;
}

const rooms = new Map<string, Room>();

function genId(): string {
return Math.random().toString(36).slice(2, 8);
}

export function listRooms() {
const arr: Array<{ id: string; name: string; status: string; count: number; maxPlayers: number }> = [];
rooms.forEach(function (r) {
arr.push({
id: r.id,
name: r.name,
status: r.status,
count: r.players.length,
maxPlayers: r.maxPlayers,
});
});
return arr;
}

export function getRoom(id: string): Room | undefined {
return rooms.get(id);
}

export function createRoom(
name: string,
user: { uid: number; username: string },
socketId: string
): Room {
const id = genId();
const player: Player = {
uid: user.uid,
username: user.username,
socketId: socketId,
ready: true,
isHost: true,
};
const room: Room = {
id: id,
name: name && name.length > 0 ? name : user.username + " 的房间",
hostUid: user.uid,
maxPlayers: 8,
status: "waiting",
players: [player],
createdAt: Date.now(),
};
rooms.set(id, room);
return room;
}

export function joinRoom(
id: string,
user: { uid: number; username: string },
socketId: string
): Room | { error: string } {
const room = rooms.get(id);
if (!room) return { error: "room not found" };
if (room.status !== "waiting") return { error: "already playing" };
if (room.players.length >= room.maxPlayers) return { error: "room full" };

const existing = room.players.find(function (p) { return p.uid === user.uid; });
if (existing) {
existing.socketId = socketId;
return room;
}
room.players.push({
uid: user.uid,
username: user.username,
socketId: socketId,
ready: false,
isHost: false,
});
return room;
}

export function leaveRoom(socketId: string): { room: Room | null; roomId: string | null; deleted: boolean } {
let result: { room: Room | null; roomId: string | null; deleted: boolean } = {
room: null,
roomId: null,
deleted: false,
};
rooms.forEach(function (room, id) {
if (result.roomId !== null) return;
const idx = room.players.findIndex(function (p) { return p.socketId === socketId; });
if (idx < 0) return;
const wasHost = room.players[idx].isHost;
room.players.splice(idx, 1);
if (room.players.length === 0) {
rooms.delete(id);
result = { room: null, roomId: id, deleted: true };
return;
}
if (wasHost) {
room.players[0].isHost = true;
room.hostUid = room.players[0].uid;
}
result = { room: room, roomId: id, deleted: false };
});
return result;
}

export function setReady(socketId: string, ready: boolean): Room | null {
let found: Room | null = null;
rooms.forEach(function (room) {
if (found) return;
const p = room.players.find(function (x) { return x.socketId === socketId; });
if (p) {
p.ready = ready;
found = room;
}
});
return found;
}

export function tryStart(socketId: string): { room: Room | null; error?: string } {
let found: Room | null = null;
rooms.forEach(function (room) {
if (found) return;
const me = room.players.find(function (x) { return x.socketId === socketId; });
if (me) found = room;
});
if (!found) return { room: null, error: "not in room" };
const room = found as Room;
const me = room.players.find(function (x) { return x.socketId === socketId; });
if (!me || !me.isHost) return { room: null, error: "not host" };
if (room.players.length < 2) return { room: null, error: "need at least 2 players" };
const allReady = room.players.every(function (p) { return p.ready; });
if (!allReady) return { room: null, error: "not all ready" };
room.status = "playing";
return { room: room };
}

export function sanitizeRoom(room: Room) {
const players: Array<{ uid: number; username: string; ready: boolean; isHost: boolean }> = [];
room.players.forEach(function (p) {
players.push({ uid: p.uid, username: p.username, ready: p.ready, isHost: p.isHost });
});
return {
id: room.id,
name: room.name,
status: room.status,
maxPlayers: room.maxPlayers,
hostUid: room.hostUid,
players: players,
};
}

export function socketsInRoom(io: IOServer, roomId: string): string[] {
const room = rooms.get(roomId);
if (!room) return [];
return room.players.map(function (p) { return p.socketId; });
}
