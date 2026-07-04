import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "RoofRank — Commercial Solar Prospecting",
  description: "Search and rank commercial rooftops for solar ROI, powered by Lucenia hybrid geo + semantic search.",
};

// Runs before hydration so the correct theme paints on first frame (no flash of light).
// Falls back to the OS preference when nothing is stored.
const THEME_INIT = `try{var t=localStorage.getItem('roofrank-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable} h-full`}>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT }} /></head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
