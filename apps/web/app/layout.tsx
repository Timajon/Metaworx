import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "SignalForge",
  description: "Luno spot trading terminal with Grok analysis",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
