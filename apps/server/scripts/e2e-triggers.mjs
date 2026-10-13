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
  ms = ms || 10000;
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

async function clearBoth(sa, sb){
  const r1 = await emitAck(sa, "game:debug-clear");
  if(!r1.ok) throw new Error("clear A failed");
  await sleep(80);
  const r2 = await emitAck(sb, "game:debug-clear");
  if(!r2.ok) throw new Error("clear B failed");
  await sleep(80);
}

async function giveCard(s, card){
  const r = await emitAck(s, "game:debug-card", card);
  if(!r.ok) throw new Error("give card failed " + r.error);
  await sleep(80);
}

async function placeFirst(s){
  const r = await emitAck(s, "game:place", { handIndex: 0 });
  if(!r.ok) throw new Error("place failed " + r.error);
  await sleep(100);
}

async function fight(sa, sb){
  const wbA = once(sa, "game:battle", 12000);
  const wbB = once(sb, "game:battle", 12000);
  const eA = await emitAck(sa, "game:endTurn");
  if(!eA.ok) throw new Error("A endTurn failed " + eA.error);
  const eB = await emitAck(sb, "game:endTurn");
  if(!eB.ok) throw new Error("B endTurn failed " + eB.error);
  const battle = await wbA;
  await wbB;
  await sleep(200);
  const logs = [];
  battle.pairings.forEach(p => (p.battleLog || []).forEach(l => logs.push(l)));
  return logs;
}

async function main(){
  const uA = randUser("ta");
  const uB = randUser("tb");
  console.log("[trig] URL", URL);
  console.log("[trig] register", uA, uB);

  const A = await register(uA, PASSWORD);
  const B = await register(uB, PASSWORD);
  const uidA = A.user.id;
  const uidB = B.user.id;

  const cA = await connect(A.token);
  const cB = await connect(B.token);
  const sa = cA.socket, sb = cB.socket;
  await sleep(200);
  if(!cA.buffer.hello || !cB.buffer.hello) throw new Error("no hello");

  const cr = await emitAck(sa, "room:create", { name: "trig-" + Date.now() });
  if(!cr.ok) throw new Error("create failed");
  console.log("[trig] room", cr.room.id);
  const jr = await emitAck(sb, "room:join", { id: cr.room.id });
  if(!jr.ok) throw new Error("join failed");
  await emitAck(sb, "room:ready", { ready: true });
  const sr = await emitAck(sa, "room:start");
  if(!sr.ok) throw new Error("start failed");
  await waitState(sa, s => s.turn === 1 && s.phase === "prepare");
  await sleep(200);

  const results = {};

  // ---------- 1. battlecry buff_all ----------
  console.log("");
  console.log("---------- CASE: battlecry_buff ----------");
  {
    await clearBoth(sa, sb);
    // A 先上 Target
    await giveCard(sa, { name: "Target", attack: 5, hp: 5 });
    await placeFirst(sa);
    // A 再上 Buff 触发战吼
    await giveCard(sa, { name: "Buff", attack: 2, hp: 2, battlecry: { type: "buff_all", value: 3 } });
    await placeFirst(sa);
    await sleep(200);
    const st = await getState(sa);
    const me = findMe(st, uidA);
    const target = me.board.find(c => c.name === "Target");
    const buff = me.board.find(c => c.name === "Buff");
    console.log("    Target =", target ? (target.attack + "/" + target.hp) : "missing");
    console.log("    Buff =", buff ? (buff.attack + "/" + buff.hp) : "missing");
    // Target 上阵时 5/5，Buff 上阵触发 +3/+3 -> Target 8/8，Buff 自己不动
    const ok = target && target.attack === 8 && target.hp === 8
            && buff && buff.attack === 2 && buff.hp === 2;
    results["battlecry_buff"] = ok;
    console.log(ok ? "  battlecry_buff PASS" : "  battlecry_buff FAIL");
  }

  // ---------- 2. battlecry dmg_enemy ----------
  console.log("");
  console.log("---------- CASE: battlecry_dmg ----------");
  {
    await clearBoth(sa, sb);
    // B 先上 Victim
    await giveCard(sb, { name: "Victim", attack: 0, hp: 20 });
    await placeFirst(sb);
    // A 上 Boom 触发对敌方全体 5 伤
    await giveCard(sa, { name: "Boom", attack: 1, hp: 1, battlecry: { type: "dmg_enemy", value: 5 } });
    await placeFirst(sa);
    await sleep(200);
    const stB = await getState(sb);
    const meB = findMe(stB, uidB);
    const victim = meB.board.find(c => c.name === "Victim");
    console.log("    Victim =", victim ? (victim.attack + "/" + victim.hp) : "missing");
    const ok = victim && victim.hp === 15;
    results["battlecry_dmg"] = ok;
    console.log(ok ? "  battlecry_dmg PASS" : "  battlecry_dmg FAIL");
  }

  // ---------- 3. deathrattle dmg_enemy ----------
  console.log("");
  console.log("---------- CASE: deathrattle_dmg ----------");
  {
    await clearBoth(sa, sb);
    // A 上 Venge(10/1) 带亡语
    await giveCard(sa, { name: "Venge", attack: 0, hp: 1, deathrattle: { type: "dmg_enemy", value: 5 } });
    await placeFirst(sa);
    // B 上 Killer(20/5) + Backup(0/20)
    await giveCard(sb, { name: "Killer", attack: 20, hp: 50 });
    await placeFirst(sb);
    await giveCard(sb, { name: "Backup", attack: 0, hp: 20 });
    await placeFirst(sb);

    const logs = await fight(sa, sb);
    logs.forEach(l => console.log("    " + l));
    const hasDR = logs.some(l => /亡语/.test(l));
    results["deathrattle_dmg"] = hasDR;
    console.log(hasDR ? "  deathrattle_dmg PASS" : "  deathrattle_dmg FAIL");
  }

  // ---------- 4. deathrattle summon ----------
  console.log("");
  console.log("---------- CASE: deathrattle_summon ----------");
  {
    await clearBoth(sa, sb);
    await giveCard(sa, { name: "SQ", attack: 1, hp: 1, deathrattle: { type: "summon", atk: 2, hp: 2 } });
    await placeFirst(sa);
    await giveCard(sb, { name: "Killer", attack: 10, hp: 50 });
    await placeFirst(sb);

    const logs = await fight(sa, sb);
    logs.forEach(l => console.log("    " + l));
    const hasSummon = logs.some(l => /召唤/.test(l));
    results["deathrattle_summon"] = hasSummon;
    console.log(hasSummon ? "  deathrattle_summon PASS" : "  deathrattle_summon FAIL");
  }

  console.log("");
  console.log("========== TRIGGER REPORT ==========");
  const order = ["battlecry_buff", "battlecry_dmg", "deathrattle_dmg", "deathrattle_summon"];
  let allPass = true;
  for(const k of order){
    console.log(k + ":", results[k] ? "PASS" : "FAIL");
    if(!results[k]) allPass = false;
  }
  console.log("");
  console.log(allPass ? "ALL TRIGGERS PASS" : "SOME TRIGGERS FAIL");
  console.log("====================================");

  try { sa.emit("room:leave"); } catch(e){}
  try { sb.emit("room:leave"); } catch(e){}
  try { sa.disconnect(); } catch(e){}
  try { sb.disconnect(); } catch(e){}

  process.exit(allPass ? 0 : 1);
}

main().catch(e => {
  console.error("[trig] ERROR:", e.message || e);
  process.exit(1);
});