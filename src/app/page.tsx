import { CassettePlayer } from "@/components/cassette/cassette-player";

export default function Home() {
  return (
    <div
      className="min-h-screen flex flex-col bg-white text-black relative"
      style={{ overscrollBehavior: "none", touchAction: "pan-y" }}
    >
      {/* 顶部细黑线 */}
      <div className="h-px bg-black" />

      {/* Header */}
      <header className="pt-10 sm:pt-14 pb-2 px-4 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 border border-black mb-5">
          <span className="w-1.5 h-1.5 rounded-none bg-black" />
          <span className="text-[10px] tracking-[0.3em] font-mono text-black">
            ANALOG · DECK
          </span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-black">
          磁带录音机
        </h1>
        <p className="mt-2 text-sm sm:text-base text-gray-500 max-w-xl mx-auto">
          上传音频或解析网易云音乐，在带卷上转圈滑动即可手动快进 / 倒带
        </p>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-start sm:items-center justify-center px-3 sm:px-6 py-6 sm:py-10">
        <CassettePlayer />
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-black bg-white">
        <div className="max-w-3xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-500">
          <p className="font-mono">
            RETRO CASSETTE DECK · Web Audio API 实时合成
          </p>
          <p className="font-mono text-gray-400">
            Canvas 渲染 · 带卷可拖拽 · 实时倒放
          </p>
        </div>
      </footer>
    </div>
  );
}
