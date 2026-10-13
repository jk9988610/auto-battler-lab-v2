import { io } from "socket.io-client";

const URL = process.env.URL || "http://localhost:3000";
const PASSWORD = "secret123";
const ARGS = process.argv.slice(2);
const MODE_FULL = ARGS.includes("--full");
const DO_TRIPLE = MODE_FULL || ARGS.includes("--triple");
const DO_BOARD = MODE_FULL || ARGS.includes("--board");
const DO_UPGRADE = MODE_FULL || ARGS.includes("--upgrade");
const DO_RECONNECT = MODE_FULL || ARGS.includes("--reconnect");
const DO_CARDS = MODE_FULL || ARGS.includes("--cards");
const DO_AI = MODE_FULL || ARGS.includes("--ai");

const latestStates = new WeakMap();
const latestRooms = new WeakMap();

function attachWatchers(socket){
  socket.on("game:state", (s) => latestStates.set(socket, s));
  socket.on("room:update", (r) => latestRooms.set(socket, r));
}
function getLatest(socket){ return latestStates.get(socket) || null; }
function getLatestRoom(socket){ return latestRooms.get(socket) || null; }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function randUser(prefix){ return prefix + Math.random().toString(36).slice(2, 8); }

async function api(path, body, token){
  const headers = { "Content-Type": "application/json" };
  if(token) headers.Authorization = "Bearer " + token;
  const r = await fetch(URL + "/api" + path, {
    method: "POST", headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch(e) { j = null; }
  return { status: r.status, body: j };
}

async function register(username, password){
  const r = await api("/auth/register", { username, password });
  if(r.status !== 200) throw new Error("register failed " + r.status);
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
    const t = setTimeout(() => reject(new Error("timeout " + event)), timeout);
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
    const t = setTimeout(() => { socket.off("game:state", h); reject(new Error("state timeout")); }, timeout);
    function h(st){ if(predicate(st)){ clearTimeout(t); socket.off("game:state", h); resolve(st); } }
    socket.on("game:state", h);
  });
}

function getState(socket){ return Promise.resolve(getLatest(socket)); }
function findMe(state, uid){ return state && state.players ? state.players.find(p => p.uid === uid) : null; }

async function main(){
  const log = function(){ console.log("[e2e]", ...arguments); };
  const uA = randUser("qa");
  const uB = randUser("qb");

  const flags = [];
  if(DO_BOARD) flags.push("board");
  if(DO_TRIPLE) flags.push("triple");
  if(DO_UPGRADE) flags.push("upgrade");
  if(DO_RECONNECT) flags.push("reconnect");
  if(DO_CARDS) flags.push("cards");
  if(DO_AI) flags.push("ai");
  log("URL", URL, flags.length ? "(" + flags.join("+") + ")" : "");

  log("register", uA, uB);
  const A = await register(uA, PASSWORD);
  const B = await register(uB, PASSWORD);
  const uidA = A.user.id;
  const uidB = B.user.id;
  log("uid A=" + uidA, "B=" + uidB);

  const connA = await connect(A.token);
  const connB = await connect(B.token);
  let sa = connA.socket;
  const sb = connB.socket;
  await sleep(200);
  log("socket connected");

  const cRes = await emitAck(sa, "room:create", { name: "e2e-" + Date.now() });
  if(!cRes.ok) throw new Error("create failed");
  const roomId = cRes.room.id;
  log("room created", roomId);

  const jRes = await emitAck(sb, "room:join", { id: roomId });
  if(!jRes.ok) throw new Error("join failed");
  log("B joined");

  await emitAck(sb, "room:ready", { ready: true });
  log("B ready");

  const startRes = await emitAck(sa, "room:start");
  if(!startRes.ok) throw new Error("start failed");
  await waitState(sa, s => s.turn === 1 && s.phase === "prepare");
  await waitState(sb, s => s.turn === 1 && s.phase === "prepare");
  let stA = await getState(sa);
  let stB = await getState(sb);
  log("game start");
  log("players count =", stA.players.length);
  stA.players.forEach(function(p, i){
    log("  [" + i + "] uid=" + p.uid + " name=" + p.username + (p.isAI ? " (AI)" : ""));
  });

  let aiOk = true;
  let boardOk = true;
  let upgradeOk = true;
  let cardsOk = true;
  let tripleOk = true;
  let reconnectOk = true;

  if(DO_AI){
    console.log("---------- AI TEST ----------");
    // \\u68c0\\u67e5 8 \\u4eba + 7 AI
    const players = stA.players;
    const aiCount = players.filter(p => p.isAI).length;
    const humanCount = players.filter(p => !p.isAI).length;
    log("total players =", players.length, " AI =", aiCount, " human =", humanCount);
    const aiNames = players.filter(p => p.isAI).map(p => p.username).sort();
    log("AI names:", aiNames.join(", "));

    // \\u9a8c\\u8bc1\\uff1a8 \\u4eba\\uff0c2 \\u771f\\u4eba\\uff0c6 AI
    const eightOk = players.length === 8;
    const twoHuman = humanCount === 2;
    const sixAI = aiCount === 6;
    const namesOk = aiNames.length === 6 && aiNames[0] === "AI-1";

    log("8 players =", eightOk, " 2 human =", twoHuman, " 6 AI =", sixAI);
    log("AI names look right =", namesOk);

    // \\u771f\\u4eba A \\u7ed3\\u675f\\u56de\\u5408\\uff0cAI \\u5e94\\u8be5\\u81ea\\u52a8 ready
    // \\u4f46 B \\u8fd8\\u672a ready\\uff0c\\u6240\\u4ee5\\u8fd8\\u4e0d\\u4f1a\\u89e6\\u53d1\\u6218\\u6597
    const endA = await emitAck(sa, "game:endTurn");
    if(!endA.ok) throw new Error("A endTurn failed");
    await sleep(300);
    const stMid = await getState(sa);
    const aiAllReady = stMid.players.filter(p => p.isAI).every(p => p.ready);
    const aReady = findMe(stMid, uidA).ready;
    const bReady = findMe(stMid, uidB).ready;
    log("after A endTurn: A ready=" + aReady + " B ready=" + bReady + " AI all ready=" + aiAllReady);

    // B \\u7ed3\\u675f\\uff0c\\u89e6\\u53d1\\u6218\\u6597
    const wb = once(sa, "game:battle", 10000);
    const endB = await emitAck(sb, "game:endTurn");
    if(!endB.ok) throw new Error("B endTurn failed");
    const battle = await wb;
    log("battle pairings =", battle.pairings.length, " (expect 4 for 8 players)");

    // \\u6218\\u6597\\u540e\\u56de\\u5230 T2\\uff0cAI \\u5e94\\u8be5 ready=false
    await sleep(400);
    const stT2 = await getState(sa);
    const aiReadyAfterBattle = stT2.players.filter(p => p.isAI).every(p => p.ready === false);
    log("T2: AI ready reset =", aiReadyAfterBattle, " turn =", stT2.turn);

    aiOk = eightOk && twoHuman && sixAI && namesOk && aiAllReady && aReady
        && battle.pairings.length === 4 && stT2.turn === 2 && aiReadyAfterBattle;
    console.log(aiOk ? "  ai PASS" : "  ai FAIL");
    console.log("---------------------------------");
    console.log("");
  }

  // \\u57fa\\u7840\\u6d41\\u7a0b\\u6d4b\\u8bd5\\uff08\\u4ec5\\u5f53\\u4e0d\\u662f --ai \\u6a21\\u5f0f\\u65f6\\uff09
  if(!DO_AI){
    // \\u5404\\u4e70 1 \\u5f20
    const buyA = await emitAck(sa, "game:buy", { slot: 0 });
    if(!buyA.ok) throw new Error("A buy failed");
    await waitState(sa, s => { const m = findMe(s, uidA); return m && m.hand.length === 1; });
    log("A bought:", findMe(await getState(sa), uidA).hand.length);

    const buyB = await emitAck(sb, "game:buy", { slot: 0 });
    if(!buyB.ok) throw new Error("B buy failed");
    await waitState(sb, s => { const m = findMe(s, uidB); return m && m.hand.length === 1; });

    // UPGRADE
    if(DO_UPGRADE){
      console.log("---------- UPGRADE TEST ----------");
      // \\u6525\\u94b1
      let st = await getState(sa);
      while(findMe(st, uidA).gold < 5){
        const wb = once(sa, "game:battle", 10000);
        const wb2 = once(sb, "game:battle", 10000);
        let stNow = await getState(sa);
        if(!findMe(stNow, uidA).ready){
          const r = await emitAck(sa, "game:endTurn");
          if(!r.ok) throw new Error("grind A endTurn failed");
        }
        let stNow2 = await getState(sb);
        if(!findMe(stNow2, uidB).ready){
          const r2 = await emitAck(sb, "game:endTurn");
          if(!r2.ok) throw new Error("grind B endTurn failed");
        }
        await wb; await wb2;
        await sleep(300);
        st = await getState(sa);
      }
      log("gold =", findMe(st, uidA).gold);
      const wu = once(sa, "game:upgraded", 5000);
      const r = await emitAck(sa, "game:upgrade");
      if(!r.ok) throw new Error("upgrade failed " + r.error);
      const evt = await wu;
      log("upgraded newTier=" + evt.newTier);
      upgradeOk = evt.newTier === 2;
      console.log(upgradeOk ? "  upgrade PASS" : "  upgrade FAIL");
      console.log("---------------------------------");
      console.log("");
    }

    // BOARD
    if(DO_BOARD){
      console.log("---------- BOARD TEST ----------");
      const st = await getState(sa);
      const me = findMe(st, uidA);
      if(me.hand.length === 0){
        log("A no hand, skip board");
        boardOk = false;
      } else {
        const r = await emitAck(sa, "game:place", { handIndex: 0 });
        if(!r.ok) throw new Error("place failed");
        await waitState(sa, s => { const m = findMe(s, uidA); return m && m.board.length === 1; });
        log("placed, board=1");
        const r2 = await emitAck(sa, "game:remove", { boardIndex: 0 });
        if(!r2.ok) throw new Error("remove failed");
        await waitState(sa, s => { const m = findMe(s, uidA); return m && m.board.length === 0; });
        log("removed, board=0");
        boardOk = true;
      }
      console.log(boardOk ? "  board PASS" : "  board FAIL");
      console.log("---------------------------------");
      console.log("");
    }

    // CARDS
    if(DO_CARDS){
      console.log("---------- CARDS TEST ----------");
      const r = await emitAck(sa, "game:debug-keyword");
      if(!r.ok) throw new Error("debug-keyword failed");
      await waitState(sa, s => {
        const m = findMe(s, uidA);
        return m && m.hand && m.hand.length === 1 && m.hand[0].keywords && m.hand[0].keywords.length > 0;
      });
      const st = await getState(sa);
      const card = findMe(st, uidA).hand[0];
      log("keyword card:", card.name, card.keywords.join(","));
      cardsOk = Array.isArray(card.keywords) && card.keywords.includes("Taunt") && card.keywords.includes("Shield");
      console.log(cardsOk ? "  cards PASS" : "  cards FAIL");
      console.log("---------------------------------");
      console.log("");
    }

    // TRIPLE
    if(DO_TRIPLE){
      console.log("---------- TRIPLE TEST ----------");
      const wt = once(sa, "game:triple", 5000);
      const r = await emitAck(sa, "game:debug-triple");
      if(!r.ok) throw new Error("debug-triple failed");
      const evt = await wt;
      log("triple event: " + evt.name + " " + evt.attack + "/" + evt.hp);
      tripleOk = !!evt && evt.attack >= 2;
      console.log(tripleOk ? "  triple PASS" : "  triple FAIL");
      console.log("---------------------------------");
      console.log("");
    }

    // RECONNECT
    if(DO_RECONNECT){
      console.log("---------- RECONNECT TEST ----------");
      const stBefore = await getState(sa);
      const meBefore = findMe(stBefore, uidA);
      log("before reconnect:", "gold=" + meBefore.gold + " hp=" + meBefore.hp + " turn=" + stBefore.turn);

      sa.disconnect();
      await sleep(800);
      const connA2 = await connect(A.token);
      const sa2 = connA2.socket;
      await sleep(200);
      const rj = await emitAck(sa2, "room:rejoin");
      if(!rj.ok) throw new Error("rejoin failed");
      const stAfter = await waitState(sa2, s => s.turn === stBefore.turn, 5000);
      const meAfter = findMe(stAfter, uidA);
      reconnectOk = meBefore.gold === meAfter.gold && meBefore.hp === meAfter.hp;
      log("after reconnect: gold=" + meAfter.gold + " hp=" + meAfter.hp);
      console.log(reconnectOk ? "  reconnect PASS" : "  reconnect FAIL");
      console.log("---------------------------------");
      console.log("");
      sa = sa2;
    }
  }

  console.log("");
  console.log("========== REPORT ==========");
  console.log("room:", roomId);
  console.log("board:", boardOk ? "PASS" : (DO_BOARD ? "FAIL" : "skip"));
  console.log("upgrade:", upgradeOk ? "PASS" : (DO_UPGRADE ? "FAIL" : "skip"));
  console.log("triple:", tripleOk ? "PASS" : (DO_TRIPLE ? "FAIL" : "skip"));
  console.log("reconnect:", reconnectOk ? "PASS" : (DO_RECONNECT ? "FAIL" : "skip"));
  console.log("cards:", cardsOk ? "PASS" : (DO_CARDS ? "FAIL" : "skip"));
  console.log("ai:", aiOk ? "PASS" : (DO_AI ? "FAIL" : "skip"));
  console.log("");

  const pass = boardOk && upgradeOk && tripleOk && reconnectOk && cardsOk && aiOk;
  console.log(pass ? "PASS OK" : "FAIL");
  console.log("============================");

  try { sa.emit("room:leave"); } catch(e){}
  try { sb.emit("room:leave"); } catch(e){}
  try { sa.disconnect(); } catch(e){}
  try { sb.disconnect(); } catch(e){}

  process.exit(pass ? 0 : 1);
}

main().catch(e => {
  console.error("[e2e] ERROR:", e.message || e);
  process.exit(1);
});