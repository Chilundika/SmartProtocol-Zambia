import type { Metadata } from "next";

import { EmbeddedWalletProvider } from "@/src/context/EmbeddedWalletContext";
import { FunderAuthProvider } from "@/src/context/FunderAuthContext";
import { VendorWalletProvider } from "@/src/context/VendorWalletContext";
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
        <WalletProvider>
          <FunderAuthProvider>
            <EmbeddedWalletProvider>
              <VendorWalletProvider>{children}</VendorWalletProvider>
            </EmbeddedWalletProvider>
          </FunderAuthProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
