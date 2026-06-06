import type { Metadata } from "next";

import { WalletProvider } from "@/src/context/WalletContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "SmartProtocol Zambia | Verified Milestone Payouts",
  description:
    "VMP escrow on Stellar for funders, farmers, and vendors in Zambia.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
