import type { Metadata } from "next";
import { Baloo_2, Lexend, Overpass, Public_Sans } from "next/font/google";
import "./globals.css";

// Fonts are downloaded at build time and self-hosted by next/font, so no request goes to
// Google at runtime (compatible with the strict CSP). Each exposes a CSS variable that
// app/globals.css composes into the calm and sticker font stacks.

// Calm skin: Overpass 700/800 for headings and buttons.
const overpass = Overpass({
  variable: "--font-overpass",
  subsets: ["latin"],
  weight: ["700", "800"],
  display: "swap",
});

// Calm skin: Public Sans 400/700 for body text.
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

// Sticker book skin: Baloo 2 800 for headings and names.
const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin"],
  weight: ["800"],
  display: "swap",
});

// Sticker book skin: Lexend 400/600 for body text.
const lexend = Lexend({
  variable: "--font-lexend",
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "CivicQuest",
  description: "Civic missions for classes, partners, and student leaders.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${overpass.variable} ${publicSans.variable} ${baloo.variable} ${lexend.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
