import { io } from "socket.io-client";

const URL = process.env.URL || "http://localhost:3000";
const PASSWORD = "secret123";

const latestStates = new WeakMap();
function attachWatchers(s){ s.on("game:state", st => latestStates.set(s, st)); }
function getState(s){ return Promise.resolve(latestStates.get(s) || null); }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function randUser(p){ return p + Math.random().toString(36).slice(2, 8); }
function findMe(st, uid){ return st && st.players ? st.players.find(p => p.uid === uid) : null; }

async function api(path, body, token){
  const headers = { "Content-Type": "application/json" };
  if(token) headers.Authorization = "Bearer " + token;
  const r = await fetch(URL + "/api" + path, { method: "POST", headers, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch(e){}
  return { status: r.status, body: j };
}

async function register(u, p){
  const r = await api("/auth/register", { username: u, password: p });
  if(r.status !== 200) throw new Error("register failed " + r.status);
  return r.body;
}

function connect(token){
  return new Promise((resolve, reject) => {
    const s = io(URL, { auth: { token }, reconnection: false });
    const buffer = { hello: null };
    s.on("hello", d => { buffer.hello = d; });
    attachWatchers(s);
    const t = setTimeout(() => reject(new Error("connect timeout")), 8000);
    s.on("connect", () => { clearTimeout(t); resolve({ socket: s, buffer }); });
    s.on("connect_error", e => { clearTimeout(t); reject(e); });
  });
}

function emitAck(s, event, payload){
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ack timeout " + event)), 5000);
    const cb = r => { clearTimeout(t); resolve(r); };
    if(payload === undefined) s.emit(event, cb);
    else s.emit(event, payload, cb);
  });
}

function once(s, event, ms){
  ms = ms || 8000;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout " + event)), ms);
    s.once(event, d => { clearTimeout(t); resolve(d); });
  });
}

function waitState(s, pred, ms){
  ms = ms || 6000;
  const c = latestStates.get(s);
  if(c && pred(c)) return Promise.resolve(c);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { s.off("game:state", h); reject(new Error("state timeout")); }, ms);
    function h(st){ if(pred(st)){ clearTimeout(t); s.off("game:state", h); resolve(st); } }
    s.on("game:state", h);
  });
}

async function giveCards(s, uid, cards){
  for(const c of cards){
    const r = await emitAck(s, "game:debug-card", c);
    if(!r.ok) throw new Error("give card failed " + r.error);
    await sleep(60);
  }
}

async function placeAll(s, uid){
  const st = await getState(s);
  const me = findMe(st, uid);
  const n = me.hand.length;
  for(let i = 0; i < n; i++){
    const r = await emitAck(s, "game:place", { handIndex: 0 });
    if(!r.ok) throw new Error("place failed " + r.error);
    await sleep(80);
  }
}

async function runCase(sa, sb, uidA, uidB, name, data){
  console.log("");
  console.log("---------- CASE: " + name + " ----------");

  let r = await emitAck(sa, "game:debug-clear");
  if(!r.ok) throw new Error("clear A failed");
  await sleep(120);
  r = await emitAck(sb, "game:debug-clear");
  if(!r.ok) throw new Error("clear B failed");
  await sleep(120);

  await giveCards(sa, uidA, data.aCards || []);
  await giveCards(sb, uidB, data.bCards || []);

  await placeAll(sa, uidA);
  await placeAll(sb, uidB);

  const wbA = once(sa, "game:battle", 10000);
  const wbB = once(sb, "game:battle", 10000);

  const eA = await emitAck(sa, "game:endTurn");
  if(!eA.ok) throw new Error("A endTurn failed " + eA.error);
  const eB = await emitAck(sb, "game:endTurn");
  if(!eB.ok) throw new Error("B endTurn failed " + eB.error);

  const battle = await wbA;
  await wbB;
  await sleep(200);

  const logs = [];
  battle.pairings.forEach(p => (p.battleLog || []).forEach(l => logs.push(l)));
  logs.forEach(l => console.log("    " + l));

  const ok = data.check(logs, battle);
  console.log(ok ? "  " + name + " PASS" : "  " + name + " FAIL");
  return ok;
}

async function main(){
  const uA = randUser("ka");
  const uB = randUser("kb");
  console.log("[kw] URL", URL);
  console.log("[kw] register", uA, uB);

  const A = await register(uA, PASSWORD);
  const B = await register(uB, PASSWORD);
  const uidA = A.user.id;
  const uidB = B.user.id;

  const cA = await connect(A.token);
  const cB = await connect(B.token);
  const sa = cA.socket, sb = cB.socket;

  await sleep(200);
  if(!cA.buffer.hello || !cB.buffer.hello) throw new Error("no hello");

  const cr = await emitAck(sa, "room:create", { name: "kw-" + Date.now() });
  if(!cr.ok) throw new Error("create failed");
  const roomId = cr.room.id;
  console.log("[kw] room", roomId);

  const jr = await emitAck(sb, "room:join", { id: roomId });
  if(!jr.ok) throw new Error("join failed");
  await emitAck(sb, "room:ready", { ready: true });
  const sr = await emitAck(sa, "room:start");
  if(!sr.ok) throw new Error("start failed");
  await waitState(sa, s => s.turn === 1 && s.phase === "prepare");
  await sleep(200);

  const results = {};

  // 1) taunt: A 上嘲讽 Wall0 + 非嘲讽 Other0，B 上 Atk
  // B 每次必须打 Wall0（不能打 Other0）
  results["taunt"] = await runCase(sa, sb, uidA, uidB, "taunt", {
    aCards: [
      { name: "Wall0", attack: 0, hp: 100, keywords: ["\u5632\u8bca"] },
      { name: "Other0", attack: 0, hp: 100, keywords: [] },
    ],
    bCards: [
      { name: "Atk", attack: 1, hp: 5, keywords: [] },
    ],
    check: (logs) => {
      const bHits = logs.filter(l => /^R\d+ Atk \u653b\u51fb /.test(l));
      if(bHits.length === 0) return false;
      return bHits.every(l => l.indexOf("Wall0") >= 0);
    },
  });

  // 2) shield: 圣盾免疫第一击，日志有"盾挡"
  results["shield"] = await runCase(sa, sb, uidA, uidB, "shield", {
    aCards: [{ name: "Shield", attack: 1, hp: 50, keywords: ["\u5723\u76fe"] }],
    bCards: [{ name: "Atk", attack: 3, hp: 3, keywords: [] }],
    check: (logs) => logs.some(l => /\u76fe\u6321/.test(l)),
  });

  // 3) poison: B 有毒卡 Poison(5/5)，A 上石头 Big0(0/200) + 辅助 Tank(0/200)
  // A 0 攻，打不死 Poison，Poison 攻击 -> 秒杀任一 A 随从
  results["poison"] = await runCase(sa, sb, uidA, uidB, "poison", {
    aCards: [
      { name: "Big0", attack: 0, hp: 200, keywords: [] },
    ],
    bCards: [
      { name: "Poison", attack: 5, hp: 50, keywords: ["\u5267\u6bd2"] },
    ],
    check: (logs) => {
      // 出现"中毒" + "Big0 阵亡"（毒必然秒杀 200 血）
      return logs.some(l => /\u4e2d\u6bd2/.test(l)) && logs.some(l => /Big0 \u9635\u4ea1/.test(l));
    },
  });

  // 4) windfury: Wind 一次攻击 2 次
  results["windfury"] = await runCase(sa, sb, uidA, uidB, "windfury", {
    aCards: [{ name: "Wind", attack: 1, hp: 5, keywords: ["\u98ce\u6012"] }],
    bCards: [{ name: "Block", attack: 1, hp: 200, keywords: [] }],
    check: (logs) => {
      const r1 = logs.filter(l => /^R1 Wind /.test(l));
      return r1.length >= 2;
    },
  });

  console.log("");
  console.log("========== KEYWORD REPORT ==========");
  const order = ["taunt", "shield", "poison", "windfury"];
  let allPass = true;
  for(const k of order){
    console.log(k + ":", results[k] ? "PASS" : "FAIL");
    if(!results[k]) allPass = false;
  }
  console.log("");
  console.log(allPass ? "ALL KEYWORDS PASS" : "SOME KEYWORDS FAIL");
  console.log("====================================");

  try { sa.emit("room:leave"); } catch(e){}
  try { sb.emit("room:leave"); } catch(e){}
  try { sa.disconnect(); } catch(e){}
  try { sb.disconnect(); } catch(e){}

  process.exit(allPass ? 0 : 1);
}

main().catch(e => {
  console.error("[kw] ERROR:", e.message || e);
  process.exit(1);
});