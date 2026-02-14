// src/lib/duelStore.ts

export type DuelPhase = "lobby" | "countdown" | "waiting_random" | "go" | "finished";

export type Duel = {
  duelId: string;
  stakeLamports: number;
  feeBps: number;

  createdBy: string;
  joinedBy?: string;

  createdAt: number;
  updatedAt: number;

  phase: DuelPhase;

  revealAt?: number;
  goAt?: number;

  clickA?: number;
  clickB?: number;

  falseA?: boolean;
  falseB?: boolean;

  winner?: "A" | "B";

  paidA?: boolean;
  paidB?: boolean;
  paySigA?: string;
  paySigB?: string;

  payoutSig?: string;
  finishedAt?: number;

  readyA?: boolean;
  readyB?: boolean;
  readyDeadlineAt?: number;

  firstClickAt?: number;
  finalizeAt?: number;

  _historyRecorded?: boolean;
};

type RedisEnv = { url: string; token: string };

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`MISSING_ENV:${name}`);
  return v;
}

function redisEnv(): RedisEnv {
  return {
    url: mustEnv("UPSTASH_REDIS_REST_URL"),
    token: mustEnv("UPSTASH_REDIS_REST_TOKEN"),
  };
}

/**
 * ✅ Upstash "Read Your Writes" sync token
 * This reduces stale reads from read replicas between subsequent requests
 * on the same warm serverless instance.
 *
 * Docs: https://upstash.com/docs/redis/howto/readyourwrites
 */
let _syncToken: string | undefined;

async function redis<T>(command: string, ...args: any[]): Promise<T> {
  const { url, token } = redisEnv();
  const path = `${url}/${command}/${args.map((a) => encodeURIComponent(String(a))).join("/")}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  if (_syncToken) headers["upstash-sync-token"] = _syncToken;

  const res = await fetch(path, {
    headers,
    cache: "no-store",
  });

  const newToken = res.headers.get("upstash-sync-token");
  if (newToken) _syncToken = newToken;

  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? `REDIS_${command}_FAILED`);
  return json?.result as T;
}

const now = () => Date.now();

function duelKey(id: string) {
  return `duel:${id.toUpperCase()}`;
}

const OPEN_ZSET = "duels:open";
const RECENT_LIST = "duels:recent";

function historyKey(pk: string) {
  return `duels:history:${pk}`;
}

export function feeFor(stake: number, feeBps: number) {
  return Math.floor((stake * feeBps) / 10_000);
}

export function netStakeFor(stake: number, feeBps: number) {
  return Math.max(0, stake - feeFor(stake, feeBps));
}

function isFinishedPhase(phase: unknown): phase is "finished" {
  return phase === "finished";
}

/* ---------------- PHASE / START ---------------- */

function startNow(duel: Duel, t: number) {
  const countdownMs = 3000;
  const randomDelay = 900 + Math.floor(Math.random() * 1300);

  duel.revealAt = t + countdownMs;
  duel.goAt = duel.revealAt + randomDelay;
  duel.phase = "countdown";

  duel.clickA = undefined;
  duel.clickB = undefined;
  duel.falseA = false;
  duel.falseB = false;
  duel.winner = undefined;

  duel.finishedAt = undefined;
  duel.firstClickAt = undefined;
  duel.finalizeAt = undefined;

  duel._historyRecorded = false;
}

function advancePhase(duel: Duel, t: number) {
  if (isFinishedPhase(duel.phase)) return;
  if (!duel.revealAt || !duel.goAt) return;

  if (duel.phase === "countdown" && t >= duel.revealAt) {
    duel.phase = "waiting_random";
  }
  if ((duel.phase === "countdown" || duel.phase === "waiting_random") && t >= duel.goAt) {
    duel.phase = "go";
  }
}

/* ---------------- READY ROOM ---------------- */

function maybeStartFromReadyRoom(duel: Duel, t: number) {
  if (isFinishedPhase(duel.phase)) return;
  if (duel.phase !== "lobby") return;
  if (!duel.joinedBy) return;
  if (!duel.paidA || !duel.paidB) return;

  duel.readyDeadlineAt = duel.readyDeadlineAt ?? t + 30_000;

  const bothReady = !!duel.readyA && !!duel.readyB;
  const deadlineHit = t >= (duel.readyDeadlineAt ?? 0);

  if (bothReady || deadlineHit) startNow(duel, t);
}

/* ---------------- AUTO-FINISH ---------------- */

function finalizeIfOverdueInternal(duel: Duel, t: number) {
  if (isFinishedPhase(duel.phase)) return;
  if (!duel.finalizeAt) return;
  if (t < duel.finalizeAt) return;

  if (duel.clickA != null && duel.clickB != null) return;

  if (duel.clickA != null && duel.clickB == null) duel.winner = "A";
  else if (duel.clickB != null && duel.clickA == null) duel.winner = "B";
  else return;

  duel.phase = "finished";
  duel.finishedAt = duel.finishedAt ?? t;
}

/* ---------------- SAVE / GET ---------------- */

async function saveDuel(duel: Duel) {
  duel.updatedAt = now();
  await redis("set", duelKey(duel.duelId), JSON.stringify(duel));
}

async function getDuelRaw(id: string): Promise<Duel | null> {
  const raw = await redis<string | null>("get", duelKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Duel;
  } catch {
    return null;
  }
}

export async function getDuel(id: string): Promise<Duel | null> {
  const duelId = id.toUpperCase();

  let duel = await getDuelRaw(duelId);
  if (!duel) return null;

  const t = now();

  maybeStartFromReadyRoom(duel, t);
  advancePhase(duel, t);
  finalizeIfOverdueInternal(duel, t);

  if (isFinishedPhase(duel.phase)) {
    await recordHistoryIfFinished(duel);
  } else {
    await saveDuel(duel);
  }

  const duel2 = await getDuelRaw(duelId);
  if (duel2 && duel2.updatedAt >= duel.updatedAt) duel = duel2;

  return duel;
}

/* ---------------- CREATE ---------------- */

export async function createDuel(input: {
  duelId: string;
  createdBy: string;
  stakeLamports: number;
  feeBps: number;
  paySigA: string;
}): Promise<Duel> {
  const duelId = input.duelId.toUpperCase();

  const existing = await getDuel(duelId);
  if (existing) throw new Error("DUEL_ALREADY_EXISTS");

  const duel: Duel = {
    duelId,
    stakeLamports: Number(input.stakeLamports),
    feeBps: Number(input.feeBps),
    createdBy: input.createdBy,

    createdAt: now(),
    updatedAt: now(),

    phase: "lobby",

    paidA: true,
    paidB: false,
    paySigA: input.paySigA,

    readyA: false,
    readyB: false,

    falseA: false,
    falseB: false,

    _historyRecorded: false,
  };

  await redis("set", duelKey(duelId), JSON.stringify(duel));
  await redis("zadd", OPEN_ZSET, duel.updatedAt, duelId);

  return duel;
}

/* ---------------- JOIN ---------------- */

export async function joinDuel(input: { duelId: string; joinedBy: string; paySigB: string }): Promise<Duel> {
  const duel = await getDuel(input.duelId);
  if (!duel) throw new Error("DUEL_NOT_FOUND");

  if (duel.joinedBy) throw new Error("DUEL_ALREADY_JOINED");
  if (duel.createdBy === input.joinedBy) throw new Error("CANNOT_JOIN_OWN_DUEL");
  if (!duel.paidA) throw new Error("CREATOR_NOT_PAID");
  if (duel.phase !== "lobby") throw new Error("DUEL_NOT_JOINABLE");

  duel.joinedBy = input.joinedBy;
  duel.paidB = true;
  duel.paySigB = input.paySigB;

  await redis("zrem", OPEN_ZSET, duel.duelId);

  duel.readyA = false;
  duel.readyB = false;
  duel.readyDeadlineAt = now() + 30_000;

  await saveDuel(duel);
  return duel;
}

/* ---------------- READY ---------------- */

export async function setReady(input: { duelId: string; pubkey: string }): Promise<Duel> {
  const duel = await getDuel(input.duelId);
  if (!duel) throw new Error("DUEL_NOT_FOUND");
  if (!duel.joinedBy) throw new Error("DUEL_NOT_JOINED");
  if (isFinishedPhase(duel.phase)) return duel;
  if (duel.phase !== "lobby") return duel;

  if (input.pubkey === duel.createdBy) duel.readyA = true;
  else if (input.pubkey === duel.joinedBy) duel.readyB = true;
  else throw new Error("NOT_A_PLAYER");

  const t = now();
  duel.readyDeadlineAt = duel.readyDeadlineAt ?? t + 30_000;

  if (duel.readyA && duel.readyB) startNow(duel, t);

  await saveDuel(duel);
  return duel;
}

/* ---------------- HISTORY ---------------- */

async function recordHistoryIfFinished(duel: Duel) {
  if (!isFinishedPhase(duel.phase)) return;
  if (duel._historyRecorded) {
    await saveDuel(duel);
    return;
  }

  duel._historyRecorded = true;

  const aKey = historyKey(duel.createdBy);
  await redis("lrem", aKey, 0, duel.duelId);
  await redis("lpush", aKey, duel.duelId);
  await redis("ltrim", aKey, 0, 9);

  if (duel.joinedBy) {
    const bKey = historyKey(duel.joinedBy);
    await redis("lrem", bKey, 0, duel.duelId);
    await redis("lpush", bKey, duel.duelId);
    await redis("ltrim", bKey, 0, 9);
  }

  await redis("lrem", RECENT_LIST, 0, duel.duelId);
  await redis("lpush", RECENT_LIST, duel.duelId);
  await redis("ltrim", RECENT_LIST, 0, 49);

  await saveDuel(duel);
}

/* ---------------- CLICK ---------------- */
/**
 * NOTE:
 * - input.clickedAt is kept for compatibility with your existing UI.
 * - Fairness/early-click is decided by server time (t = now()) to avoid clock skew + clamp issues.
 */
export async function applyClick(input: { duelId: string; who: "A" | "B"; clickedAt: number }): Promise<Duel> {
  const duel = await getDuel(input.duelId);
  if (!duel) throw new Error("DUEL_NOT_FOUND");
  if (!duel.joinedBy) throw new Error("DUEL_NOT_JOINED");
  if (!duel.revealAt || !duel.goAt) throw new Error("DUEL_NOT_STARTED");
  if (!duel.paidA || !duel.paidB) throw new Error("NOT_PAID");
  if (isFinishedPhase(duel.phase)) return duel;

  // Canonical time: server receipt time
  const t = now();

  advancePhase(duel, t);
  finalizeIfOverdueInternal(duel, t);
  if (isFinishedPhase(duel.phase)) {
    await recordHistoryIfFinished(duel);
    return duel;
  }

  // ✅ Early click = lose (server authoritative)
  if (t < duel.goAt) {
    if (input.who === "A") duel.falseA = true;
    else duel.falseB = true;

    duel.winner = input.who === "A" ? "B" : "A";
    duel.phase = "finished";
    duel.finishedAt = t;

    await saveDuel(duel);
    await recordHistoryIfFinished(duel);
    return duel;
  }

  // ✅ Reaction time based on server time (stable)
  const reactionMs = Math.max(0, t - duel.goAt);

  if (input.who === "A") {
    if (duel.clickA != null) return duel;
    duel.clickA = reactionMs;
  } else {
    if (duel.clickB != null) return duel;
    duel.clickB = reactionMs;
  }

  if (!duel.firstClickAt) {
    duel.firstClickAt = t;
    duel.finalizeAt = t + 5000;
  }

  if (duel.clickA != null && duel.clickB != null) {
    duel.winner = duel.clickA <= duel.clickB ? "A" : "B";
    duel.phase = "finished";
    duel.finishedAt = t;
  } else {
    duel.phase = "go";
  }

  await saveDuel(duel);
  if (isFinishedPhase(duel.phase)) await recordHistoryIfFinished(duel);
  return duel;
}

/* ---------------- LISTING ---------------- */

export async function listOpenDuels(limit = 25): Promise<Duel[]> {
  const ids = await redis<string[]>("zrevrange", OPEN_ZSET, 0, Math.max(0, limit - 1));
  if (!ids?.length) return [];

  const out: Duel[] = [];
  for (const id of ids) {
    const d = await getDuel(id);
    if (d && d.phase === "lobby" && !d.joinedBy && d.paidA) out.push(d);
  }
  return out;
}

export async function getHistory(pubkey: string, limit = 10): Promise<Duel[]> {
  const ids = await redis<string[]>("lrange", historyKey(pubkey), 0, Math.max(0, limit - 1));
  if (!ids?.length) return [];

  const out: Duel[] = [];
  for (const id of ids) {
    const d = await getDuel(id);
    if (d) out.push(d);
  }
  return out;
}

/* ---------------- PAYOUT FLAG ---------------- */

export async function markPayout(input: { duelId: string; payoutSig: string }): Promise<Duel> {
  const duel = await getDuel(input.duelId);
  if (!duel) throw new Error("DUEL_NOT_FOUND");
  if (!isFinishedPhase(duel.phase)) throw new Error("DUEL_NOT_FINISHED");
  if (duel.payoutSig) return duel;

  duel.payoutSig = input.payoutSig;
  await saveDuel(duel);
  return duel;
}
