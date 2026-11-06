import { CassettePlayer } from "@/components/cassette/cassette-player";

export default function Home() {
  return (
    <div
      className="min-h-screen flex flex-col text-stone-200"
      style={{
        overscrollBehavior: "none",
        touchAction: "pan-y",
        // 纯色机身背景：深炭灰带细密扫描线纹理（性能优：无渐变无模糊）
        backgroundColor: "#1a1a1c",
        backgroundImage:
          "repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0 1px, transparent 1px 3px)",
      }}
    >
      {/* Header：金属铭牌风格 */}
      <header
        className="px-6 pt-10 sm:pt-14 pb-6"
        style={{
          borderBottom: "2px solid #000",
          boxShadow: "0 2px 0 #2a2a2e, 0 4px 0 #000",
          backgroundColor: "#222226",
        }}
      >
        <div className="max-w-3xl mx-auto">
          <p
            className="text-[10px] tracking-[0.3em] font-mono mb-3"
            style={{ color: "#9a8a6a" }}
          >
            ◼ RETRO · ANALOG · CASSETTE · DECK
          </p>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight leading-none text-stone-100">
            磁带录音机
          </h1>
          <p className="mt-3 text-sm text-stone-400">
            上传音频或解析网易云音乐，在带卷上转圈滑动即可手动快进 / 倒带
          </p>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-start sm:items-center justify-center px-3 sm:px-6 py-8 sm:py-10">
        <CassettePlayer />
      </main>

      {/* Footer：金属底板 */}
      <footer
        style={{
          borderTop: "2px solid #000",
          boxShadow: "0 -2px 0 #2a2a2e, 0 -4px 0 #000",
          backgroundColor: "#222226",
        }}
      >
        <div className="max-w-3xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-stone-500">
          <p className="font-mono">Web Audio API 实时合成 · Canvas 渲染</p>
          <p className="font-mono">带卷可拖拽 · 实时倒放 · 采样模式无限倍速</p>
        </div>
      </footer>
    </div>
  );
}
