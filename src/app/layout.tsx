import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import Providers from "./providers";


// Global CSS (ingen Google @import i CSS!)
import "./globals.css";

// Wallet adapter styles (SKAL importeres her)
import "@solana/wallet-adapter-react-ui/styles.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Reaction Duel",
  description: "Skill-based PvP reaction game on Solana",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="da">
      <body className={dmSans.variable} style={{ fontFamily: "var(--font-sans), Arial, sans-serif" }}>
  <Providers>{children}</Providers>
</body>

    </html>
  );
}
