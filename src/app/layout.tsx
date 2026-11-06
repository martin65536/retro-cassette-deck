import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "复古磁带录音机 · Cassette Deck",
  description:
    "一个模拟磁带播放的单页网页：上传音频或解析网易云音乐，在带卷上转圈滑动即可手动快进/倒带，快进退声音和其它操作均用 Web Audio API 实时合成。",
  keywords: [
    "磁带",
    "cassette",
    "tape",
    "复古",
    "音乐播放器",
    "Web Audio",
    "网易云音乐",
  ],
  authors: [{ name: "Z.ai" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
