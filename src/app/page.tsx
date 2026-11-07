"use client";

import { useState } from "react";
import { CassettePlayer } from "@/components/cassette/cassette-player";
import { CassetteDeck3D } from "@/components/cassette3d";
import { Box, RotateCcw } from "lucide-react";

export default function Home() {
  const [view, setView] = useState<"2d" | "3d">("2d");

  return (
    <div
      className={`min-h-screen flex flex-col text-stone-200 ${view === "3d" ? "overflow-hidden" : ""}`}
      style={{
        overscrollBehavior: "none",
        touchAction: "pan-y",
        // 纯色机身背景：深炭灰带细密扫描线纹理（性能优：无渐变无模糊）
        backgroundColor: "#1a1a1c",
        backgroundImage:
          "repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0 1px, transparent 1px 3px)",
      }}
    >
      {/* 3D 全屏视图（叠加层，覆盖一切） */}
      {view === "3d" && <CassetteDeck3D onBack={() => setView("2d")} />}

      {/* 2D 视图：3D 模式下隐藏避免透出 */}
      <div className={view === "3d" ? "hidden" : "contents"}>
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
          <div className="flex items-start justify-between gap-4">
            <div>
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

            {/* 2D / 3D 视图切换 */}
            <button
              onClick={() => setView(view === "2d" ? "3d" : "2d")}
              className="flex items-center gap-2 px-3.5 py-2.5 flex-shrink-0 transition-colors group"
              style={{
                border: "2px solid #000",
                boxShadow: "0 0 0 1px #3a3a3e, 0 3px 0 #000",
                backgroundColor: view === "3d" ? "#e8a050" : "#2a2a2e",
              }}
              aria-label={view === "2d" ? "切换到 3D 视图" : "返回 2D 视图"}
            >
              {view === "2d" ? (
                <Box className="w-4 h-4 text-amber-400" />
              ) : (
                <RotateCcw className="w-4 h-4 text-stone-900" />
              )}
              <span
                className={`text-xs font-mono tracking-wider ${
                  view === "3d" ? "text-stone-900" : "text-stone-300"
                }`}
              >
                {view === "2d" ? "3D" : "2D"}
              </span>
            </button>
          </div>
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
      </div>{/* 2D 视图包裹结束 */}
    </div>
  );
}
