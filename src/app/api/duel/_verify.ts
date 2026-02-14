import { Connection, PublicKey } from "@solana/web3.js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`MISSING_ENV:${name}`);
  return v;
}

export function serverConnection() {
  // mainnet helius
  const url = mustEnv("SOLANA_RPC_URL");
  return new Connection(url, "confirmed");
}

export function treasuryPubkey() {
  const pk = mustEnv("NEXT_PUBLIC_TREASURY_PUBKEY");
  return new PublicKey(pk);
}

// Verifies: `from` paid exactly `lamports` to treasury in tx `signature`
export async function verifyTreasuryTransfer(params: {
  signature: string;
  from: string;
  lamports: number;
}) {
  const connection = serverConnection();
  const sig = params.signature;
  const fromPk = new PublicKey(params.from);
  const treasPk = treasuryPubkey();

  const tx = await connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!tx) throw new Error("TX_NOT_FOUND");
  if (!tx.meta) throw new Error("TX_NO_META");
  if (tx.meta.err) throw new Error("TX_FAILED");

  const keys = tx.transaction.message.getAccountKeys().staticAccountKeys;
  const fromIdx = keys.findIndex((k) => k.equals(fromPk));
  const treIdx = keys.findIndex((k) => k.equals(treasPk));
  if (fromIdx < 0) throw new Error("TX_MISSING_FROM");
  if (treIdx < 0) throw new Error("TX_MISSING_TREASURY");

  const pre = tx.meta.preBalances;
  const post = tx.meta.postBalances;

  const fromDelta = post[fromIdx] - pre[fromIdx];
  const treDelta = post[treIdx] - pre[treIdx];

  // treasury must increase by at least lamports, payer must decrease by at least lamports
  // (fee makes payer decrease a bit more)
  if (treDelta < params.lamports) throw new Error("BAD_TREASURY_AMOUNT");
  if (fromDelta > -params.lamports) throw new Error("BAD_PAYER_AMOUNT");

  return { ok: true as const };
}
