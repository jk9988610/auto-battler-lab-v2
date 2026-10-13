import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { env } from "./env";
import { verifyToken, type AuthUser } from "./auth";
import * as Rooms from "./rooms";
import * as Games from "./games";

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

  function broadcastGame(state: Games.GameState) {
    io.to(state.roomId).emit("game:state", state);
  }

  io.on("connection", function (socket) {
    const user = (socket.data as any).user as AuthUser;
    console.log("[socket] connected uid=" + user.uid + " name=" + user.username);
    socket.emit("hello", { ok: true, user });
    socket.emit("room:list", Rooms.listRooms());

    function findGameBySocket(socketId: string): Games.GameState | null {
      const all = Rooms.listRooms();
      for (let i = 0; i < all.length; i++) {
        const room = Rooms.getRoom(all[i].id);
        if (!room) continue;
        const p = room.players.find(function (x) { return x.socketId === socketId; });
        if (p) {
          const g = Games.getGame(room.id);
          if (g) return g;
        }
      }
      return null;
    }

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
      const g = Games.getGame(room.id);
      if (cb) cb({ ok: true, room: Rooms.sanitizeRoom(room), hasGame: !!g });
      broadcastRoom(room);
      broadcastList();
      if (g) socket.emit("game:state", g);
    });

    socket.on("room:rejoin", function (cb?: (r: unknown) => void) {
      const r = Rooms.rejoinRoom(user.uid, socket.id);
      if ((r as any).error) {
        if (cb) cb({ ok: false, error: (r as any).error });
        return;
      }
      const room = (r as any).room as Rooms.Room;
      socket.join(room.id);
      const g = Games.getGame(room.id);
      if (cb) cb({ ok: true, room: Rooms.sanitizeRoom(room), hasGame: !!g });
      // 广播给房间内所有人，让其他人看到 A 在线状态变化
      io.to(room.id).emit("room:update", Rooms.sanitizeRoom(room));
      broadcastList();
      if (g) socket.emit("game:state", g);
      console.log("[socket] rejoin uid=" + user.uid + " room=" + room.id + " hasGame=" + !!g);
    });

    socket.on("room:leave", function (cb?: (r: unknown) => void) {
      const result = Rooms.leaveRoom(socket.id);
      if (result.roomId) {
        socket.leave(result.roomId);
        const g = Games.getGame(result.roomId);
        if (g) {
          Games.removeGame(result.roomId);
          io.to(result.roomId).emit("game:closed", { roomId: result.roomId });
        }
      }
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
        const room = result.room;
        const players = room.players.map(function (p) {
          return { uid: p.uid, username: p.username };
        });
        const state = Games.startGame(room.id, players);
        broadcastRoom(room);
        io.to(room.id).emit("room:started", { roomId: room.id });
        broadcastGame(state);
        broadcastList();
        if (cb) cb({ ok: true });
      }
    });

    socket.on("game:endTurn", function (cb?: (r: unknown) => void) {
      const g = findGameBySocket(socket.id);
      if (!g) { if (cb) cb({ ok: false, error: "no game" }); return; }
      const res = Games.playerEndTurn(g.roomId, user.uid);
      if (!res.ok) { if (cb) cb({ ok: false, error: res.error }); return; }
      if (res.battle) {
        io.to(g.roomId).emit("game:battle", res.battle);
      }
      if (res.state) broadcastGame(res.state);
      if (res.battle && res.battle.gameOver) {
        const g2 = Games.getGame(g.roomId);
        if (g2) Games.removeGame(g.roomId);
        const room = Rooms.resetRoomForNewGame(g.roomId);
        if (room) {
          broadcastRoom(room);
          io.to(room.id).emit("game:finished", { roomId: room.id });
          broadcastList();
        }
      }
      if (cb) cb({ ok: true });
    });

    socket.on("game:buy", function (payload: { slot: number }, cb?: (r: unknown) => void) {
      const g = findGameBySocket(socket.id);
      if (!g) { if (cb) cb({ ok: false, error: "no game" }); return; }
      const res = Games.playerBuy(g.roomId, user.uid, payload.slot);
      if (!res.ok) { if (cb) cb({ ok: false, error: res.error }); return; }
      if (res.merged && res.merged.length > 0) {
        res.merged.forEach(function (c) {
          io.to(g.roomId).emit("game:triple", {
            uid: user.uid,
            username: user.username,
            name: c.name,
            tier: c.tier,
            attack: c.attack,
            hp: c.hp,
          });
        });
      }
      if (res.state) broadcastGame(res.state);
      if (cb) cb({ ok: true });
    });

    socket.on("game:sell", function (payload: { handIndex: number }, cb?: (r: unknown) => void) {
      const g = findGameBySocket(socket.id);
      if (!g) { if (cb) cb({ ok: false, error: "no game" }); return; }
      const res = Games.playerSell(g.roomId, user.uid, payload.handIndex);
      if (!res.ok) { if (cb) cb({ ok: false, error: res.error }); return; }
      if (res.state) broadcastGame(res.state);
      if (cb) cb({ ok: true });
    });

    socket.on("game:place", function (payload: { handIndex: number }, cb?: (r: unknown) => void) {
      const g = findGameBySocket(socket.id);
      if (!g) { if (cb) cb({ ok: false, error: "no game" }); return; }
      const res = Games.playerPlace(g.roomId, user.uid, payload.handIndex);
      if (!res.ok) { if (cb) cb({ ok: false, error: res.error }); return; }
      if (res.state) broadcastGame(res.state);
      if (cb) cb({ ok: true });
    });

    socket.on("game:remove", function (payload: { boardIndex: number }, cb?: (r: unknown) => void) {
      const g = findGameBySocket(socket.id);
      if (!g) { if (cb) cb({ ok: false, error: "no game" }); return; }
      const res = Games.playerRemove(g.roomId, user.uid, payload.boardIndex);
      if (!res.ok) { if (cb) cb({ ok: false, error: res.error }); return; }
      if (res.state) broadcastGame(res.state);
      if (cb) cb({ ok: true });
    });

    socket.on("game:refresh", function (cb?: (r: unknown) => void) {
      const g = findGameBySocket(socket.id);
      if (!g) { if (cb) cb({ ok: false, error: "no game" }); return; }
      const res = Games.playerRefresh(g.roomId, user.uid);
      if (!res.ok) { if (cb) cb({ ok: false, error: res.error }); return; }
      if (res.state) broadcastGame(res.state);
      if (cb) cb({ ok: true });
    });

    socket.on("game:freeze", function (cb?: (r: unknown) => void) {
      const g = findGameBySocket(socket.id);
      if (!g) { if (cb) cb({ ok: false, error: "no game" }); return; }
      const res = Games.playerFreeze(g.roomId, user.uid);
      if (!res.ok) { if (cb) cb({ ok: false, error: res.error }); return; }
      if (res.state) broadcastGame(res.state);
      if (cb) cb({ ok: true });
    });

    socket.on("game:upgrade", function (cb?: (r: unknown) => void) {
      const g = findGameBySocket(socket.id);
      if (!g) { if (cb) cb({ ok: false, error: "no game" }); return; }
      const res = Games.playerUpgrade(g.roomId, user.uid);
      if (!res.ok) { if (cb) cb({ ok: false, error: res.error }); return; }
      io.to(g.roomId).emit("game:upgraded", {
        uid: user.uid,
        username: user.username,
        newTier: res.newTier,
        cost: res.cost,
      });
      if (res.state) broadcastGame(res.state);
      if (cb) cb({ ok: true });
    });

    socket.on("game:debug-triple", function (cb?: (r: unknown) => void) {
      const g = findGameBySocket(socket.id);
      if (!g) { if (cb) cb({ ok: false, error: "no game" }); return; }
      const res = Games.debugForceTriple(g.roomId, user.uid);
      if (!res.ok) { if (cb) cb({ ok: false, error: res.error }); return; }
      if (res.merged && res.merged.length > 0) {
        res.merged.forEach(function (c) {
          io.to(g.roomId).emit("game:triple", {
            uid: user.uid,
            username: user.username,
            name: c.name,
            tier: c.tier,
            attack: c.attack,
            hp: c.hp,
          });
        });
      }
      if (res.state) broadcastGame(res.state);
      if (cb) cb({ ok: true });
    });

    socket.on("game:debug-keyword", function (cb?: (r: unknown) => void) {
      const g = findGameBySocket(socket.id);
      if (!g) { if (cb) cb({ ok: false, error: "no game" }); return; }
      const res = Games.debugGiveKeywordCard(g.roomId, user.uid);
      if (!res.ok) { if (cb) cb({ ok: false, error: res.error }); return; }
      if (res.state) broadcastGame(res.state);
      if (cb) cb({ ok: true });
    });

    socket.on("disconnect", function (reason) {
      console.log("[socket] disconnect uid=" + user.uid + " reason=" + reason);
      const result = Rooms.markOffline(socket.id);
      if (result.room) broadcastRoom(result.room);
      broadcastList();
    });
  });

  return io;
}