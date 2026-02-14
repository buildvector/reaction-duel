"use client";

import { Button, Card, Pill, Label, Hint, Mono } from "./ui";

export type Duel = {
  duelId: string;
  stakeLamports: number;
  feeBps: number;
  createdBy: string;
  joinedBy?: string;
  createdAt: number;
  updatedAt: number;
  phase: "lobby" | "countdown" | "waiting_random" | "go" | "finished";
};

function short(pk?: string) {
  if (!pk) return "—";
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}

export default function DuelLobbyCard(props: {
  duel: Duel;
  joining: boolean;
  canJoin: boolean;
  onJoin: () => void;
}) {
  const { duel: d, joining, canJoin, onJoin } = props;

  const stakeSol = (d.stakeLamports / 1_000_000_000).toFixed(2);

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-lg font-semibold tracking-tight">{stakeSol} SOL</div>
            <Pill>{d.phase}</Pill>
            <Pill tone="green">open</Pill>
          </div>

          <Hint className="mt-2">
            Duel ID: <span className="text-zinc-300">{d.duelId}</span>
          </Hint>

          <div className="mt-2 grid gap-1 text-xs text-zinc-400">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="!text-zinc-500">Creator</Label>
              <Mono className="text-xs text-zinc-200">{short(d.createdBy)}</Mono>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="primary" disabled={!canJoin || joining} onClick={onJoin} className="min-w-[120px]">
            {joining ? "Joining…" : "Join"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
