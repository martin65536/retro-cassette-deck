"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { ChevronLeft, Info, X } from "lucide-react";

// Three.js 必须客户端渲染，禁 SSR
const CassetteDeck3DCanvas = dynamic(
  () => import("./cassette-deck-3d").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-[#1c1c22]">
        <div className="text-stone-500 text-xs font-mono tracking-widest animate-pulse">
          LOADING 3D SCENE…
        </div>
      </div>
    ),
  }
);

interface CassetteDeck3DProps {
  onBack?: () => void;
}

/**
 * 3D 磁带机全屏视图
 * - 全屏 Canvas（fixed inset-0）
 * - 顶部 HUD：返回按钮 + 标题 + 操作提示
 * - 底部 HUD：交互说明（可收起）
 */
export function CassetteDeck3D({ onBack }: CassetteDeck3DProps) {
  const [showHelp, setShowHelp] = useState(true);

  return (
    <div className="fixed inset-0 z-50 bg-[#1c1c22]" style={{ touchAction: "none" }}>
      {/* 3D 画布 */}
      <CassetteDeck3DCanvas />

      {/* 顶部 HUD */}
      <div className="absolute top-0 left-0 right-0 p-4 sm:p-5 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="pointer-events-auto flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-stone-200 text-xs hover:bg-black/70 transition-colors"
              aria-label="返回"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">返回 2D</span>
            </button>
          )}
          <div className="px-3 py-2 rounded-full bg-black/50 backdrop-blur-md border border-white/10">
            <p className="text-[10px] tracking-[0.25em] font-mono text-amber-400/80">
              3D · CASSETTE DECK
            </p>
          </div>
        </div>

        <div className="pointer-events-auto">
          <p className="hidden sm:block text-[11px] font-mono text-stone-400 px-3 py-2 rounded-full bg-black/40 backdrop-blur-md border border-white/5">
            双指缩放 · 单指旋转 · 两指平移
          </p>
        </div>
      </div>

      {/* 底部 HUD：操作说明 */}
      {showHelp && (
        <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5 flex justify-center pointer-events-none">
          <div className="pointer-events-auto max-w-md w-full rounded-2xl bg-black/55 backdrop-blur-md border border-white/10 p-3.5 sm:p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <Info className="w-3.5 h-3.5 text-amber-400/80 flex-shrink-0" />
                <p className="text-xs font-medium text-stone-200">操作指南</p>
              </div>
              <button
                onClick={() => setShowHelp(false)}
                className="text-stone-500 hover:text-stone-300 transition-colors"
                aria-label="关闭"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <ul className="space-y-1 text-[11px] text-stone-400 leading-relaxed">
              <li>
                <span className="text-stone-200">点按按钮</span>：▶ 播放 / ■ 停止 / ◀◀▶▶ 快退快进 / ⏏ 弹出卡带
              </li>
              <li>
                <span className="text-stone-200">拖动卡带</span>：把右侧悬浮卡带拖到仓口装入；弹出后拖走卸载
              </li>
              <li>
                <span className="text-stone-200">视角</span>：双指捏合缩放，单指拖动旋转，两指平移
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* 底部状态条 */}
      <div className="absolute bottom-3 right-4 pointer-events-none">
        <p className="text-[9px] font-mono text-stone-600 tracking-wider">
          THREE.js · R3F
        </p>
      </div>
    </div>
  );
}

export default CassetteDeck3D;
