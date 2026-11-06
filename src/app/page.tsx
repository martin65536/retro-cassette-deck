import { CassettePlayer } from "@/components/cassette/cassette-player";

export default function Home() {
  return (
    <div
      className="min-h-screen flex flex-col bg-gradient-to-b from-stone-900 via-stone-900 to-amber-950 text-stone-100 relative overflow-hidden"
      style={{ overscrollBehavior: "none", touchAction: "pan-y" }}
    >
      {/* 背景暖色光晕装饰 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(217,119,6,0.25), transparent), radial-gradient(ellipse 60% 40% at 15% 20%, rgba(180,83,9,0.15), transparent), radial-gradient(ellipse 60% 40% at 85% 30%, rgba(154,52,18,0.15), transparent)",
        }}
      />
      {/* 噪点纹理 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {/* 顶部色带 */}
      <div className="h-1.5 bg-gradient-to-r from-orange-700 via-amber-500 to-red-800 relative z-10" />

      {/* Header */}
      <header className="relative z-10 pt-8 sm:pt-12 pb-2 px-4 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-700/40 bg-amber-950/40 mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
          <span className="text-[10px] tracking-[0.25em] font-mono text-amber-300/90">
            ANALOG · 1979
          </span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight">
          <span className="bg-gradient-to-b from-amber-100 to-amber-400 bg-clip-text text-transparent">
            磁带录音机
          </span>
        </h1>
        <p className="mt-2 text-sm sm:text-base text-stone-400 max-w-xl mx-auto">
          上传音频或解析网易云音乐，在带卷上转圈滑动即可手动快进 / 倒带
        </p>
      </header>

      {/* Main */}
      <main className="relative z-10 flex-1 flex items-start sm:items-center justify-center px-3 sm:px-6 py-6 sm:py-10">
        <CassettePlayer />
      </main>

      {/* Footer（sticky bottom） */}
      <footer className="relative z-10 mt-auto border-t border-amber-900/30 bg-stone-950/60 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-stone-500">
          <p className="font-mono">
            RETRO CASSETTE DECK · Web Audio API 实时合成音效
          </p>
          <p className="font-mono text-stone-600">
            提示：带卷可拖拽 · 按钮支持长按快进/快退
          </p>
        </div>
      </footer>
    </div>
  );
}
