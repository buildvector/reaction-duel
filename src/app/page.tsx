"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

type DuelPhase = "lobby" | "countdown" | "waiting_random" | "go" | "finished";

type Duel = {
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
};

function lamportsFromSol(sol: number) {
  return Math.round(sol * 1_000_000_000);
}
function solFromLamports(l: number) {
  return l / 1_000_000_000;
}
function short(pk?: string) {
  if (!pk) return "—";
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}
function makeDuelId() {
  const a = Math.random().toString(36).slice(2, 6).toUpperCase();
  const b = Date.now().toString(36).slice(-4).toUpperCase();
  return `${a}${b}`;
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postJSON<T>(url: string, body: any): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error ?? "REQUEST_FAILED");
  return j as T;
}

async function getJSON<T>(url: string): Promise<T> {
  const u = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost");
  u.searchParams.set("_ts", String(Date.now()));

  const r = await fetch(u.toString(), {
    method: "GET",
    cache: "no-store",
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });

  const j = await r.json();
  if (!r.ok) throw new Error(j?.error ?? "REQUEST_FAILED");
  return j as T;
}

let _treasuryPkCache: string | null = null;
async function getTreasuryPubkey(): Promise<string> {
  if (_treasuryPkCache) return _treasuryPkCache;

  const r = await fetch(`/api/duel/config?_ts=${Date.now()}`, {
    method: "GET",
    cache: "no-store",
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });

  const j = await r.json();
  if (!r.ok) throw new Error(j?.error ?? "CONFIG_FAILED");
  _treasuryPkCache = String(j.treasuryPubkey);
  return _treasuryPkCache;
}

/* ----------------- UI primitives ----------------- */

function Card(props: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <section className="glass glass-rim glass-noise" style={{ borderRadius: 18, padding: 18, ...props.style }}>
      {props.children}
    </section>
  );
}
function Label(props: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: "var(--muted)", ...props.style }}>
      {props.children}
    </div>
  );
}
function Hint(props: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ fontSize: 12, color: "rgba(231,234,242,0.65)", ...props.style }}>{props.children}</div>;
}
function Mono(props: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="mono" style={{ fontSize: 12, ...props.style }}>
      {props.children}
    </div>
  );
}
function Pill(props: { label: string; tone?: "neutral" | "purple" | "green" | "red" }) {
  const tone = props.tone ?? "neutral";
  const shadow =
    tone === "purple"
      ? "0 0 40px rgba(168,85,247,0.12)"
      : tone === "green"
      ? "0 0 40px rgba(34,197,94,0.10)"
      : tone === "red"
      ? "0 0 40px rgba(239,68,68,0.10)"
      : "none";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.05)",
        padding: "6px 10px",
        fontSize: 12,
        color: "rgba(231,234,242,0.92)",
        boxShadow: `0 0 0 1px rgba(255,255,255,0.04) inset, ${shadow}`,
        whiteSpace: "nowrap",
      }}
    >
      {props.label}
    </span>
  );
}
function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`input-premium ${props.className ?? ""}`}
      style={{
        width: "100%",
        borderRadius: 14,
        padding: "10px 12px",
        fontSize: 14,
        color: "var(--text)",
        outline: "none",
        ...(props.style as any),
      }}
    />
  );
}
function Button(props: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
  style?: React.CSSProperties;
}) {
  const v = props.variant ?? "ghost";

  const base: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "var(--text)",
    cursor: props.disabled ? "not-allowed" : "pointer",
    opacity: props.disabled ? 0.55 : 1,
    fontWeight: 800,
    letterSpacing: 0.2,
  };

  const byVariant: Record<string, React.CSSProperties> = {
    ghost: { background: "transparent" },
    danger: { border: "1px solid rgba(239,68,68,.35)", background: "rgba(239,68,68,.12)" },
    primary: {
      border: "1px solid rgba(124,58,237,.45)",
      background: "linear-gradient(135deg, rgba(255,255,255,0.92), rgba(255,255,255,0.82))",
      color: "#0b0d12",
      boxShadow: "0 16px 50px rgba(0,0,0,0.55)",
    },
  };

  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className={v === "ghost" ? "btn-premium ring-violet-hover" : ""}
      style={{ ...base, ...byVariant[v], ...props.style }}
    >
      {props.children}
    </button>
  );
}

/* ----------------- Page ----------------- */

export default function Page() {
  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();
  const me = publicKey?.toBase58() ?? "";

  const BET_OPTIONS_SOL = [0.1, 0.25, 0.5, 1] as const;
  const MIN_BET = 0.01;
  const MAX_BET = 5;

  const [stakeSol, setStakeSol] = useState<number>(0.1);
  const [custom, setCustom] = useState<string>(String(stakeSol));

  const [duel, setDuel] = useState<Duel | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const [openDuels, setOpenDuels] = useState<Duel[]>([]);
  const [openRefreshing, setOpenRefreshing] = useState(false);

  const [mounted, setMounted] = useState(false);

  // ✅ server-synced clock
  const offsetRef = useRef<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const uiNow = () => Date.now() + (offsetRef.current ?? 0);

  useEffect(() => {
    setMounted(true);
    setNowMs(Date.now());
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const i = setInterval(() => setNowMs(uiNow()), 50);
    return () => clearInterval(i);
  }, [mounted]);

  const duelId = duel?.duelId ?? null;

  const myRole = useMemo<"A" | "B" | null>(() => {
    if (!duel || !connected || !publicKey) return null; // ✅ require publicKey, not only connected
    if (duel.createdBy === me) return "A";
    if (duel.joinedBy === me) return "B";
    return null;
  }, [duel, connected, publicKey, me]);

  // Poll active duel
  useEffect(() => {
    if (!duelId) return;
    let alive = true;

    const tick = async () => {
      try {
        const { duel: fresh, serverNow } = await getJSON<{ duel: Duel; serverNow: number }>(
          `/api/duel/get?duelId=${encodeURIComponent(duelId)}`
        );
        if (!alive) return;

        setDuel(fresh);

        if (typeof serverNow === "number") {
          const targetOffset = serverNow - Date.now();
          if (offsetRef.current == null) {
            offsetRef.current = targetOffset;
          } else {
            const alpha = 0.15;
            const clamp = 2000;
            const delta = Math.max(-clamp, Math.min(clamp, targetOffset - offsetRef.current));
            offsetRef.current = offsetRef.current + delta * alpha;
          }
        }
      } catch {}
    };

    tick();
    const i = setInterval(tick, 500);
    return () => {
      alive = false;
      clearInterval(i);
    };
  }, [duelId]);

  const refreshOpenDuels = async (quiet = false) => {
    try {
      if (!quiet) setOpenRefreshing(true);
      const { duels } = await getJSON<{ duels: Duel[] }>(`/api/duel/open?limit=25`);
      setOpenDuels(duels ?? []);
    } catch {
    } finally {
      if (!quiet) setOpenRefreshing(false);
    }
  };

  useEffect(() => {
    if (duelId) return;

    let alive = true;
    const tick = async () => {
      try {
        const { duels } = await getJSON<{ duels: Duel[] }>(`/api/duel/open?limit=25`);
        if (alive) setOpenDuels(duels ?? []);
      } catch {}
    };

    tick();
    const i = setInterval(tick, 2500);
    return () => {
      alive = false;
      clearInterval(i);
    };
  }, [duelId]);

  // payout loop
  const payoutInFlight = useRef(false);
  useEffect(() => {
    const run = async () => {
      if (!duel) return;
      if (duel.phase !== "finished") return;
      if (!duel.winner) return;
      if (duel.payoutSig) return;
      if (payoutInFlight.current) return;

      payoutInFlight.current = true;
      try {
        for (let i = 0; i < 6; i++) {
          const res = await postJSON<{ duel: Duel }>("/api/duel/payout", { duelId: duel.duelId }).catch(() => null);
          if (res?.duel?.payoutSig) {
            setDuel(res.duel);
            break;
          }
          await sleep(800);
        }
      } finally {
        payoutInFlight.current = false;
      }
    };
    run();
  }, [duel?.phase, duel?.winner, duel?.payoutSig, duel?.duelId]);

  async function confirmSigRobust(sig: string) {
    try {
      const latest = await connection.getLatestBlockhash("confirmed");
      await connection.confirmTransaction(
        { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
        "confirmed"
      );
      return true;
    } catch {}

    for (let i = 0; i < 30; i++) {
      const st = await connection.getSignatureStatuses([sig]);
      const s = st?.value?.[0];
      if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return true;
      if (s?.err) throw new Error("TX_FAILED");
      await sleep(2000);
    }
    return false;
  }

  async function transferStakeToTreasury(lamports: number) {
    if (!publicKey) throw new Error("WALLET_NOT_READY");
    const treasury = new PublicKey(await getTreasuryPubkey());

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: treasury,
        lamports,
      })
    );

    const sig = await sendTransaction(tx, connection, { skipPreflight: false });
    await confirmSigRobust(sig).catch(() => null);
    return sig;
  }

  async function createDuelPaid() {
    if (!connected || !publicKey) return;
    setLoading("create");
    try {
      const id = makeDuelId();
      const stakeLamports = lamportsFromSol(stakeSol);

      const sig = await transferStakeToTreasury(stakeLamports);

      const { duel } = await postJSON<{ duel: Duel }>("/api/duel/create", {
        duelId: id,
        createdBy: me,
        stakeLamports,
        feeBps: 300,
        paySigA: sig,
      });

      setDuel(duel);
    } catch (e: any) {
      alert(e?.message ?? "Create failed");
    } finally {
      setLoading(null);
    }
  }

  async function joinDuelPaid(codeIn?: string) {
    if (!connected || !publicKey) return;
    const code = (codeIn ?? "").trim().toUpperCase();
    if (!code) return;

    setLoading("join");
    try {
      const { duel: target } = await getJSON<{ duel: Duel }>(`/api/duel/get?duelId=${encodeURIComponent(code)}`);

      if (!target) throw new Error("DUEL_NOT_FOUND");
      if (target.phase !== "lobby") throw new Error("DUEL_NOT_JOINABLE");
      if (target.joinedBy) throw new Error("DUEL_ALREADY_JOINED");

      const sig = await transferStakeToTreasury(target.stakeLamports);

      const { duel } = await postJSON<{ duel: Duel }>("/api/duel/join", {
        duelId: code,
        joinedBy: me,
        paySigB: sig,
      });

      setDuel(duel);
    } catch (e: any) {
      alert(e?.message ?? "Join failed");
    } finally {
      setLoading(null);
    }
  }

  // ✅ READY: require publicKey + lock inFlight + optimistic UI
  const readyInFlight = useRef(false);
  async function readyUp() {
    if (!connected || !publicKey || !duel) return;
    if (!me) return;

    if (readyInFlight.current) return;
    readyInFlight.current = true;

    setLoading("ready");
    try {
      const { duel: next } = await postJSON<{ duel: Duel }>("/api/duel/ready", {
        duelId: duel.duelId,
        pubkey: me,
      });

      // optimistic merge in case server returns slightly stale
      setDuel((prev) => {
        if (!prev) return next;
        if (prev.duelId !== next.duelId) return next;
        const merged = { ...prev, ...next };
        if (myRole === "A") merged.readyA = true;
        if (myRole === "B") merged.readyB = true;
        return merged as Duel;
      });
    } catch (e: any) {
      alert(e?.message ?? "Ready failed");
    } finally {
      setLoading(null);
      readyInFlight.current = false;
    }
  }

  const displayPhase: DuelPhase = useMemo(() => {
    if (!duel) return "lobby";
    if (duel.phase === "finished") return "finished";

    const t = nowMs || Date.now();
    if (duel.revealAt && duel.goAt) {
      if (t < duel.revealAt) return "countdown";
      if (t < duel.goAt) return "waiting_random";
      return "go";
    }
    if (duel.phase !== "lobby") return duel.phase;
    return "lobby";
  }, [duel, nowMs]);

  // ✅ GO grace
  function isGoOrJustBecameGo() {
    if (!duel?.goAt) return displayPhase === "go";
    const t = nowMs || Date.now();
    const GRACE_MS = 350;
    return t >= duel.goAt - GRACE_MS;
  }

  // ✅ click: use server-synced time, not local Date.now()
  const clickedLocalRef = useRef(false);
  useEffect(() => {
    clickedLocalRef.current = false;
  }, [duelId, duel?.phase, duel?.clickA, duel?.clickB]);

  async function clickDuel() {
    if (!duel) return;
    if (!myRole) return;
    if (duel.phase === "finished") return;

    if (!isGoOrJustBecameGo()) return;

    if (clickedLocalRef.current) return;
    clickedLocalRef.current = true;

    try {
      const { duel: next } = await postJSON<{ duel: Duel }>("/api/duel/click", {
        duelId: duel.duelId,
        who: myRole,
        clickedAt: uiNow(), // ✅ IMPORTANT
      });
      setDuel(next);
    } catch (e: any) {
      clickedLocalRef.current = false;
      alert(e?.message ?? "Click failed");
    }
  }

  function reset() {
    setDuel(null);
  }

  const feeLamports = duel ? Math.floor((duel.stakeLamports * duel.feeBps) / 10_000) : 0;
  const netLamports = duel ? Math.max(0, duel.stakeLamports - feeLamports) : 0;
  const potLamports = duel ? netLamports * 2 : 0;

  const countdownText = useMemo(() => {
    if (!mounted) return "";
    if (!duel?.revealAt) return "";
    const t = nowMs || Date.now();
    const ms = duel.revealAt - t;
    const secs = Math.max(0, Math.ceil(ms / 1000));
    if (secs >= 3) return "3";
    if (secs === 2) return "2";
    if (secs === 1) return "1";
    return "";
  }, [mounted, duel?.revealAt, nowMs]);

  const readyCountdown = useMemo(() => {
    if (!duel?.readyDeadlineAt) return null;
    const t = nowMs || Date.now();
    const ms = duel.readyDeadlineAt - t;
    return Math.max(0, Math.ceil(ms / 1000));
  }, [duel?.readyDeadlineAt, nowMs]);

  const parsedCustom = useMemo(() => {
    const n = Number(String(custom).replace(",", "."));
    if (!Number.isFinite(n)) return null;
    return n;
  }, [custom]);

  const customError = useMemo(() => {
    if (custom.trim().length === 0) return null;
    if (parsedCustom === null) return "Invalid number";
    if (parsedCustom < MIN_BET) return `Min ${MIN_BET} SOL`;
    if (parsedCustom > MAX_BET) return `Max ${MAX_BET} SOL (MVP)`;
    return null;
  }, [custom, parsedCustom]);

  const applyCustom = () => {
    if (parsedCustom === null) return;
    if (parsedCustom < MIN_BET || parsedCustom > MAX_BET) return;
    setStakeSol(Number(parsedCustom.toFixed(4)));
  };

  const iAmReady = myRole === "A" ? !!duel?.readyA : myRole === "B" ? !!duel?.readyB : false;
  const bothReady = !!duel?.readyA && !!duel?.readyB;

  const iWon = useMemo(() => {
    if (!duel || duel.phase !== "finished" || !duel.winner || !myRole) return null;
    return duel.winner === myRole;
  }, [duel, myRole]);

  const bg =
    displayPhase === "go"
      ? "rgba(0, 255, 160, 0.10)"
      : displayPhase === "waiting_random"
      ? "rgba(255, 200, 0, 0.07)"
      : displayPhase === "countdown"
      ? "rgba(124,58,237,0.10)"
      : "rgba(255,255,255,0.03)";

  return (
    <main className="bg-casino" style={{ minHeight: "100vh" }}>
      <div style={{ maxWidth: 1060, margin: "0 auto", padding: "54px 16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.4 }}>Reaction Duel</div>
          <div style={{ fontSize: 13, color: "rgba(231,234,242,0.68)", maxWidth: 620 }}>
            Minimal P2P reaction duel. Both players deposit to treasury. Winner resolved server-side + auto payout.
          </div>
          <div style={{ display: "inline-flex" }}>
            <WalletMultiButton />
          </div>
        </div>

        {!duel ? (
          <div style={{ marginTop: 26, display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
            <div style={{ display: "grid", gap: 16 }}>
              <Card>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800 }}>Create duel</div>
                    <Hint style={{ marginTop: 6 }}>Deposit goes to treasury. 3% fee is taken instantly.</Hint>
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(231,234,242,0.55)" }}>min {MIN_BET} SOL</div>
                </div>

                <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
                  <Label>Bet size</Label>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                    {BET_OPTIONS_SOL.map((x) => {
                      const active = stakeSol === x;
                      return (
                        <button
                          key={x}
                          onClick={() => setStakeSol(x)}
                          className="ring-violet-hover"
                          style={{
                            width: "100%",
                            borderRadius: 14,
                            padding: 12,
                            textAlign: "left",
                            border: active ? "1px solid rgba(255,255,255,0.28)" : "1px solid rgba(255,255,255,0.10)",
                            background: active ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.05)",
                            color: active ? "#0b0d12" : "var(--text)",
                            boxShadow: active ? "0 12px 50px rgba(0,0,0,0.45)" : undefined,
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ fontSize: 14, fontWeight: 800 }}>{x} SOL</div>
                          <div style={{ fontSize: 12, opacity: active ? 0.7 : 0.65 }}>{active ? "Selected" : "Click to select"}</div>
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ marginTop: 4, display: "grid", gap: 8 }}>
                    <Label>Custom bet (SOL)</Label>
                    <div style={{ display: "flex", gap: 10 }}>
                      <Input value={custom} onChange={(e) => setCustom((e.target as any).value)} placeholder="e.g. 0.35" />
                      <Button variant="ghost" onClick={applyCustom} disabled={!!customError || parsedCustom === null}>
                        Apply
                      </Button>
                    </div>
                    {customError ? <div style={{ fontSize: 12, color: "#fecaca" }}>{customError}</div> : null}
                    <div style={{ fontSize: 12, color: "rgba(231,234,242,0.55)" }}>
                      MVP limits: {MIN_BET} – {MAX_BET} SOL.
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <Button variant="primary" onClick={createDuelPaid} disabled={!connected || !publicKey || loading === "create"} style={{ minWidth: 170 }}>
                    {loading === "create" ? "Creating…" : "Create & deposit"}
                  </Button>
                  <div style={{ fontSize: 12, color: "rgba(231,234,242,0.55)" }}>
                    {connected ? "You will sign a transfer in Phantom." : "Connect a wallet to play."}
                  </div>
                </div>
              </Card>
            </div>

            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>Open duels</div>
                  <Hint style={{ marginTop: 6 }}>Join an open duel. Deposit goes to treasury.</Hint>
                </div>

                <Button variant="ghost" onClick={() => refreshOpenDuels(false)} disabled={openRefreshing}>
                  {openRefreshing ? "Refreshing…" : "Refresh"}
                </Button>
              </div>

              <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                {openDuels.length === 0 ? (
                  <div style={{ fontSize: 13, color: "rgba(231,234,242,0.55)" }}>No open duels.</div>
                ) : (
                  openDuels.map((r) => (
                    <div
                      key={r.duelId}
                      className="glass"
                      style={{
                        borderRadius: 18,
                        padding: 14,
                        border: "1px solid rgba(255,255,255,0.10)",
                        background: "rgba(255,255,255,0.05)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <div style={{ fontSize: 18, fontWeight: 800 }}>{solFromLamports(r.stakeLamports).toFixed(2)} SOL</div>
                            <Pill label={r.joinedBy ? "reserved" : "open"} tone={r.joinedBy ? "purple" : "green"} />
                          </div>

                          <div style={{ marginTop: 8, fontSize: 12, color: "rgba(231,234,242,0.55)" }}>
                            Duel ID{" "}
                            <span className="mono" style={{ color: "rgba(231,234,242,0.9)" }}>
                              {r.duelId}
                            </span>
                          </div>

                          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <Label style={{ minWidth: 56 }}>Creator</Label>
                              <Mono style={{ color: "rgba(231,234,242,0.9)" }}>{short(r.createdBy)}</Mono>
                            </div>
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 10 }}>
                          <Button
                            variant="primary"
                            disabled={!connected || !publicKey || loading === "join" || r.createdBy === me}
                            onClick={() => joinDuelPaid(r.duelId)}
                            style={{ minWidth: 120 }}
                          >
                            {loading === "join" ? "Joining…" : "Join"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        ) : (
          <div style={{ marginTop: 26 }}>
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>
                    Duel <span className="mono">{duel.duelId}</span>
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <Pill
                      label={`phase: ${displayPhase}`}
                      tone={displayPhase === "go" ? "green" : displayPhase === "waiting_random" ? "purple" : displayPhase === "countdown" ? "purple" : "neutral"}
                    />
                    {duel.phase === "finished" ? (
                      <Pill label={duel.payoutSig ? "payout: sent" : "payout: pending"} tone={duel.payoutSig ? "green" : "purple"} />
                    ) : null}
                  </div>

                  <div style={{ marginTop: 10, fontSize: 13, color: "rgba(231,234,242,0.75)" }}>
                    Stake: <b>{solFromLamports(duel.stakeLamports).toFixed(2)} SOL</b> · Pot: <b>{solFromLamports(potLamports).toFixed(4)} SOL</b>
                  </div>

                  <div style={{ marginTop: 8, fontSize: 13, color: "rgba(231,234,242,0.70)" }}>
                    A: <span className="mono">{short(duel.createdBy)}</span>{" "}
                    {duel.joinedBy ? (
                      <>
                        · B: <span className="mono">{short(duel.joinedBy)}</span>
                      </>
                    ) : (
                      <>· waiting for B…</>
                    )}
                  </div>

                  {duel.phase === "lobby" && duel.joinedBy ? (
                    <div style={{ marginTop: 10, fontSize: 12, color: "rgba(231,234,242,0.60)" }}>
                      Ready: A {duel.readyA ? "✅" : "⏳"} · B {duel.readyB ? "✅" : "⏳"}
                      {readyCountdown != null ? ` · Auto-start in ${readyCountdown}s` : ""}
                    </div>
                  ) : null}
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <Button variant="ghost" onClick={reset} style={{ opacity: 0.9 }}>
                    Back to lobby
                  </Button>
                </div>
              </div>

              {duel.phase === "lobby" && duel.joinedBy ? (
                <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <Button
                    variant="primary"
                    disabled={!connected || !publicKey || !myRole || loading === "ready" || readyInFlight.current || iAmReady}
                    onClick={readyUp}
                    style={{ minWidth: 150 }}
                  >
                    {iAmReady ? "READY ✅" : loading === "ready" ? "Setting…" : "READY"}
                  </Button>
                  <Hint>{bothReady ? "Both ready → starting…" : `Auto-start in ${readyCountdown ?? "—"}s (or when both ready).`}</Hint>
                </div>
              ) : null}

              <div
                onPointerDown={(e) => {
                  e.preventDefault();
                  clickDuel();
                }}
                style={{
                  marginTop: 16,
                  height: 280,
                  borderRadius: 22,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: bg,
                  display: "grid",
                  placeItems: "center",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  touchAction: "manipulation",
                  cursor: isGoOrJustBecameGo() && duel.phase !== "finished" ? "pointer" : "default",
                }}
              >
                {duel.phase === "lobby" ? (
                  <div style={{ textAlign: "center", color: "rgba(231,234,242,0.80)" }}>
                    {!duel.joinedBy ? "Waiting for Player B…" : bothReady ? "Starting…" : `Ready up! Auto-start in ${readyCountdown ?? "—"}s.`}
                  </div>
                ) : displayPhase === "countdown" ? (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 64, fontWeight: 900 }}>{countdownText}</div>
                    <div style={{ marginTop: 10, color: "rgba(231,234,242,0.70)" }}>If you click now, you lose.</div>
                  </div>
                ) : displayPhase === "waiting_random" ? (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 26, fontWeight: 900 }}>RANDOM DELAY…</div>
                    <div style={{ marginTop: 10, color: "rgba(231,234,242,0.70)" }}>Do NOT click until it turns green.</div>
                  </div>
                ) : duel.phase === "finished" ? (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 44, fontWeight: 950 }}>{iWon == null ? "DONE" : iWon ? "YOU WIN" : "YOU LOSE"}</div>
                    <div style={{ marginTop: 10, color: "rgba(231,234,242,0.85)" }}>
                      A: <b>{duel.clickA ?? "—"}</b> ms &nbsp; | &nbsp; B: <b>{duel.clickB ?? "—"}</b> ms
                    </div>
                    <div style={{ marginTop: 12, fontSize: 12, color: "rgba(231,234,242,0.60)" }}>
                      {duel.payoutSig ? "Payout sent ✅" : "Paying out…"}
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 54, fontWeight: 900 }}>CLICK NOW!</div>
                    <div style={{ marginTop: 10, color: "rgba(231,234,242,0.70)" }}>First valid click wins.</div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 12, fontSize: 12, color: "rgba(231,234,242,0.55)" }}>
                Click timing uses server-synced clock to avoid “green click rejected”.
              </div>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}
