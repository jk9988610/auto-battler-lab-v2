import { io } from "socket.io-client";

const URL = process.env.URL || "http://localhost:3000";
const PASSWORD = "secret123";
const ARGS = process.argv.slice(2);
const DO_TRIPLE = ARGS.includes("--triple");

function randUser(prefix){
  return prefix + Math.random().toString(36).slice(2, 8);
}

async function api(path, body, token){
  const headers = { "Content-Type": "application/json" };
  if(token) headers.Authorization = "Bearer " + token;
  const r = await fetch(URL + "/api" + path, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch(e) { j = null; }
  return { status: r.status, body: j };
}

async function register(username, password){
  const r = await api("/auth/register", { username, password });
  if(r.status !== 200) throw new Error("register failed " + r.status + " " + JSON.stringify(r.body));
  return r.body;
}

function connect(token){
  return new Promise((resolve, reject) => {
    const s = io(URL, { auth: { token }, reconnection: false });
    const buffer = { hello: null };
    s.on("hello", (d) => { buffer.hello = d; });
    const t = setTimeout(() => reject(new Error("connect timeout")), 8000);
    s.on("connect", () => { clearTimeout(t); resolve({ socket: s, buffer }); });
    s.on("connect_error", (e) => { clearTimeout(t); reject(e); });
  });
}

function once(socket, event, timeout){
  timeout = timeout || 5000;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout waiting " + event)), timeout);
    socket.once(event, (data) => { clearTimeout(t); resolve(data); });
  });
}

function emitAck(socket, event, payload){
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ack timeout " + event)), 5000);
    const cb = (res) => { clearTimeout(t); resolve(res); };
    if(payload === undefined) socket.emit(event, cb);
    else socket.emit(event, payload, cb);
  });
}

function waitState(socket, predicate, timeout){
  timeout = timeout || 5000;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { socket.off("game:state", handler); reject(new Error("state wait timeout")); }, timeout);
    function handler(state){
      if(predicate(state)){
        clearTimeout(t);
        socket.off("game:state", handler);
        resolve(state);
      }
    }
    socket.on("game:state", handler);
  });
}

function findMe(state, uid){
  if(!state || !state.players) return null;
  return state.players.find(p => p.uid === uid) || null;
}

function summarize(state, uid){
  if(!state) return "(no state)";
  const me = findMe(state, uid);
  if(!me) return "(no me uid=" + uid + ")";
  const g = me.gold == null ? "-" : String(me.gold);
  const h = me.hp == null ? "-" : String(me.hp);
  const hd = me.hand ? me.hand.length : 0;
  const sh = me.shop ? me.shop.length : 0;
  let tail = "";
  if(me.ready) tail += " [ready]";
  if(me.alive === false) tail += " [淘汰]";
  const parts = ["T" + state.turn, state.phase, "金" + g, "血" + h, "手" + hd, "店" + sh];
  return parts.join(" ") + tail;
}

function cardLine(card){
  const gold = card.golden ? "✦" : "";
  return card.name + gold + "(★" + card.tier + " 攻" + card.attack + " 血" + card.hp + ")";
}

async function main(){
  const log = function(){ console.log("[e2e]", ...arguments); };
  const uA = randUser("qa");
  const uB = randUser("qb");

  log("URL", URL, DO_TRIPLE ? "(triple 模式)" : "");
  log("注册", uA, uB);
  const A = await register(uA, PASSWORD);
  const B = await register(uB, PASSWORD);
  const uidA = A.user.id;
  const uidB = B.user.id;
  log("A uid=" + uidA, "B uid=" + uidB);

  const connA = await connect(A.token);
  const connB = await connect(B.token);
  const sa = connA.socket;
  const sb = connB.socket;
  log("socket connected");

  await new Promise(r => setTimeout(r, 200));
  const ha = connA.buffer.hello;
  const hb = connB.buffer.hello;
  if(!ha) throw new Error("no hello for A");
  if(!hb) throw new Error("no hello for B");
  log("hello A=" + ha.user.username, "B=" + hb.user.username);

  const cRes = await emitAck(sa, "room:create", { name: "e2e-" + Date.now() });
  if(!cRes.ok) throw new Error("create failed");
  const roomId = cRes.room.id;
  log("房间创建", roomId);

  const jRes = await emitAck(sb, "room:join", { id: roomId });
  if(!jRes.ok) throw new Error("join failed " + jRes.error);
  log("B 加入");

  await emitAck(sb, "room:ready", { ready: true });
  log("B 准备");

  const waitA0 = waitState(sa, s => s.turn === 1 && s.phase === "prepare");
  const waitB0 = waitState(sb, s => s.turn === 1 && s.phase === "prepare");
  const startRes = await emitAck(sa, "room:start");
  if(!startRes.ok) throw new Error("start failed " + startRes.error);
  const stA0 = await waitA0;
  const stB0 = await waitB0;
  log("开局");
  log("初始 A:", summarize(stA0, uidA));
  log("初始 B:", summarize(stB0, uidB));

  const shopA0 = findMe(stA0, uidA).shop;
  const shopB0 = findMe(stB0, uidB).shop;
  log("A 商店", shopA0.map(cardLine).join(" | "));
  log("B 商店", shopB0.map(cardLine).join(" | "));

  log("A 购买 slot 0");
  const waitBuyA = waitState(sa, s => { const m = findMe(s, uidA); return m && m.hand && m.hand.length === 1; });
  const buyA = await emitAck(sa, "game:buy", { slot: 0 });
  if(!buyA.ok) throw new Error("A buy failed " + buyA.error);
  const stA1 = await waitBuyA;
  log("A 购买后:", summarize(stA1, uidA));

  log("B 购买 slot 0");
  const waitBuyB = waitState(sb, s => { const m = findMe(s, uidB); return m && m.hand && m.hand.length === 1; });
  const buyB = await emitAck(sb, "game:buy", { slot: 0 });
  if(!buyB.ok) throw new Error("B buy failed " + buyB.error);
  const stB1 = await waitBuyB;
  log("B 购买后:", summarize(stB1, uidB));

  const waitBattleA = once(sa, "game:battle");
  const waitBattleB = once(sb, "game:battle");
  const waitT2A = waitState(sa, s => s.turn === 2);
  const waitT2B = waitState(sb, s => s.turn === 2);

  log("A endTurn");
  const eA = await emitAck(sa, "game:endTurn");
  if(!eA.ok) throw new Error("A endTurn failed " + eA.error);

  log("B endTurn");
  const eB = await emitAck(sb, "game:endTurn");
  if(!eB.ok) throw new Error("B endTurn failed " + eB.error);

  const battle = await waitBattleA;
  await waitBattleB;
  const stA2 = await waitT2A;
  const stB2 = await waitT2B;

  console.log("");
  console.log("========== REPORT ==========");
  console.log("room:", roomId);
  console.log("A:", uA, "uid=" + uidA);
  console.log("B:", uB, "uid=" + uidB);
  console.log("");
  console.log("T1 初始");
  console.log("  A:", summarize(stA0, uidA));
  console.log("  B:", summarize(stB0, uidB));
  console.log("T1 购买后");
  console.log("  A:", summarize(stA1, uidA), "hand=" + findMe(stA1, uidA).hand.map(cardLine).join(","));
  console.log("  B:", summarize(stB1, uidB), "hand=" + findMe(stB1, uidB).hand.map(cardLine).join(","));
  console.log("战斗结算");
  battle.pairings.forEach(function(p){
    const winner = p.winnerUid === p.aUid ? p.aName : p.bName;
    console.log("  " + p.aName + "(" + p.aPower + ") vs " + p.bName + "(" + p.bPower + ") → 胜:" + winner + " 伤害:" + p.damage);
  });
  const elimStr = battle.eliminated.length === 0 ? "无" : battle.eliminated.map(x => x.username).join(",");
  console.log("  淘汰:", elimStr);
  console.log("  对局结束:", battle.gameOver);
  console.log("T2");
  console.log("  A:", summarize(stA2, uidA));
  console.log("  B:", summarize(stB2, uidB));
  console.log("");

  let tripleOk = true;
  if(DO_TRIPLE){
    console.log("---------- TRIPLE TEST ----------");
    const waitTripleEvt = once(sa, "game:triple", 5000);
    const waitTriState = waitState(sa, s => {
      const m = findMe(s, uidA);
      return m && m.hand && m.hand.length === 1 && m.hand[0].golden === true;
    });
    const rTri = await emitAck(sa, "game:debug-triple");
    if(!rTri.ok) throw new Error("debug-triple failed " + (rTri.error || ""));
    const evtTri = await waitTripleEvt;
    const stTri = await waitTriState;
    const goldCard = findMe(stTri, uidA).hand[0];
    console.log("triple 事件: " + evtTri.name + " 攻" + evtTri.attack + " 血" + evtTri.hp);
    console.log("A 手牌: " + findMe(stTri, uidA).hand.map(cardLine).join(","));
    tripleOk = !!goldCard && goldCard.golden === true && /金色/.test(goldCard.name);
    console.log(tripleOk ? "  triple PASS" : "  triple FAIL");
    console.log("---------------------------------");
    console.log("");
  }

  const meA1 = findMe(stA1, uidA);
  const meB1 = findMe(stB1, uidB);
  const pass =
    meA1 && meA1.hand.length === 1 && meA1.gold === 0 &&
    meB1 && meB1.hand.length === 1 &&
    battle.pairings.length === 1 &&
    battle.turn === 1 &&
    stA2.turn === 2 &&
    stB2.turn === 2 &&
    tripleOk;

  console.log(pass ? "PASS ✅" : "FAIL ❌");
  console.log("============================");

  sa.emit("room:leave");
  sb.emit("room:leave");
  sa.disconnect();
  sb.disconnect();

  process.exit(pass ? 0 : 1);
}

main().catch(function(e){
  console.error("[e2e] ERROR:", e.message || e);
  process.exit(1);
});