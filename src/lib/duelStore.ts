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
 * NOTE:
 * - We DO NOT use "GET -> save()" anymore (that can clobber state on stale reads).
 * - We only write on real transitions and with CAS (compare-and-set) so stale reads can't overwrite newer state.
 */

async function redis<T>(command: string, ...args: any[]): Promise<T> {
  const { url, token } = redisEnv();
  const path = `${url}/${command}/${args.map((a) => encodeURIComponent(String(a))).join("/")}`;

  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

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
  // Important: only call this ONCE and persist it (CAS) otherwise goAt changes.
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
  if (isFinishedPhase(duel.phase)) return false;
  if (!duel.revealAt || !duel.goAt) return false;

  let changed = false;

  if (duel.phase === "countdown" && t >= duel.revealAt) {
    duel.phase = "waiting_random";
    changed = true;
  }
  if ((duel.phase === "countdown" || duel.phase === "waiting_random") && t >= duel.goAt) {
    duel.phase = "go";
    changed = true;
  }

  return changed;
}

/* ---------------- READY ROOM ---------------- */

function maybeStartFromReadyRoom(duel: Duel, t: number) {
  if (isFinishedPhase(duel.phase)) return false;
  if (duel.phase !== "lobby") return false;
  if (!duel.joinedBy) return false;
  if (!duel.paidA || !duel.paidB) return false;

  duel.readyDeadlineAt = duel.readyDeadlineAt ?? t + 30_000;

  const bothReady = !!duel.readyA && !!duel.readyB;
  const deadlineHit = t >= (duel.readyDeadlineAt ?? 0);

  if (bothReady || deadlineHit) {
    startNow(duel, t);
    return true;
  }
  return false;
}

/* ---------------- AUTO-FINISH ---------------- */

function finalizeIfOverdueInternal(duel: Duel, t: number) {
  if (isFinishedPhase(duel.phase)) return false;
  if (!duel.finalizeAt) return false;
  if (t < duel.finalizeAt) return false;

  if (duel.clickA != null && duel.clickB != null) return false;

  if (duel.clickA != null && duel.clickB == null) duel.winner = "A";
  else if (duel.clickB != null && duel.clickA == null) duel.winner = "B";
  else return false;

  duel.phase = "finished";
  duel.finishedAt = duel.finishedAt ?? t;
  return true;
}

/* ---------------- LOW-LEVEL GET ---------------- */

async function getDuelRaw(id: string): Promise<Duel | null> {
  const raw = await redis<string | null>("get", duelKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Duel;
  } catch {
    return null;
  }
}

/* ---------------- CAS WRITE (prevents stale clobber) ---------------- */

/**
 * CAS set:
 * - Loads current JSON
 * - Compares current.updatedAt == expectedUpdatedAt
 * - If matches -> SET new JSON
 */
async function casSaveDuel(key: string, expectedUpdatedAt: number, next: Duel): Promise<boolean> {
  next.updatedAt = now();
  const nextJson = JSON.stringify(next);

  // Upstash supports EVAL. We use cjson to decode JSON server-side.
  const script = `
local k = KEYS[1]
local expected = tonumber(ARGV[1])
local nextJson = ARGV[2]

local cur = redis.call("get", k)
if not cur then
  return -1
end

local obj = cjson.decode(cur)
local curUpdated = tonumber(obj["updatedAt"]) or 0

if curUpdated ~= expected then
  return 0
end

redis.call("set", k, nextJson)
return 1
`;

  const res = await redis<number>("eval", script, 1, key, expectedUpdatedAt, nextJson);
  return res === 1;
}

/* ---------------- SAFE READ: transitions computed + persisted via CAS ---------------- */

export async function getDuel(id: string): Promise<Duel | null> {
  const duelId = id.toUpperCase();
  const key = duelKey(duelId);

  const duel = await getDuelRaw(duelId);
  if (!duel) return null;

  const t = now();

  // Compute transitions WITHOUT clobbering.
  const beforeUpdated = duel.updatedAt;

  let changed = false;
  changed = maybeStartFromReadyRoom(duel, t) || changed;
  changed = advancePhase(duel, t) || changed;
  changed = finalizeIfOverdueInternal(duel, t) || changed;

  if (changed) {
    // Persist only if we still match the version we read.
    const ok = await casSaveDuel(key, beforeUpdated, duel);
    if (!ok) {
      // Someone else wrote; return the newest instead of overwriting.
      return await getDuelRaw(duelId);
    }
  }

  // Record history only when finished (and also guarded inside)
  if (isFinishedPhase(duel.phase)) {
    await recordHistoryIfFinished(duel);
  }

  return duel;
}

/* ---------------- UPDATE HELPER (atomic-ish via CAS retries) ---------------- */

async function updateDuelWithRetry<T>(
  duelIdIn: string,
  mutator: (duel: Duel, t: number) => T,
  opts?: { maxRetries?: number }
): Promise<{ duel: Duel; out: T }> {
  const duelId = duelIdIn.toUpperCase();
  const key = duelKey(duelId);
  const maxRetries = opts?.maxRetries ?? 8;

  for (let i = 0; i < maxRetries; i++) {
    const duel = await getDuelRaw(duelId);
    if (!duel) throw new Error("DUEL_NOT_FOUND");

    const t = now();
    // Apply time-based transitions first (safe, but we only persist via CAS at the end).
    maybeStartFromReadyRoom(duel, t);
    advancePhase(duel, t);
    finalizeIfOverdueInternal(duel, t);

    const expected = duel.updatedAt;
    const out = mutator(duel, t);

    const ok = await casSaveDuel(key, expected, duel);
    if (ok) return { duel, out };
  }

  throw new Error("RETRY_LIMIT");
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
  const existing = await getDuelRaw(duelId);
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
  const { duel } = await updateDuelWithRetry(input.duelId, (d) => {
    if (d.joinedBy) throw new Error("DUEL_ALREADY_JOINED");
    if (d.createdBy === input.joinedBy) throw new Error("CANNOT_JOIN_OWN_DUEL");
    if (!d.paidA) throw new Error("CREATOR_NOT_PAID");
    if (d.phase !== "lobby") throw new Error("DUEL_NOT_JOINABLE");

    d.joinedBy = input.joinedBy;
    d.paidB = true;
    d.paySigB = input.paySigB;

    d.readyA = false;
    d.readyB = false;
    d.readyDeadlineAt = now() + 30_000;

    return true;
  });

  // Remove from open list best-effort (doesn't affect duel correctness)
  await redis("zrem", OPEN_ZSET, duel.duelId).catch(() => null);

  return duel;
}

/* ---------------- READY ---------------- */

export async function setReady(input: { duelId: string; pubkey: string }): Promise<Duel> {
  const { duel } = await updateDuelWithRetry(input.duelId, (d, t) => {
    if (!d.joinedBy) throw new Error("DUEL_NOT_JOINED");
    if (isFinishedPhase(d.phase)) return true;
    if (d.phase !== "lobby") return true;

    if (input.pubkey === d.createdBy) d.readyA = true;
    else if (input.pubkey === d.joinedBy) d.readyB = true;
    else throw new Error("NOT_A_PLAYER");

    d.readyDeadlineAt = d.readyDeadlineAt ?? t + 30_000;

    if (d.readyA && d.readyB) {
      startNow(d, t);
    }

    return true;
  });

  return duel;
}

/* ---------------- HISTORY ---------------- */

async function recordHistoryIfFinished(duel: Duel) {
  if (!isFinishedPhase(duel.phase)) return;
  if (duel._historyRecorded) return;

  // Mark locally (and persist via best-effort non-CAS set, because history is not correctness-critical)
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

  // Best-effort: write back history flag (no clobber risk here because finished state is stable)
  duel.updatedAt = now();
  await redis("set", duelKey(duel.duelId), JSON.stringify(duel)).catch(() => null);
}

/* ---------------- CLICK ---------------- */

export async function applyClick(input: { duelId: string; who: "A" | "B"; clickedAt: number }): Promise<Duel> {
  const { duel } = await updateDuelWithRetry(
    input.duelId,
    (d, t) => {
      if (!d.joinedBy) throw new Error("DUEL_NOT_JOINED");
      if (!d.revealAt || !d.goAt) throw new Error("DUEL_NOT_STARTED");
      if (!d.paidA || !d.paidB) throw new Error("NOT_PAID");
      if (isFinishedPhase(d.phase)) return true;

      // Move phase based on server time
      advancePhase(d, t);
      finalizeIfOverdueInternal(d, t);
      if (isFinishedPhase(d.phase)) return true;

      // Early click -> instant loss
      if (input.clickedAt < d.goAt) {
        if (input.who === "A") d.falseA = true;
        else d.falseB = true;

        d.winner = input.who === "A" ? "B" : "A";
        d.phase = "finished";
        d.finishedAt = t;
        return true;
      }

      const reactionMs = Math.max(0, input.clickedAt - d.goAt);

      // Too-fast clicks treated as false start
      if (reactionMs < 120) {
        if (input.who === "A") d.falseA = true;
        else d.falseB = true;

        d.winner = input.who === "A" ? "B" : "A";
        d.phase = "finished";
        d.finishedAt = t;
        return true;
      }

      if (input.who === "A") {
        if (d.clickA != null) return true;
        d.clickA = reactionMs;
      } else {
        if (d.clickB != null) return true;
        d.clickB = reactionMs;
      }

      if (!d.firstClickAt) {
        d.firstClickAt = t;
        d.finalizeAt = t + 5000;
      }

      if (d.clickA != null && d.clickB != null) {
        d.winner = d.clickA <= d.clickB ? "A" : "B";
        d.phase = "finished";
        d.finishedAt = t;
      } else {
        d.phase = "go";
      }

      return true;
    },
    { maxRetries: 10 }
  );

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
  const { duel } = await updateDuelWithRetry(input.duelId, (d) => {
    if (!isFinishedPhase(d.phase)) throw new Error("DUEL_NOT_FINISHED");
    if (d.payoutSig) return true;
    d.payoutSig = input.payoutSig;
    return true;
  });

  return duel;
}
