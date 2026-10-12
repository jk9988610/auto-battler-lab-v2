import { io } from "socket.io-client";

const URL = process.env.URL || "http://localhost:3000";
const PASSWORD = "secret123";
const ARGS = process.argv.slice(2);
const MODE_FULL = ARGS.includes("--full");
const DO_TRIPLE = MODE_FULL || ARGS.includes("--triple");
const DO_BOARD = MODE_FULL || ARGS.includes("--board");
const DO_UPGRADE = MODE_FULL || ARGS.includes("--upgrade");
const DO_RECONNECT = MODE_FULL || ARGS.includes("--reconnect");

const latestStates = new WeakMap();
const latestRooms = new WeakMap();

function attachWatchers(socket){
  socket.on("game:state", (s) => latestStates.set(socket, s));
  socket.on("room:update", (r) => latestRooms.set(socket, r));
}

function getLatest(socket){ return latestStates.get(socket) || null; }
function getLatestRoom(socket){ return latestRooms.get(socket) || null; }

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

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
    attachWatchers(s);
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
  timeout = timeout || 6000;
  const cached = getLatest(socket);
  if(cached && predicate(cached)) return Promise.resolve(cached);

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

function getState(socket){
  return Promise.resolve(getLatest(socket));
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
  const bd = me.board ? me.board.length : 0;
  const sh = me.shop ? me.shop.length : 0;
  const tier = me.tavernTier || 1;
  let tail = "";
  if(me.ready) tail += " [ready]";
  if(me.alive === false) tail += " [淘汰]";
  const parts = ["T" + state.turn, state.phase, "酒馆T" + tier, "金" + g, "血" + h, "场" + bd, "手" + hd, "店" + sh];
  return parts.join(" ") + tail;
}

function cardLine(card){
  const gold = card.golden ? "✦" : "";
  return card.name + gold + "(★" + card.tier + " 攻" + card.attack + " 血" + card.hp + ")";
}

async function advanceTurn(sa, sb, uidA, uidB, expectTurn){
  const waitBattleA = once(sa, "game:battle", 8000);
  const waitBattleB = once(sb, "game:battle", 8000);
  const waitTA = waitState(sa, s => s.turn === expectTurn, 8000);
  const waitTB = waitState(sb, s => s.turn === expectTurn, 8000);

  let stA = await getState(sa);
  if(findMe(stA, uidA).alive && !findMe(stA, uidA).ready){
    const eA = await emitAck(sa, "game:endTurn");
    if(!eA.ok) throw new Error("A endTurn failed " + eA.error);
  }
  let stB = await getState(sb);
  if(findMe(stB, uidB).alive && !findMe(stB, uidB).ready){
    const eB = await emitAck(sb, "game:endTurn");
    if(!eB.ok) throw new Error("B endTurn failed " + eB.error);
  }

  await waitBattleA;
  await waitBattleB;
  const rA = await waitTA;
  const rB = await waitTB;
  return { stA: rA, stB: rB };
}

async function main(){
  const log = function(){ console.log("[e2e]", ...arguments); };
  const uA = randUser("qa");
  const uB = randUser("qb");

  const flags = [];
  if(DO_BOARD) flags.push("board");
  if(DO_TRIPLE) flags.push("triple");
  if(DO_UPGRADE) flags.push("upgrade");
  if(DO_RECONNECT) flags.push("reconnect");
  log("URL", URL, flags.length ? "(" + flags.join("+") + ")" : "");
  log("注册", uA, uB);
  const A = await register(uA, PASSWORD);
  const B = await register(uB, PASSWORD);
  const uidA = A.user.id;
  const uidB = B.user.id;
  log("A uid=" + uidA, "B uid=" + uidB);

  const connA = await connect(A.token);
  const connB = await connect(B.token);
  let sa = connA.socket;
  const sb = connB.socket;
  log("socket connected");

  await sleep(200);
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

  const startRes = await emitAck(sa, "room:start");
  if(!startRes.ok) throw new Error("start failed " + startRes.error);
  await waitState(sa, s => s.turn === 1 && s.phase === "prepare");
  await waitState(sb, s => s.turn === 1 && s.phase === "prepare");
  let stA = await getState(sa);
  let stB = await getState(sb);
  log("开局");
  log("初始 A:", summarize(stA, uidA));
  log("初始 B:", summarize(stB, uidB));

  // 双方各买 1 张
  const buyA = await emitAck(sa, "game:buy", { slot: 0 });
  if(!buyA.ok) throw new Error("A buy failed " + buyA.error);
  await waitState(sa, s => { const m = findMe(s, uidA); return m && m.hand.length === 1; });
  log("A 购买后:", summarize(await getState(sa), uidA));

  const buyB = await emitAck(sb, "game:buy", { slot: 0 });
  if(!buyB.ok) throw new Error("B buy failed " + buyB.error);
  await waitState(sb, s => { const m = findMe(s, uidB); return m && m.hand.length === 1; });
  log("B 购买后:", summarize(await getState(sb), uidB));

  // UPGRADE
  let upgradeOk = true;
  if(DO_UPGRADE){
    console.log("---------- UPGRADE TEST ----------");
    log("攒钱：连打 2 回合");
    const r1 = await advanceTurn(sa, sb, uidA, uidB, 2);
    stA = r1.stA; stB = r1.stB;
    log("T2:", summarize(stA, uidA));
    const r2 = await advanceTurn(sa, sb, uidA, uidB, 3);
    stA = r2.stA; stB = r2.stB;
    log("T3:", summarize(stA, uidA));

    const me = findMe(stA, uidA);
    if(me.gold < 5){
      log("金币不足（" + me.gold + "），跳过升级");
      upgradeOk = false;
    } else {
      log("升级酒馆（当前 T" + (me.tavernTier||1) + "）");
      const waitUpgEvt = once(sa, "game:upgraded", 5000);
      const upgRes = await emitAck(sa, "game:upgrade");
      if(!upgRes.ok) throw new Error("upgrade failed " + upgRes.error);
      const evtUpg = await waitUpgEvt;
      await waitState(sa, s => { const m = findMe(s, uidA); return m && (m.tavernTier||1) >= 2; });
      const stUpg = await getState(sa);
      log("upgraded 事件: newTier=" + evtUpg.newTier + " cost=" + evtUpg.cost);
      log("升级后:", summarize(stUpg, uidA));
      upgradeOk = findMe(stUpg, uidA).tavernTier >= 2;
    }
    console.log(upgradeOk ? "  upgrade PASS" : "  upgrade FAIL");
    console.log("---------------------------------");
    console.log("");
  }

  // BOARD
  let boardOk = true;
  if(DO_BOARD){
    console.log("---------- BOARD TEST ----------");
    stA = await getState(sa);
    const me = findMe(stA, uidA);
    if(!me.hand || me.hand.length === 0){
      log("A 无手牌，跳过 board");
      boardOk = false;
    } else {
      log("A 上阵手牌[0]");
      const placeA = await emitAck(sa, "game:place", { handIndex: 0 });
      if(!placeA.ok) throw new Error("A place failed " + placeA.error);
      await waitState(sa, s => { const m = findMe(s, uidA); return m && m.board.length === 1; });
      const stPlaceA = await getState(sa);
      const aPower = findMe(stPlaceA, uidA).board.reduce((s, c) => s + c.attack + c.hp, 0);
      log("A 上阵后: " + summarize(stPlaceA, uidA));
      log("A 场上 power =", aPower);

      log("A 下阵");
      const removeA = await emitAck(sa, "game:remove", { boardIndex: 0 });
      if(!removeA.ok) throw new Error("A remove failed " + removeA.error);
      await waitState(sa, s => { const m = findMe(s, uidA); return m && m.board.length === 0; });
      log("A 下阵后: " + summarize(await getState(sa), uidA));

      log("A 再次上阵");
      const placeA2 = await emitAck(sa, "game:place", { handIndex: 0 });
      if(!placeA2.ok) throw new Error("A place2 failed " + placeA2.error);
      await waitState(sa, s => { const m = findMe(s, uidA); return m && m.board.length === 1; });
      const stPlaceA2 = await getState(sa);
      log("A 再次上阵: " + summarize(stPlaceA2, uidA));
      boardOk = findMe(stPlaceA2, uidA).board.length === 1 && aPower > 0;
    }
    console.log(boardOk ? "  board PASS" : "  board FAIL");
    console.log("---------------------------------");
    console.log("");
  }

  // TRIPLE
  let tripleOk = true;
  if(DO_TRIPLE){
    console.log("---------- TRIPLE TEST ----------");
    const waitTripleEvt = once(sa, "game:triple", 5000);
    const rTri = await emitAck(sa, "game:debug-triple");
    if(!rTri.ok) throw new Error("debug-triple failed " + (rTri.error || ""));
    const evtTri = await waitTripleEvt;
    await waitState(sa, s => {
      const m = findMe(s, uidA);
      return m && m.hand && m.hand.some(c => c.golden === true);
    });
    const stTri = await getState(sa);
    const goldCard = findMe(stTri, uidA).hand.find(c => c.golden);
    console.log("triple 事件: " + evtTri.name + " 攻" + evtTri.attack + " 血" + evtTri.hp);
    console.log("A 手牌: " + findMe(stTri, uidA).hand.map(cardLine).join(","));
    tripleOk = !!goldCard && goldCard.golden === true && /金色/.test(goldCard.name);
    console.log(tripleOk ? "  triple PASS" : "  triple FAIL");
    console.log("---------------------------------");
    console.log("");
  }

  // 最后打一轮
  stA = await getState(sa);
  if(findMe(stA, uidA).alive && !findMe(stA, uidA).ready){
    const finalTurn = stA.turn + 1;
    const r3 = await advanceTurn(sa, sb, uidA, uidB, finalTurn);
    stA = r3.stA; stB = r3.stB;
  }

  // RECONNECT（最后一步，不破坏之前的状态）
  let reconnectOk = true;
  if(DO_RECONNECT){
    console.log("---------- RECONNECT TEST ----------");
    const stBefore = await getState(sa);
    const meBefore = findMe(stBefore, uidA);
    log("重连前 A: " + summarize(stBefore, uidA));

    // A 断开
    log("A socket 断开");
    sa.disconnect();
    await sleep(800);

    // B 侧应看到 A online=false
    const roomB1 = getLatestRoom(sb);
    let aOfflineInB = false;
    if(roomB1 && roomB1.players){
      const pa = roomB1.players.find(p => p.uid === uidA);
      aOfflineInB = !!pa && pa.online === false;
    }
    log("B 侧看到 A 离线 =", aOfflineInB);

    // A 重连
    log("A 重新连接");
    const connA2 = await connect(A.token);
    const sa2 = connA2.socket;
    await sleep(200);
    if(!connA2.buffer.hello) throw new Error("reconnect: no hello");

    // 发 room:rejoin
    log("A 请求恢复房间");
    const rj = await emitAck(sa2, "room:rejoin");
    if(!rj.ok) throw new Error("rejoin failed " + (rj.error || ""));
    if(!rj.room || rj.room.id !== roomId) throw new Error("rejoin: wrong room " + JSON.stringify(rj.room));
    if(!rj.hasGame) throw new Error("rejoin: no game restored");

    const stAfter = await waitState(sa2, s => s.turn === stBefore.turn && s.phase === stBefore.phase, 5000);
    const meAfter = findMe(stAfter, uidA);
    log("重连后 A: " + summarize(stAfter, uidA));

    const sameGold = meBefore.gold === meAfter.gold;
    const sameHp = meBefore.hp === meAfter.hp;
    const sameHandN = meBefore.hand.length === meAfter.hand.length;
    const sameBoardN = meBefore.board.length === meAfter.board.length;
    const sameTier = (meBefore.tavernTier||1) === (meAfter.tavernTier||1);
    const sameTurn = stBefore.turn === stAfter.turn;
    log("对比: 金=" + sameGold + " 血=" + sameHp + " 手=" + sameHandN + " 场=" + sameBoardN + " T=" + sameTier + " turn=" + sameTurn);

    await sleep(400);
    const roomB2 = getLatestRoom(sb);
    let aOnlineAgain = false;
    if(roomB2 && roomB2.players){
      const pa = roomB2.players.find(p => p.uid === uidA);
      aOnlineAgain = !!pa && pa.online !== false;
    }
    log("B 侧看到 A 恢复在线 =", aOnlineAgain);

    reconnectOk = sameGold && sameHp && sameHandN && sameBoardN && sameTier && sameTurn && aOfflineInB && aOnlineAgain;
    console.log(reconnectOk ? "  reconnect PASS" : "  reconnect FAIL");
    console.log("---------------------------------");
    console.log("");

    // 更新 sa 引用用于断开
    sa = sa2;
  }

  console.log("");
  console.log("========== REPORT ==========");
  console.log("room:", roomId);
  console.log("A:", uA, "uid=" + uidA);
  console.log("B:", uB, "uid=" + uidB);
  console.log("");
  console.log("board:", boardOk ? "PASS" : (DO_BOARD ? "FAIL" : "skip"));
  console.log("upgrade:", upgradeOk ? "PASS" : (DO_UPGRADE ? "FAIL" : "skip"));
  console.log("triple:", tripleOk ? "PASS" : (DO_TRIPLE ? "FAIL" : "skip"));
  console.log("reconnect:", reconnectOk ? "PASS" : (DO_RECONNECT ? "FAIL" : "skip"));
  console.log("");

  const pass = boardOk && upgradeOk && tripleOk && reconnectOk;

  console.log(pass ? "PASS ✅" : "FAIL ❌");
  console.log("============================");

  try { sa.emit("room:leave"); } catch(e){}
  try { sb.emit("room:leave"); } catch(e){}
  try { sa.disconnect(); } catch(e){}
  try { sb.disconnect(); } catch(e){}

  process.exit(pass ? 0 : 1);
}

main().catch(function(e){
  console.error("[e2e] ERROR:", e.message || e);
  process.exit(1);
});