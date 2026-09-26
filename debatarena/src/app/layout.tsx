import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist } from "next/font/google";
import "./globals.css";

const body = Geist({ variable: "--font-body", subsets: ["latin"] });
const display = Bricolage_Grotesque({ variable: "--font-display-face", subsets: ["latin"], weight: ["600", "800"] });

export const metadata: Metadata = {
  title: "Debatarena",
  description: "Laat AI-rollen debatteren over jouw vraagstuk. Jij bent de baas.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fbf6ee",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={`${body.variable} ${display.variable} h-full`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
