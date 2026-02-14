"use client";

import { useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function WalletButton() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    // placeholder så layout ikke hopper
    return <div style={{ height: 48, width: 180 }} />;
  }

  return <WalletMultiButton />;
}
