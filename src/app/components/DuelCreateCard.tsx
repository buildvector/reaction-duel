"use client";

import { useEffect, useMemo, useState } from "react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Button, Card, Label, Hint, Mono, Input } from "./ui";

function fmtSolFromLamports(l: number) {
  return `${(l / LAMPORTS_PER_SOL).toFixed(6)} SOL`;
}

export default function DuelCreateCard(props: {
  betOptions: readonly number[];
  betSol: number;
  setBetSol: (v: number) => void;
  feeLamports: number;
  netLamports: number;
  potLamports: number;
  depositFeeBps: number;
  onCreate: () => void;
  disableCreate: boolean;
}) {
  const { betOptions, betSol, setBetSol, feeLamports, netLamports, potLamports, depositFeeBps, onCreate, disableCreate } =
    props;

  const feePct = (depositFeeBps / 100).toFixed(0);

  const MIN_BET = 0.01;
  const MAX_BET = 5;

  const [custom, setCustom] = useState<string>(String(betSol));
  useEffect(() => setCustom(String(betSol)), [betSol]);

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
    setBetSol(Number(parsedCustom.toFixed(4)));
  };

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold tracking-tight">Create duel</div>
          <Hint className="mt-1">
            Deposit goes to treasury. <span className="text-zinc-300">{feePct}%</span> fee is taken instantly.
          </Hint>
        </div>

        <div className="text-xs text-zinc-500">min {MIN_BET} SOL</div>
      </div>

      <div className="mt-5 grid gap-3">
        <Label>Bet size</Label>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {betOptions.map((x) => {
            const active = betSol === x;
            return (
              <button
                key={x}
                onClick={() => setBetSol(x)}
                className={[
                  "w-full rounded-xl px-3 py-3 text-left border transition-shadow",
                  active
                    ? "border-white/25 bg-white text-zinc-950 shadow-[0_12px_50px_rgba(0,0,0,0.45)]"
                    : "border-white/10 bg-white/5 text-zinc-100",
                  "hover:shadow-[0_0_0_1px_rgba(168,85,247,0.70),0_0_0_4px_rgba(168,85,247,0.18),0_18px_60px_rgba(0,0,0,0.45)]",
                ].join(" ")}
              >
                <div className="text-sm font-semibold">{x} SOL</div>
                <div className={active ? "text-xs text-zinc-700" : "text-xs text-zinc-400"}>
                  {active ? "Selected" : "Click to select"}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-2 grid gap-2">
          <Label>Custom bet (SOL)</Label>
          <div className="flex gap-2">
            <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. 0.35" />
            <Button variant="ghost" onClick={applyCustom} disabled={!!customError || parsedCustom === null} className="violet-ring">
              Apply
            </Button>
          </div>
          {customError ? <div className="text-xs text-red-300">{customError}</div> : null}
          <div className="text-xs text-zinc-500">
            MVP limits: {MIN_BET} – {MAX_BET} SOL.
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-zinc-400">Fee ({feePct}%)</div>
          <Mono className="text-xs text-zinc-200">{fmtSolFromLamports(feeLamports)}</Mono>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="text-xs text-zinc-400">Net (after fee)</div>
          <Mono className="text-xs text-zinc-100">{fmtSolFromLamports(netLamports)}</Mono>
        </div>

        <div className="mt-3 h-px bg-white/10" />

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-xs text-zinc-400">Potential payout</div>
          <Mono className="text-xs text-zinc-100">{fmtSolFromLamports(potLamports)}</Mono>
        </div>

        <div className="mt-1 text-xs text-zinc-500">Winner receives both nets (2×). No house edge.</div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={onCreate} disabled={disableCreate} className="min-w-[170px] violet-ring">
          Create & deposit
        </Button>

        <div className="text-xs text-zinc-500">
          {disableCreate ? "Connect wallet to play." : "You will sign a transfer in Phantom."}
        </div>
      </div>
    </Card>
  );
}
