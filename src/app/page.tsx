import { CassettePlayer } from "@/components/cassette/cassette-player";

export default function Home() {
  return (
    <div
      className="min-h-screen flex flex-col bg-[#0a0a0c] text-stone-100 relative overflow-hidden"
      style={{ overscrollBehavior: "none", touchAction: "pan-y" }}
    >
      {/* 碳纤维纹理背景 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(217,119,6,0.12), transparent), radial-gradient(ellipse 40% 30% at 10% 80%, rgba(184,115,51,0.08), transparent), radial-gradient(ellipse 40% 30% at 90% 70%, rgba(217,119,6,0.06), transparent)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, #888 0 1px, transparent 1px 4px), repeating-linear-gradient(-45deg, #888 0 1px, transparent 1px 4px)",
        }}
      />

      {/* 顶部铜色细带 */}
      <div className="h-1 bg-gradient-to-r from-amber-900 via-orange-600 to-amber-900 relative z-10" />

      {/* Header */}
      <header className="relative z-10 pt-8 sm:pt-12 pb-2 px-4 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-700/30 bg-stone-950/60 mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
          <span className="text-[10px] tracking-[0.3em] font-mono text-amber-400/80">
            ANALOG · DECK
          </span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight">
          <span className="bg-gradient-to-b from-amber-200 to-orange-600 bg-clip-text text-transparent">
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
      <footer className="relative z-10 mt-auto border-t border-amber-900/20 bg-black/60">
        <div className="max-w-3xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-stone-500">
          <p className="font-mono">
            RETRO CASSETTE DECK · Web Audio API 实时合成
          </p>
          <p className="font-mono text-stone-600">
            Canvas 渲染 · 带卷可拖拽 · 实时倒放
          </p>
        </div>
      </footer>
    </div>
  );
}
