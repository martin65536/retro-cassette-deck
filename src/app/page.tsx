import { CassettePlayer } from "@/components/cassette/cassette-player";

export default function Home() {
  return (
    <div
      className="min-h-screen flex flex-col bg-white text-black"
      style={{ overscrollBehavior: "none", touchAction: "pan-y" }}
    >
      {/* Header：纯文字排版，无装饰 */}
      <header className="px-6 pt-10 sm:pt-14 pb-6 border-b border-black">
        <div className="max-w-3xl mx-auto">
          <p className="text-[10px] tracking-[0.3em] font-mono text-black mb-3">
            RETRO · ANALOG · CASSETTE · DECK
          </p>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-black leading-none">
            磁带录音机
          </h1>
          <p className="mt-3 text-sm text-gray-600">
            上传音频或解析网易云音乐，在带卷上转圈滑动即可手动快进 / 倒带
          </p>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-start sm:items-center justify-center px-3 sm:px-6 py-8 sm:py-10">
        <CassettePlayer />
      </main>

      {/* Footer */}
      <footer className="border-t border-black bg-white">
        <div className="max-w-3xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-500">
          <p className="font-mono">
            Web Audio API 实时合成 · Canvas 渲染
          </p>
          <p className="font-mono">
            带卷可拖拽 · 实时倒放 · ×15 倍速
          </p>
        </div>
      </footer>
    </div>
  );
}
