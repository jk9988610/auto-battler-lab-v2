export interface Card {
  id: string;
  name: string;
  tier: number;
  attack: number;
  hp: number;
  golden?: boolean;
  keywords?: string[];
}

export interface PlayerState {
  uid: number;
  username: string;
  gold: number;
  hp: number;
  ready: boolean;
  frozen: boolean;
  alive: boolean;
  shop: Card[];
  hand: Card[];
  board: Card[];
  tavernTier: number;
}

export interface GameState {
  roomId: string;
  turn: number;
  phase: "prepare" | "combat" | "over";
  players: PlayerState[];
  createdAt: number;
}

export interface BattlePairing {
  aUid: number;
  aName: string;
  aPower: number;
  bUid: number;
  bName: string;
  bPower: number;
  aBoard: Card[];
  bBoard: Card[];
  aSurvivors: Card[];
  bSurvivors: Card[];
  battleLog: string[];
  winnerUid: number;
  loserUid: number;
  damage: number;
}

export interface BattleResult {
  turn: number;
  pairings: BattlePairing[];
  eliminated: Array<{ uid: number; username: string }>;
  gameOver: boolean;
  rankings: Array<{ uid: number; username: string; rank: number }>;
}

const BUY_COST = 3;
const SELL_REFUND = 1;
const REFRESH_COST = 1;
const MAX_GOLD = 10;
const GOLD_PER_TURN = 3;
const SHOP_SIZE = 3;
const BOARD_SIZE = 7;
const MAX_TIER = 6;

const UPGRADE_COST: { [k: number]: number } = {
  1: 5,
  2: 7,
  3: 8,
  4: 9,
  5: 10,
};

const CARD_POOL: Array<{ name: string; tier: number; attack: number; hp: number; keywords?: string[] }> = [
  // T1
  { name: "\u94c1\u5320\u5b66\u5f92", tier: 1, attack: 1, hp: 1 },
  { name: "\u68ee\u6797\u9e7f", tier: 1, attack: 2, hp: 2 },
  { name: "\u77f3\u7532\u536b\u5175", tier: 1, attack: 1, hp: 3, keywords: ["\u5632\u8bca"] },
  { name: "\u6751\u5e84\u519c\u592b", tier: 1, attack: 1, hp: 2 },
  { name: "\u5c0f\u7cbe\u7075", tier: 1, attack: 2, hp: 1, keywords: ["\u98ce\u6012"] },
  { name: "\u6301\u76fe\u6b65\u5175", tier: 1, attack: 1, hp: 4, keywords: ["\u5632\u8bca"] },
  { name: "\u6bd2\u8702", tier: 1, attack: 1, hp: 1, keywords: ["\u5267\u6bd2"] },
  { name: "\u6cbb\u7597\u5e08", tier: 1, attack: 1, hp: 2 },
  // T2
  { name: "\u8352\u91ce\u72fc", tier: 2, attack: 3, hp: 2 },
  { name: "\u706b\u7130\u6cd5\u5e08", tier: 2, attack: 2, hp: 3 },
  { name: "\u77f3\u50cf\u9b3c", tier: 2, attack: 3, hp: 3, keywords: ["\u5632\u8bca"] },
  { name: "\u957f\u5251\u5175", tier: 2, attack: 4, hp: 2 },
  { name: "\u5267\u6bd2\u8718\u86db", tier: 2, attack: 2, hp: 2, keywords: ["\u5267\u6bd2"] },
  { name: "\u8f7b\u9a91\u5175", tier: 2, attack: 3, hp: 3, keywords: ["\u98ce\u6012"] },
  { name: "\u76fe\u536b", tier: 2, attack: 2, hp: 4, keywords: ["\u5723\u76fe"] },
  { name: "\u5c0f\u6cd5\u5e08", tier: 2, attack: 3, hp: 2 },
  // T3
  { name: "\u6697\u5f71\u523a\u5ba2", tier: 3, attack: 4, hp: 2 },
  { name: "\u94c1\u7532\u536b", tier: 3, attack: 3, hp: 5, keywords: ["\u5632\u8bca"] },
  { name: "\u51b0\u971c\u6cd5\u5e08", tier: 3, attack: 4, hp: 4 },
  { name: "\u6bd2\u5203\u523a\u5ba2", tier: 3, attack: 3, hp: 3, keywords: ["\u5267\u6bd2"] },
  { name: "\u5723\u5149\u9a91\u58eb", tier: 3, attack: 4, hp: 4, keywords: ["\u5723\u76fe"] },
  { name: "\u53cc\u5203\u6218\u58eb", tier: 3, attack: 4, hp: 3, keywords: ["\u98ce\u6012"] },
  { name: "\u5b88\u62a4\u5de8\u50cf", tier: 3, attack: 4, hp: 6, keywords: ["\u5632\u8bca", "\u5723\u76fe"] },
  { name: "\u5f13\u7bad\u624b", tier: 3, attack: 5, hp: 2 },
  // T4
  { name: "\u767d\u94f6\u67aa\u9a91", tier: 4, attack: 4, hp: 6, keywords: ["\u5632\u8bca"] },
  { name: "\u96f7\u970d\u9886\u4e3b", tier: 4, attack: 5, hp: 7 },
  { name: "\u6bd2\u9f99", tier: 4, attack: 5, hp: 5, keywords: ["\u5267\u6bd2"] },
  { name: "\u5723\u76fe\u62a4\u536b", tier: 4, attack: 4, hp: 8, keywords: ["\u5723\u76fe", "\u5632\u8bca"] },
  { name: "\u72c2\u6218\u58eb", tier: 4, attack: 6, hp: 5, keywords: ["\u98ce\u6012"] },
  { name: "\u91cd\u7532\u9a91\u58eb", tier: 4, attack: 5, hp: 8 },
  { name: "\u53cc\u5934\u86c7", tier: 4, attack: 5, hp: 5, keywords: ["\u98ce\u6012"] },
  { name: "\u5c60\u9b54\u8005", tier: 4, attack: 7, hp: 4 },
  // T5
  { name: "\u9f99\u9a91\u5175", tier: 5, attack: 7, hp: 7 },
  { name: "\u706b\u7130\u5143\u7d20", tier: 5, attack: 8, hp: 6 },
  { name: "\u8fdc\u53e4\u5b88\u536b", tier: 5, attack: 5, hp: 12, keywords: ["\u5632\u8bca"] },
  { name: "\u6bd2\u6db2\u9886\u4e3b", tier: 5, attack: 6, hp: 6, keywords: ["\u5267\u6bd2", "\u98ce\u6012"] },
  { name: "\u767d\u94f6\u56e2\u957f", tier: 5, attack: 6, hp: 10, keywords: ["\u5723\u76fe", "\u5632\u8bca"] },
  { name: "\u96f7\u970d\u5de8\u517d", tier: 5, attack: 8, hp: 8, keywords: ["\u98ce\u6012"] },
  { name: "\u6740\u622e\u8005", tier: 5, attack: 9, hp: 7 },
  // T6
  { name: "\u65f6\u7a7a\u9f99", tier: 6, attack: 10, hp: 10, keywords: ["\u5723\u76fe"] },
  { name: "\u6df1\u6e0a\u9b54\u541b", tier: 6, attack: 12, hp: 8 },
  { name: "\u6bd2\u7687", tier: 6, attack: 8, hp: 10, keywords: ["\u5267\u6bd2"] },
  { name: "\u94a2\u94c1\u6cf0\u5766", tier: 6, attack: 8, hp: 15, keywords: ["\u5632\u8bca", "\u5723\u76fe"] },
  { name: "\u72c2\u66b4\u6218\u795e", tier: 6, attack: 12, hp: 12, keywords: ["\u98ce\u6012"] },
  { name: "\u5deb\u5996\u738b", tier: 6, attack: 14, hp: 12 },
];

function goldForTurn(t: number): number {
  return Math.min(3 + (t - 1), MAX_GOLD);
}

function randCard(maxTier: number): Card {
  const pool = CARD_POOL.filter(function (c) { return c.tier <= maxTier; });
  const tpl = pool[Math.floor(Math.random() * pool.length)];
  const uid = Math.random().toString(36).slice(2, 8);
  const card: Card = { id: uid, name: tpl.name, tier: tpl.tier, attack: tpl.attack, hp: tpl.hp };
  if (tpl.keywords && tpl.keywords.length > 0) card.keywords = tpl.keywords.slice();
  return card;
}

function randShop(maxTier: number): Card[] {
  const arr: Card[] = [];
  for (let i = 0; i < SHOP_SIZE; i++) arr.push(randCard(maxTier));
  return arr;
}

function cardPower(c: Card): number {
  return c.attack + c.hp;
}

function boardPower(p: PlayerState): number {
  let s = 0;
  p.board.forEach(function (c) { s += cardPower(c); });
  return s;
}

function boardAttack(p: PlayerState): number {
  let s = 0;
  p.board.forEach(function (c) { s += c.attack; });
  return s;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function mergeTriplesHand(p: PlayerState): Card[] {
  const merged: Card[] = [];
  const groups = new Map<string, Card[]>();
  p.hand.forEach(function (c) {
    if (c.golden) return;
    const key = c.name + "#" + c.tier;
    if (!groups.has(key)) groups.set(key, []);
    const arr = groups.get(key)!;
    arr.push(c);
  });
  groups.forEach(function (arr) {
    while (arr.length >= 3) {
      const triple = arr.splice(0, 3);
      const base = triple[0];
      const golden: Card = {
        id: Math.random().toString(36).slice(2, 8),
        name: "金色" + base.name,
        tier: base.tier,
        attack: base.attack * 2,
        hp: base.hp * 2,
        golden: true,
      };
      const removeIds = triple.map(function (x) { return x.id; });
      p.hand = p.hand.filter(function (x) { return removeIds.indexOf(x.id) < 0; });
      p.hand.push(golden);
      merged.push(golden);
    }
  });
  return merged;
}

const games = new Map<string, GameState>();

export function startGame(roomId: string, players: { uid: number; username: string }[]): GameState {
  const state: GameState = {
    roomId: roomId,
    turn: 1,
    phase: "prepare",
    players: players.map(function (p) {
      return {
        uid: p.uid,
        username: p.username,
        gold: 3,
        hp: 40,
        ready: false,
        frozen: false,
        alive: true,
        shop: randShop(1),
        hand: [],
        board: [],
        tavernTier: 1,
      };
    }),
    createdAt: Date.now(),
  };
  games.set(roomId, state);
  return state;
}

export function getGame(roomId: string): GameState | undefined {
  return games.get(roomId);
}

function findPlayer(g: GameState, uid: number): PlayerState | undefined {
  return g.players.find(function (x) { return x.uid === uid; });
}

function simulateBoardBattle(aBoard: Card[], bBoard: Card[]): {
  winnerSide: "a" | "b" | "draw";
  damage: number;
  battleLog: string[];
  aSurvivors: Card[];
  bSurvivors: Card[];
} {
  type BattleCard = Card & { shield?: boolean };
  function mk(c: Card): BattleCard {
    const b: BattleCard = { id: c.id, name: c.name, tier: c.tier, attack: c.attack, hp: c.hp };
    if (c.golden) b.golden = c.golden;
    if (c.keywords) b.keywords = c.keywords.slice();
    if (b.keywords && b.keywords.indexOf("\u5723\u76fe") >= 0) b.shield = true;
    return b;
  }
  const A: BattleCard[] = aBoard.map(mk);
  const B: BattleCard[] = bBoard.map(mk);
  const battleLog: string[] = [];
  const MAX_ROUNDS = 30;
  let round = 0;

  function hasKw(c: BattleCard, kw: string): boolean {
    return !!(c.keywords && c.keywords.indexOf(kw) >= 0);
  }

  function pickTarget(enemy: BattleCard[]): BattleCard {
    for (let i = 0; i < enemy.length; i++) {
      if (hasKw(enemy[i], "\u5632\u8bca")) return enemy[i];
    }
    return enemy[0];
  }

  function strike(attacker: BattleCard, defender: BattleCard, round: number): boolean {
    if (defender.shield) {
      defender.shield = false;
      battleLog.push("R" + round + " " + attacker.name + " \u653b\u51fb " + defender.name + " (\u76fe\u6321)");
      return false;
    }
    const isPoison = hasKw(attacker, "\u5267\u6bd2");
    const before = defender.hp;
    defender.hp -= attacker.attack;
    battleLog.push("R" + round + " " + attacker.name + " \u653b\u51fb " + defender.name + " (" + before + "->" + defender.hp + ")");
    if (isPoison && defender.hp > 0) {
      defender.hp = 0;
      battleLog.push("R" + round + " " + defender.name + " \u4e2d\u6bd2");
    }
    if (defender.hp <= 0) {
      battleLog.push(defender.name + " \u9635\u4ea1");
      return true;
    }
    return false;
  }

  while (A.length > 0 && B.length > 0 && round < MAX_ROUNDS) {
    round += 1;
    if (A.length > 0 && B.length > 0) {
      const atkA = A[0];
      const wind = hasKw(atkA, "\u98ce\u6012") ? 2 : 1;
      for (let i = 0; i < wind; i++) {
        if (B.length === 0) break;
        const defB = pickTarget(B);
        const died = strike(atkA, defB, round);
        if (died) {
          const idx = B.indexOf(defB);
          if (idx >= 0) B.splice(idx, 1);
        }
      }
    }
    if (A.length === 0 || B.length === 0) break;
    if (A.length > 0 && B.length > 0) {
      const atkB = B[0];
      const wind = hasKw(atkB, "\u98ce\u6012") ? 2 : 1;
      for (let i = 0; i < wind; i++) {
        if (A.length === 0) break;
        const defA = pickTarget(A);
        const died = strike(atkB, defA, round);
        if (died) {
          const idx = A.indexOf(defA);
          if (idx >= 0) A.splice(idx, 1);
        }
      }
    }
  }

  function cleanShield(arr: BattleCard[]): Card[] {
    return arr.map(function (c) {
      const x: Card = { id: c.id, name: c.name, tier: c.tier, attack: c.attack, hp: c.hp };
      if (c.golden) x.golden = c.golden;
      if (c.keywords) x.keywords = c.keywords.slice();
      return x;
    });
  }

  const aAlive = A.length > 0;
  const bAlive = B.length > 0;

  if (aAlive && !bAlive) {
    let dmg = 0;
    A.forEach(function (c) { dmg += c.attack; });
    return { winnerSide: "a", damage: Math.max(1, dmg), battleLog: battleLog, aSurvivors: cleanShield(A), bSurvivors: [] };
  }
  if (bAlive && !aAlive) {
    let dmg = 0;
    B.forEach(function (c) { dmg += c.attack; });
    return { winnerSide: "b", damage: Math.max(1, dmg), battleLog: battleLog, aSurvivors: [], bSurvivors: cleanShield(B) };
  }
  return { winnerSide: "draw", damage: 1, battleLog: battleLog, aSurvivors: cleanShield(A), bSurvivors: cleanShield(B) };
}

function runBattle(g: GameState): BattleResult {
  const alive = g.players.filter(function (p) { return p.alive; });
  const order = shuffle(alive);
  const pairings: BattlePairing[] = [];

  for (let i = 0; i + 1 < order.length; i += 2) {
    const a = order[i];
    const b = order[i + 1];
    const sim = simulateBoardBattle(a.board, b.board);
    const ap = boardPower(a);
    const bp = boardPower(b);
    let winnerUid: number;
    let loserUid: number;
    let damage: number;

    if (sim.winnerSide === "draw") {
      winnerUid = a.uid; loserUid = b.uid;
      damage = 1;
    } else if (sim.winnerSide === "a") {
      winnerUid = a.uid; loserUid = b.uid;
      damage = sim.damage;
    } else {
      winnerUid = b.uid; loserUid = a.uid;
      damage = sim.damage;
    }

    const loser = loserUid === a.uid ? a : b;
    loser.hp -= damage;

    pairings.push({
      aUid: a.uid, aName: a.username, aPower: ap,
      bUid: b.uid, bName: b.username, bPower: bp,
      aBoard: a.board.slice(),
      bBoard: b.board.slice(),
      aSurvivors: sim.aSurvivors,
      bSurvivors: sim.bSurvivors,
      battleLog: sim.battleLog,
      winnerUid: winnerUid, loserUid: loserUid, damage: damage,
    });
  }

  const eliminated: Array<{ uid: number; username: string }> = [];
  g.players.forEach(function (p) {
    if (p.alive && p.hp <= 0) {
      p.alive = false;
      p.hp = 0;
      p.ready = true;
      eliminated.push({ uid: p.uid, username: p.username });
    }
  });

  const aliveLeft = g.players.filter(function (p) { return p.alive; });
  const gameOver = aliveLeft.length <= 1;
  const rankings: Array<{ uid: number; username: string; rank: number }> = [];

  if (gameOver) {
    g.phase = "over";
    const dead = g.players
      .filter(function (p) { return !p.alive; })
      .sort(function (x, y) { return x.hp - y.hp; });
    let rank = g.players.length;
    dead.forEach(function (p) {
      rankings.push({ uid: p.uid, username: p.username, rank: rank });
      rank -= 1;
    });
    if (aliveLeft.length === 1) {
      rankings.push({ uid: aliveLeft[0].uid, username: aliveLeft[0].username, rank: 1 });
    }
    rankings.sort(function (x, y) { return x.rank - y.rank; });
  }

  return { turn: g.turn, pairings: pairings, eliminated: eliminated, gameOver: gameOver, rankings: rankings };
}

export function playerEndTurn(
  roomId: string,
  uid: number
): { ok: boolean; error?: string; state?: GameState; battle?: BattleResult } {
  const g = games.get(roomId);
  if (!g) return { ok: false, error: "no game" };
  if (g.phase === "over") return { ok: false, error: "game over" };
  const p = findPlayer(g, uid);
  if (!p) return { ok: false, error: "not in game" };
  if (!p.alive) return { ok: false, error: "eliminated" };
  p.ready = true;

  const allReady = g.players.every(function (x) { return !x.alive || x.ready; });
  if (!allReady) return { ok: true, state: g };

  g.phase = "combat";
  const battle = runBattle(g);

  if (!battle.gameOver) {
    g.turn += 1;
    g.phase = "prepare";
    g.players.forEach(function (x) {
      if (!x.alive) return;
      x.ready = false;
      x.gold = Math.min(x.gold + goldForTurn(g.turn), MAX_GOLD);
      if (!x.frozen) x.shop = randShop(x.tavernTier);
      x.frozen = false;
    });
  }

  return { ok: true, state: g, battle: battle };
}

export function playerBuy(
  roomId: string,
  uid: number,
  slot: number
): { ok: boolean; error?: string; state?: GameState; merged?: Card[] } {
  const g = games.get(roomId);
  if (!g) return { ok: false, error: "no game" };
  const p = findPlayer(g, uid);
  if (!p) return { ok: false, error: "not in game" };
  if (!p.alive) return { ok: false, error: "eliminated" };
  if (slot < 0 || slot >= p.shop.length) return { ok: false, error: "invalid slot" };
  if (p.gold < BUY_COST) return { ok: false, error: "not enough gold" };
  const card = p.shop[slot];
  p.gold -= BUY_COST;
  p.shop.splice(slot, 1);
  p.hand.push(card);
  const merged = mergeTriplesHand(p);
  return { ok: true, state: g, merged: merged };
}

export function playerSell(
  roomId: string,
  uid: number,
  handIndex: number
): { ok: boolean; error?: string; state?: GameState } {
  const g = games.get(roomId);
  if (!g) return { ok: false, error: "no game" };
  const p = findPlayer(g, uid);
  if (!p) return { ok: false, error: "not in game" };
  if (handIndex < 0 || handIndex >= p.hand.length) return { ok: false, error: "invalid index" };
  p.hand.splice(handIndex, 1);
  p.gold = Math.min(p.gold + SELL_REFUND, MAX_GOLD);
  return { ok: true, state: g };
}

export function playerPlace(
  roomId: string,
  uid: number,
  handIndex: number
): { ok: boolean; error?: string; state?: GameState } {
  const g = games.get(roomId);
  if (!g) return { ok: false, error: "no game" };
  const p = findPlayer(g, uid);
  if (!p) return { ok: false, error: "not in game" };
  if (handIndex < 0 || handIndex >= p.hand.length) return { ok: false, error: "invalid index" };
  if (p.board.length >= BOARD_SIZE) return { ok: false, error: "board full" };
  const card = p.hand.splice(handIndex, 1)[0];
  p.board.push(card);
  return { ok: true, state: g };
}

export function playerRemove(
  roomId: string,
  uid: number,
  boardIndex: number
): { ok: boolean; error?: string; state?: GameState } {
  const g = games.get(roomId);
  if (!g) return { ok: false, error: "no game" };
  const p = findPlayer(g, uid);
  if (!p) return { ok: false, error: "not in game" };
  if (boardIndex < 0 || boardIndex >= p.board.length) return { ok: false, error: "invalid index" };
  const card = p.board.splice(boardIndex, 1)[0];
  p.hand.push(card);
  return { ok: true, state: g };
}

export function playerRefresh(roomId: string, uid: number): { ok: boolean; error?: string; state?: GameState } {
  const g = games.get(roomId);
  if (!g) return { ok: false, error: "no game" };
  const p = findPlayer(g, uid);
  if (!p) return { ok: false, error: "not in game" };
  if (p.frozen) return { ok: false, error: "shop is frozen" };
  if (p.gold < REFRESH_COST) return { ok: false, error: "not enough gold" };
  p.gold -= REFRESH_COST;
  p.shop = randShop(p.tavernTier);
  return { ok: true, state: g };
}

export function playerFreeze(roomId: string, uid: number): { ok: boolean; error?: string; state?: GameState } {
  const g = games.get(roomId);
  if (!g) return { ok: false, error: "no game" };
  const p = findPlayer(g, uid);
  if (!p) return { ok: false, error: "not in game" };
  p.frozen = !p.frozen;
  return { ok: true, state: g };
}

export function playerUpgrade(
  roomId: string,
  uid: number
): { ok: boolean; error?: string; state?: GameState; cost?: number; newTier?: number } {
  const g = games.get(roomId);
  if (!g) return { ok: false, error: "no game" };
  const p = findPlayer(g, uid);
  if (!p) return { ok: false, error: "not in game" };
  if (!p.alive) return { ok: false, error: "eliminated" };
  if (p.tavernTier >= MAX_TIER) return { ok: false, error: "max tier" };
  const cost = UPGRADE_COST[p.tavernTier];
  if (p.gold < cost) return { ok: false, error: "not enough gold" };
  p.gold -= cost;
  p.tavernTier += 1;
  return { ok: true, state: g, cost: cost, newTier: p.tavernTier };
}

export function debugForceTriple(
  roomId: string,
  uid: number
): { ok: boolean; error?: string; state?: GameState; merged?: Card[] } {
  const g = games.get(roomId);
  if (!g) return { ok: false, error: "no game" };
  const p = findPlayer(g, uid);
  if (!p) return { ok: false, error: "not in game" };
  const tpl = CARD_POOL[0];
  p.hand = [];
  for (let i = 0; i < 3; i++) {
    const c: Card = {
      id: Math.random().toString(36).slice(2, 8),
      name: tpl.name,
      tier: tpl.tier,
      attack: tpl.attack,
      hp: tpl.hp,
    };
    if (tpl.keywords && tpl.keywords.length > 0) c.keywords = tpl.keywords.slice();
    p.hand.push(c);
  }
  const merged = mergeTriplesHand(p);
  return { ok: true, state: g, merged: merged };
}

export function debugGiveKeywordCard(
  roomId: string,
  uid: number
): { ok: boolean; error?: string; state?: GameState } {
  const g = games.get(roomId);
  if (!g) return { ok: false, error: "no game" };
  const p = findPlayer(g, uid);
  if (!p) return { ok: false, error: "not in game" };
  p.hand = [{
    id: Math.random().toString(36).slice(2, 8),
    name: "Stone Guard",
    tier: 1,
    attack: 1,
    hp: 3,
    keywords: ["Taunt", "Shield"],
  }];
  return { ok: true, state: g };
}

export function debugGiveCustomCard(
  roomId: string,
  uid: number,
  payload: { name: string; attack: number; hp: number; keywords?: string[] }
): { ok: boolean; error?: string; state?: GameState } {
  const g = games.get(roomId);
  if (!g) return { ok: false, error: "no game" };
  const p = findPlayer(g, uid);
  if (!p) return { ok: false, error: "not in game" };
  const c: Card = {
    id: Math.random().toString(36).slice(2, 8),
    name: payload.name || "Test",
    tier: 1,
    attack: (payload.attack === undefined ? 1 : payload.attack),
    hp: (payload.hp === undefined ? 1 : payload.hp),
  };
  if (payload.keywords && payload.keywords.length) c.keywords = payload.keywords.slice();
  p.hand.push(c);
  return { ok: true, state: g };
}

export function debugClearBoard(
  roomId: string,
  uid: number
): { ok: boolean; error?: string; state?: GameState } {
  const g = games.get(roomId);
  if (!g) return { ok: false, error: "no game" };
  const p = findPlayer(g, uid);
  if (!p) return { ok: false, error: "not in game" };
  p.hand = [];
  p.board = [];
  p.ready = false;
  return { ok: true, state: g };
}

export function removeGame(roomId: string): void {
  games.delete(roomId);
}