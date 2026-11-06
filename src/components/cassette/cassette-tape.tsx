"use client";

import React from "react";

export type Winding = "forward" | "rewind" | null;

export interface CassetteTapeProps {
  /** 播放进度 0~1（决定磁带半径，低频更新） */
  progress: number;
  /** 歌曲名 */
  name: string;
  /** 艺术家 */
  artist: string;
  /** 副标题（如专辑名） */
  album?: string;
  /** 是否在播放 */
  playing: boolean;
  /** 快进/快退状态 */
  winding: Winding;
  /** 是否有磁带（无磁带时显示空槽） */
  hasTape: boolean;
  /** 左带卷 ref（用于绑定拖拽 + 外部设置旋转 transform） */
  leftReelRef: (el: SVGGElement | null) => void;
  /** 右带卷 ref */
  rightReelRef: (el: SVGGElement | null) => void;
  /** 带卷指针按下 */
  onReelPointerDown: (
    e: React.PointerEvent<SVGGElement>,
    side: "left" | "right"
  ) => void;
}

// 带卷几何参数（导出，供主组件设置 transform 用）
export const REEL_GEOM = {
  leftCx: 130,
  rightCx: 290,
  cy: 165,
  outerR: 52,
  tapeMaxR: 42,
  tapeMinR: 12,
};

const REEL_CX_LEFT = REEL_GEOM.leftCx;
const REEL_CX_RIGHT = REEL_GEOM.rightCx;
const REEL_CY = REEL_GEOM.cy;
const REEL_OUTER_R = REEL_GEOM.outerR;
const TAPE_MAX_R = REEL_GEOM.tapeMaxR;
const TAPE_MIN_R = REEL_GEOM.tapeMinR;

// 配色（复古暖色调，避免蓝紫）
const COLORS = {
  shellLight: "#e8dcc0",
  shellDark: "#c4b08a",
  shellEdge: "#8b6f47",
  label: "#f4ecd8",
  labelEdge: "#d4c4a8",
  reelBase: "#2a1f17",
  reelTeeth: "#4a3525",
  tape: "#3a2818",
  tapeRing: "#5a4030",
  hub: "#1a1208",
  hubCenter: "#6b4f33",
  window: "#15100a",
  windowEdge: "#3d2b1f",
  screw: "#9a8260",
  screwSlot: "#4a3826",
  accent: "#c2410c",
};

/** 计算磁带半径（面积守恒） */
function tapeRadius(progress: number, isLeft: boolean) {
  const A = TAPE_MAX_R * TAPE_MAX_R;
  const B = TAPE_MIN_R * TAPE_MIN_R;
  const p = Math.max(0, Math.min(1, progress));
  const area = isLeft ? A - (A - B) * p : B + (A - B) * p;
  return Math.sqrt(Math.max(B, area));
}

interface ReelProps {
  cx: number;
  cy: number;
  tapeR: number;
  reelRef?: (el: SVGGElement | null) => void;
  onPointerDown?: (e: React.PointerEvent<SVGGElement>) => void;
}

/**
 * 单个带卷（React 类组件）。
 * 外层 <g> 的 transform 由主组件通过 ref 直接设置（rotate），以避免每帧 React 重渲染。
 */
class Reel extends React.Component<ReelProps> {
  render() {
    const { cx, cy, tapeR, reelRef, onPointerDown } = this.props;
    return (
    <g
      ref={reelRef}
      onPointerDown={onPointerDown}
      style={{ cursor: "grab", touchAction: "none" }}
    >
      {/* 拖拽热区：覆盖整个窗口的透明圆 */}
      <circle
        cx={cx}
        cy={cy}
        r={REEL_OUTER_R + 6}
        fill="transparent"
        style={{ pointerEvents: "all" }}
      />

      {/* 主圆盘 */}
      <circle cx={cx} cy={cy} r={REEL_OUTER_R} fill={COLORS.reelBase} />
      <circle
        cx={cx}
        cy={cy}
        r={REEL_OUTER_R}
        fill="none"
        stroke={COLORS.reelTeeth}
        strokeWidth={1.5}
      />

      {/* 6 个齿轮齿（外缘） */}
      {Array.from({ length: 6 }).map((_, i) => (
        <rect
          key={`tooth-${i}`}
          x={cx - 3.5}
          y={cy - REEL_OUTER_R - 5}
          width={7}
          height={9}
          rx={1.5}
          fill={COLORS.reelTeeth}
          transform={`rotate(${i * 60} ${cx} ${cy})`}
        />
      ))}

      {/* 内圈装饰环 */}
      <circle
        cx={cx}
        cy={cy}
        r={TAPE_MAX_R + 4}
        fill="none"
        stroke={COLORS.reelTeeth}
        strokeWidth={1}
        opacity={0.6}
      />

      {/* 磁带缠绕（动态半径） */}
      <circle cx={cx} cy={cy} r={tapeR} fill={COLORS.tape} />

      {/* 磁带同心圆纹理 */}
      {tapeR > TAPE_MIN_R + 2 &&
        [0.35, 0.55, 0.72, 0.86].map((p, i) => (
          <circle
            key={`ring-${i}`}
            cx={cx}
            cy={cy}
            r={TAPE_MIN_R + (tapeR - TAPE_MIN_R) * p}
            fill="none"
            stroke={COLORS.tapeRing}
            strokeWidth={0.4}
            opacity={0.5}
          />
        ))}

      {/* 磁带表面径向高光 */}
      {tapeR > TAPE_MIN_R + 4 &&
        Array.from({ length: 12 }).map((_, i) => {
          const a = (i * 30 * Math.PI) / 180;
          const x1 = cx + Math.cos(a) * TAPE_MIN_R;
          const y1 = cy + Math.sin(a) * TAPE_MIN_R;
          const x2 = cx + Math.cos(a) * (tapeR - 1);
          const y2 = cy + Math.sin(a) * (tapeR - 1);
          return (
            <line
              key={`spoke-${i}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={COLORS.tapeRing}
              strokeWidth={0.3}
              opacity={0.25}
            />
          );
        })}

      {/* 中心轴孔 */}
      <circle cx={cx} cy={cy} r={7} fill={COLORS.hub} />
      <circle cx={cx} cy={cy} r={4} fill={COLORS.hubCenter} />
      {/* 六角形花键 */}
      {Array.from({ length: 6 }).map((_, i) => {
        const a = (i * 60 * Math.PI) / 180;
        return (
          <line
            key={`spline-${i}`}
            x1={cx + Math.cos(a) * 2}
            y1={cy + Math.sin(a) * 2}
            x2={cx + Math.cos(a) * 6.5}
            y2={cy + Math.sin(a) * 6.5}
            stroke={COLORS.hub}
            strokeWidth={1}
          />
        );
      })}
    </g>
    );
  }
}

export class CassetteTape extends React.Component<CassetteTapeProps> {
  render() {
    const {
      progress,
      name,
      artist,
      album,
      playing,
      winding,
      hasTape,
      leftReelRef,
      rightReelRef,
      onReelPointerDown,
    } = this.props;

  const leftTapeR = tapeRadius(progress, true);
  const rightTapeR = tapeRadius(progress, false);

  // 磁带带子路径（连接两个卷，经过下方磁头）
  const leftExitX = REEL_CX_LEFT + leftTapeR * 0.45;
  const leftExitY = REEL_CY + leftTapeR * 0.89;
  const rightEntryX = REEL_CX_RIGHT - rightTapeR * 0.45;
  const rightEntryY = REEL_CY + rightTapeR * 0.89;
  const headLeftX = 180;
  const headRightX = 240;
  const headY = 228;
  const tapeBandPath = [
    `M ${leftExitX} ${leftExitY}`,
    `Q ${leftExitX + 15} ${headY + 6} ${headLeftX} ${headY}`,
    `L ${headRightX} ${headY}`,
    `Q ${rightEntryX - 15} ${headY + 6} ${rightEntryX} ${rightEntryY}`,
  ].join(" ");

  return (
    <svg
      viewBox="0 0 420 280"
      className="w-full h-auto select-none"
      style={{
        touchAction: "none",
      }}
      >
        <defs>
          <linearGradient id="shellGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.shellLight} />
            <stop offset="100%" stopColor={COLORS.shellDark} />
          </linearGradient>
          <linearGradient id="labelGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#faf3e0" />
            <stop offset="100%" stopColor={COLORS.label} />
          </linearGradient>
          <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4a3220" />
            <stop offset="50%" stopColor={COLORS.tape} />
            <stop offset="100%" stopColor="#2a1a0c" />
          </linearGradient>
          <radialGradient id="windowGrad" cx="0.5" cy="0.4" r="0.6">
            <stop offset="0%" stopColor="#2a1f17" />
            <stop offset="100%" stopColor={COLORS.window} />
          </radialGradient>
        </defs>

        {/* 磁带外壳主体 */}
        <rect
          x="6"
          y="6"
          width="408"
          height="268"
          rx="18"
          fill="url(#shellGrad)"
          stroke={COLORS.shellEdge}
          strokeWidth="2"
        />
        <rect
          x="14"
          y="14"
          width="392"
          height="252"
          rx="12"
          fill="none"
          stroke="#a8895c"
          strokeWidth="1"
          opacity={0.6}
        />

        {/* 四角螺丝 */}
        {[
          [22, 22],
          [398, 22],
          [22, 258],
          [398, 258],
        ].map(([x, y], i) => (
          <g key={`screw-${i}`}>
            <circle cx={x} cy={y} r="4" fill={COLORS.screw} />
            <line
              x1={x - 2.5}
              y1={y}
              x2={x + 2.5}
              y2={y}
              stroke={COLORS.screwSlot}
              strokeWidth="1"
            />
          </g>
        ))}

        {/* 顶部标签 */}
        <rect
          x="30"
          y="26"
          width="360"
          height="68"
          rx="4"
          fill="url(#labelGrad)"
          stroke={COLORS.labelEdge}
          strokeWidth="1"
        />
        <rect
          x="36"
          y="32"
          width="348"
          height="56"
          rx="2"
          fill="none"
          stroke={COLORS.labelEdge}
          strokeWidth="0.6"
          opacity={0.7}
        />
        <rect x="30" y="26" width="6" height="68" fill={COLORS.accent} />
        <rect
          x="36"
          y="26"
          width="3"
          height="68"
          fill={COLORS.accent}
          opacity="0.5"
        />

        <text
          x="50"
          y="52"
          fill="#3d2b1f"
          fontSize="17"
          fontWeight="700"
          fontFamily="ui-monospace, 'Courier New', monospace"
          style={{ letterSpacing: "0.5px" }}
        >
          {hasTape
            ? name.length > 28
              ? `${name.slice(0, 27)}…`
              : name
            : "—— NO TAPE ——"}
        </text>
        <text
          x="50"
          y="70"
          fill="#6b4f33"
          fontSize="11"
          fontFamily="ui-monospace, 'Courier New', monospace"
        >
          {hasTape ? artist.toUpperCase() : "INSERT A CASSETTE TO PLAY"}
        </text>
        {hasTape && album ? (
          <text
            x="50"
            y="84"
            fill="#9a7a55"
            fontSize="9"
            fontFamily="ui-monospace, 'Courier New', monospace"
          >
            {album.length > 44 ? `${album.slice(0, 43)}…` : album}
          </text>
        ) : null}

        <text
          x="380"
          y="48"
          fill={COLORS.accent}
          fontSize="11"
          fontWeight="700"
          textAnchor="end"
          fontFamily="ui-monospace, 'Courier New', monospace"
        >
          SIDE A
        </text>
        <text
          x="380"
          y="60"
          fill="#9a7a55"
          fontSize="8"
          textAnchor="end"
          fontFamily="ui-monospace, 'Courier New', monospace"
        >
          90 MIN · CHROME
        </text>

        {/* 带卷窗口背景 */}
        <rect
          x="55"
          y="108"
          width="310"
          height="120"
          rx="60"
          fill="url(#windowGrad)"
          stroke={COLORS.windowEdge}
          strokeWidth="2"
        />

        {hasTape ? (
          <>
            {/* 磁带带子 */}
            <path
              d={tapeBandPath}
              stroke="url(#bandGrad)"
              strokeWidth="6"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d={tapeBandPath}
              stroke="#5a4030"
              strokeWidth="0.6"
              fill="none"
              opacity="0.5"
            />

            {/* 左带卷（transform 由主组件通过 ref 设置） */}
            <Reel
              cx={REEL_CX_LEFT}
              cy={REEL_CY}
              tapeR={leftTapeR}
              reelRef={leftReelRef}
              onPointerDown={(e) => onReelPointerDown(e, "left")}
            />
            {/* 右带卷 */}
            <Reel
              cx={REEL_CX_RIGHT}
              cy={REEL_CY}
              tapeR={rightTapeR}
              reelRef={rightReelRef}
              onPointerDown={(e) => onReelPointerDown(e, "right")}
            />
          </>
        ) : (
          <>
            {/* 空磁带槽 */}
            {[REEL_CX_LEFT, REEL_CX_RIGHT].map((cx) => (
              <g key={`empty-${cx}`}>
                <circle
                  cx={cx}
                  cy={REEL_CY}
                  r={REEL_OUTER_R}
                  fill="none"
                  stroke="#3d2b1f"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity="0.4"
                />
                <circle cx={cx} cy={REEL_CY} r={7} fill={COLORS.hub} />
                <circle cx={cx} cy={REEL_CY} r={4} fill={COLORS.hubCenter} />
              </g>
            ))}
          </>
        )}

        {/* 磁头窗口 */}
        <rect
          x="168"
          y="214"
          width="84"
          height="20"
          rx="3"
          fill={COLORS.window}
          stroke={COLORS.windowEdge}
          strokeWidth="1"
        />
        <rect x="178" y="221" width="64" height="6" rx="1" fill="#5a4030" />
        <rect
          x="195"
          y="223"
          width="30"
          height="2"
          rx="0.5"
          fill={playing ? COLORS.accent : "#7a5a3a"}
          opacity={playing ? 0.9 : 0.5}
        />

        {/* 状态指示灯 */}
        <circle
          cx="40"
          cy="232"
          r="3"
          fill={playing ? COLORS.accent : "#5a4030"}
          opacity={playing ? 1 : 0.4}
        />
        {winding ? (
          <circle cx="40" cy="232" r="3" fill="#fbbf24" opacity="0.9">
            <animate
              attributeName="opacity"
              values="0.3;1;0.3"
              dur="0.4s"
              repeatCount="indefinite"
            />
          </circle>
        ) : null}
        <text
          x="48"
          y="235"
          fill="#8b6f47"
          fontSize="8"
          fontFamily="ui-monospace, 'Courier New', monospace"
        >
          {winding === "forward"
            ? "FF"
            : winding === "rewind"
              ? "REW"
              : playing
                ? "PLAY"
                : "STOP"}
        </text>

        <text
          x="210"
          y="262"
          fill="#8b6f47"
          fontSize="9"
          textAnchor="middle"
          fontFamily="ui-monospace, 'Courier New', monospace"
          letterSpacing="2"
        >
          RETRO · CASSETTE · DECK
        </text>
      </svg>
    );
  }
}
