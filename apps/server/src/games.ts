export interface Card {
  id: string;
  name: string;
  tier: number;
  attack: number;
  hp: number;
  golden?: boolean;
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

const CARD_POOL: Array<{ name: string; tier: number; attack: number; hp: number }> = [
  { name: "铁匠学徒", tier: 1, attack: 1, hp: 1 },
  { name: "森林鹿", tier: 1, attack: 2, hp: 2 },
  { name: "石甲卫兵", tier: 1, attack: 1, hp: 3 },
  { name: "荒野狼", tier: 2, attack: 3, hp: 2 },
  { name: "火焰法师", tier: 2, attack: 2, hp: 3 },
  { name: "暗影刺客", tier: 3, attack: 4, hp: 1 },
  { name: "白银枪骑", tier: 4, attack: 3, hp: 5 },
];

function randCard(): Card {
  const tpl = CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)];
  const uid = Math.random().toString(36).slice(2, 8);
  return { id: uid, name: tpl.name, tier: tpl.tier, attack: tpl.attack, hp: tpl.hp };
}

function randShop(): Card[] {
  const arr: Card[] = [];
  for (let i = 0; i < SHOP_SIZE; i++) arr.push(randCard());
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
        shop: randShop(),
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

function runBattle(g: GameState): BattleResult {
  const alive = g.players.filter(function (p) { return p.alive; });
  const order = shuffle(alive);
  const pairings: BattlePairing[] = [];

  for (let i = 0; i + 1 < order.length; i += 2) {
    const a = order[i];
    const b = order[i + 1];
    const ap = boardPower(a);
    const bp = boardPower(b);
    let winnerUid: number;
    let loserUid: number;
    let damage: number;

    if (ap === bp) {
      winnerUid = a.uid; loserUid = b.uid;
      damage = 1;
    } else if (ap > bp) {
      winnerUid = a.uid; loserUid = b.uid;
      damage = Math.max(1, boardAttack(a));
    } else {
      winnerUid = b.uid; loserUid = a.uid;
      damage = Math.max(1, boardAttack(b));
    }

    const loser = loserUid === a.uid ? a : b;
    loser.hp -= damage;

    pairings.push({
      aUid: a.uid, aName: a.username, aPower: ap,
      bUid: b.uid, bName: b.username, bPower: bp,
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
      x.gold = Math.min(x.gold + GOLD_PER_TURN, MAX_GOLD);
      if (!x.frozen) x.shop = randShop();
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
  p.shop = randShop();
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
    p.hand.push({
      id: Math.random().toString(36).slice(2, 8),
      name: tpl.name,
      tier: tpl.tier,
      attack: tpl.attack,
      hp: tpl.hp,
    });
  }
  const merged = mergeTriplesHand(p);
  return { ok: true, state: g, merged: merged };
}

export function removeGame(roomId: string): void {
  games.delete(roomId);
}