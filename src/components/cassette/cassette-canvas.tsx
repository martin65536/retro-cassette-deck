"use client";

import React from "react";

export type Winding = "forward" | "rewind" | null;

export interface CassetteDrawState {
  leftAngle: number;
  rightAngle: number;
  progress: number;
  name: string;
  artist: string;
  album?: string;
  playing: boolean;
  winding: Winding;
  hasTape: boolean;
}

interface CassetteCanvasProps {
  onDragStart: (side: "left" | "right") => void;
  onDragEnd: () => void;
  onRotate: (deltaRad: number, side: "left" | "right") => void;
}

// 逻辑画布尺寸
const W = 460;
const H = 300;

// 带卷几何
const REEL_L = { x: 140, y: 172, r: 54 };
const REEL_R = { x: 320, y: 172, r: 54 };
const TAPE_MAX_R = 42;
const TAPE_MIN_R = 12;

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

function angleDelta(prev: number, cur: number) {
  let d = cur - prev;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function tapeRadius(progress: number, isLeft: boolean) {
  const A = TAPE_MAX_R * TAPE_MAX_R;
  const B = TAPE_MIN_R * TAPE_MIN_R;
  const p = clamp(progress, 0, 1);
  const area = isLeft ? A - (A - B) * p : B + (A - B) * p;
  return Math.sqrt(Math.max(B, area));
}

function truncText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: string
) {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

/**
 * Canvas 磁带渲染器（黑白极简，精致细节）
 *
 * 细节清单：
 * - 外壳：纯白底 + 1px 黑边，顶/底两条细线分隔
 * - 标签区：左侧黑色色块 + 歌名/艺术家/专辑三行排版 + 右侧 SIDE A 标记
 * - 带卷窗口：黑色凹陷，带内阴影
 * - 带卷：外环齿轮齿（8个）、内辐条（6根）、磁带卷（同心圆纹理 + 径向纹理）、六角轴心
 * - 磁带带子：S形曲线连接两卷，经磁头窗口
 * - 磁头窗口：底部黑色条带 + 读头指示
 * - 螺丝：四角十字螺丝
 * - 状态灯：PLAY/FF/REW 指示
 * - 底部品牌字
 */
export class CassetteCanvas extends React.Component<CassetteCanvasProps> {
  private canvasEl: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private dpr = 1;

  private dragging = false;
  private dragSide: "left" | "right" = "right";
  private dragCenter = { x: 0, y: 0 };
  private lastAngle = 0;

  private boundMove: (e: PointerEvent) => void;
  private boundUp: () => void;

  constructor(props: CassetteCanvasProps) {
    super(props);
    this.boundMove = (e: PointerEvent) => this.onMove(e);
    this.boundUp = () => this.onUp();
  }

  componentDidMount() {
    if (this.canvasEl) {
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.canvasEl.width = W * this.dpr;
      this.canvasEl.height = H * this.dpr;
      this.ctx = this.canvasEl.getContext("2d");
      if (this.ctx) this.ctx.scale(this.dpr, this.dpr);
      this.draw({
        leftAngle: 0,
        rightAngle: 0,
        progress: 0,
        name: "",
        artist: "",
        playing: false,
        winding: null,
        hasTape: false,
      });
    }
  }

  componentWillUnmount() {
    window.removeEventListener("pointermove", this.boundMove);
    window.removeEventListener("pointerup", this.boundUp);
    window.removeEventListener("pointercancel", this.boundUp);
  }

  draw(state: CassetteDrawState) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    this.drawShell(ctx);
    this.drawScrews(ctx);
    this.drawLabel(ctx, state);
    this.drawWindow(ctx);
    if (state.hasTape) {
      const lt = tapeRadius(state.progress, true);
      const rt = tapeRadius(state.progress, false);
      this.drawTapeBand(ctx, lt, rt);
      this.drawReel(ctx, REEL_L, state.leftAngle, lt);
      this.drawReel(ctx, REEL_R, state.rightAngle, rt);
    } else {
      this.drawEmptyReels(ctx);
    }
    this.drawHeadWindow(ctx, state);
    this.drawStatusLED(ctx, state);
    this.drawBrandText(ctx);
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ===== 外壳：纯白底 + 黑边 + 顶底细线 =====
  private drawShell(ctx: CanvasRenderingContext2D) {
    // 主体白底，极小圆角（2px）
    ctx.fillStyle = "#fafafa";
    this.roundRect(ctx, 4, 4, W - 8, H - 8, 2);
    ctx.fill();
    // 外黑边 1px
    ctx.strokeStyle = "#0a0a0a";
    ctx.lineWidth = 1;
    this.roundRect(ctx, 4, 4, W - 8, H - 8, 2);
    ctx.stroke();
    // 顶部细线（标签上分隔）
    ctx.beginPath();
    ctx.moveTo(4, 100);
    ctx.lineTo(W - 4, 100);
    ctx.stroke();
    // 底部细线（磁头窗口上分隔）
    ctx.beginPath();
    ctx.moveTo(4, 244);
    ctx.lineTo(W - 4, 244);
    ctx.stroke();
  }

  // ===== 四角十字螺丝 =====
  private drawScrews(ctx: CanvasRenderingContext2D) {
    const pos = [
      [16, 16],
      [W - 16, 16],
      [16, H - 16],
      [W - 16, H - 16],
    ];
    for (const [x, y] of pos) {
      // 螺丝圆
      ctx.fillStyle = "#e0e0e0";
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#999";
      ctx.lineWidth = 0.5;
      ctx.stroke();
      // 十字槽
      ctx.strokeStyle = "#666";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 2, y);
      ctx.lineTo(x + 2, y);
      ctx.moveTo(x, y - 2);
      ctx.lineTo(x, y + 2);
      ctx.stroke();
    }
  }

  // ===== 标签区 =====
  private drawLabel(
    ctx: CanvasRenderingContext2D,
    state: CassetteDrawState
  ) {
    // 左侧黑色色块
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(14, 110, 5, 84);

    // 歌名（大号粗体）
    ctx.fillStyle = "#0a0a0a";
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    const name = state.hasTape
      ? truncText(ctx, state.name, 250, "700 17px ui-monospace, 'Courier New', monospace")
      : "—— NO TAPE ——";
    ctx.font = "700 17px ui-monospace, 'Courier New', monospace";
    ctx.fillText(name, 28, 132);

    // 艺术家（中号）
    ctx.fillStyle = "#555";
    ctx.font = "11px ui-monospace, 'Courier New', monospace";
    const artist = state.hasTape
      ? truncText(ctx, state.artist.toUpperCase(), 250, "11px ui-monospace, 'Courier New', monospace")
      : "INSERT A CASSETTE TO PLAY";
    ctx.fillText(artist, 28, 150);

    // 专辑（小号灰）
    if (state.hasTape && state.album) {
      ctx.fillStyle = "#999";
      ctx.font = "9px ui-monospace, 'Courier New', monospace";
      ctx.fillText(
        truncText(ctx, state.album, 250, "9px ui-monospace, 'Courier New', monospace"),
        28,
        165
      );
    }

    // 右侧 SIDE A 标记（黑底白字方块）
    const sx = W - 80;
    const sy = 120;
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(sx, sy, 52, 14);
    ctx.fillStyle = "#fafafa";
    ctx.font = "700 9px ui-monospace, 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillText("SIDE A", sx + 26, sy + 10);
    ctx.textAlign = "left";

    // 下方规格标记
    ctx.fillStyle = "#999";
    ctx.font = "8px ui-monospace, 'Courier New', monospace";
    ctx.fillText("90 MIN · TYPE II CHROME", sx, 186);
  }

  // ===== 带卷窗口（黑色凹陷）=====
  private drawWindow(ctx: CanvasRenderingContext2D) {
    // 黑色凹陷窗口
    ctx.fillStyle = "#0a0a0a";
    this.roundRect(ctx, 56, 108, W - 112, 132, 1);
    ctx.fill();
    // 内边高光（上沿）
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(57, 109);
    ctx.lineTo(W - 57, 109);
    ctx.stroke();
  }

  private drawEmptyReels(ctx: CanvasRenderingContext2D) {
    for (const reel of [REEL_L, REEL_R]) {
      // 虚线圆
      ctx.strokeStyle = "#444";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(reel.x, reel.y, reel.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // 中心轴
      ctx.fillStyle = "#333";
      ctx.beginPath();
      ctx.arc(reel.x, reel.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#888";
      ctx.beginPath();
      ctx.arc(reel.x, reel.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ===== 磁带带子（S 形曲线经磁头）=====
  private drawTapeBand(
    ctx: CanvasRenderingContext2D,
    lt: number,
    rt: number
  ) {
    const lx = REEL_L.x + lt * 0.4;
    const ly = REEL_L.y + lt * 0.92;
    const rx = REEL_R.x - rt * 0.4;
    const ry = REEL_R.y + rt * 0.92;
    const hl = 195;
    const hr = 265;
    const hy = 232;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.quadraticCurveTo(lx + 12, hy + 4, hl, hy);
    ctx.lineTo(hr, hy);
    ctx.quadraticCurveTo(rx - 12, hy + 4, rx, ry);
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.stroke();
    // 高光线
    ctx.strokeStyle = "#3a3a3a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lx, ly - 1);
    ctx.quadraticCurveTo(lx + 12, hy + 3, hl, hy - 1);
    ctx.lineTo(hr, hy - 1);
    ctx.quadraticCurveTo(rx - 12, hy + 3, rx, ry - 1);
    ctx.stroke();
  }

  // ===== 单个带卷（精致细节）=====
  private drawReel(
    ctx: CanvasRenderingContext2D,
    reel: { x: number; y: number; r: number },
    angle: number,
    tapeR: number
  ) {
    ctx.save();
    ctx.translate(reel.x, reel.y);
    ctx.rotate((angle * Math.PI) / 180);

    // 外环底（深灰）
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.arc(0, 0, reel.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#3a3a3a";
    ctx.lineWidth = 1;
    ctx.stroke();

    // 8 个外缘齿轮齿
    ctx.fillStyle = "#2a2a2a";
    for (let i = 0; i < 8; i++) {
      ctx.save();
      ctx.rotate((i * 45 * Math.PI) / 180);
      this.roundRect(ctx, -2.5, -reel.r - 3, 5, 6, 0.5);
      ctx.fill();
      ctx.restore();
    }

    // 外环内圈线
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.arc(0, 0, reel.r - 4, 0, Math.PI * 2);
    ctx.stroke();

    // 磁带卷（深色圆盘）
    ctx.fillStyle = "#0d0d0d";
    ctx.beginPath();
    ctx.arc(0, 0, tapeR, 0, Math.PI * 2);
    ctx.fill();

    // 磁带同心圆纹理（细线）
    if (tapeR > TAPE_MIN_R + 1) {
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 0.3;
      const rings = Math.floor((tapeR - TAPE_MIN_R) / 2);
      for (let i = 1; i <= rings; i++) {
        const r = TAPE_MIN_R + i * 2;
        if (r < tapeR) {
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // 径向辐条纹理（12根，淡）
    if (tapeR > TAPE_MIN_R + 3) {
      ctx.strokeStyle = "#1f1f1f";
      ctx.lineWidth = 0.25;
      for (let i = 0; i < 12; i++) {
        const a = (i * 30 * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * TAPE_MIN_R, Math.sin(a) * TAPE_MIN_R);
        ctx.lineTo(Math.cos(a) * (tapeR - 0.5), Math.sin(a) * (tapeR - 0.5));
        ctx.stroke();
      }
    }

    // 6 根辐条（从中心到外环，白色细线，可见旋转）
    ctx.strokeStyle = "#666";
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      const a = (i * 60 * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 9, Math.sin(a) * 9);
      ctx.lineTo(Math.cos(a) * (reel.r - 6), Math.sin(a) * (reel.r - 6));
      ctx.stroke();
    }

    // 中心轴孔（六角）
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fill();
    // 六角花键
    ctx.fillStyle = "#4a4a4a";
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * 60 * Math.PI) / 180;
      const px = Math.cos(a) * 5;
      const py = Math.sin(a) * 5;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    // 中心点
    ctx.fillStyle = "#888";
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ===== 磁头窗口 =====
  private drawHeadWindow(
    ctx: CanvasRenderingContext2D,
    state: CassetteDrawState
  ) {
    // 黑色磁头条带
    ctx.fillStyle = "#0a0a0a";
    this.roundRect(ctx, 185, 248, 90, 18, 1);
    ctx.fill();
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 0.5;
    ctx.stroke();
    // 磁头读头
    ctx.fillStyle = "#444";
    ctx.fillRect(195, 254, 70, 5);
    // 读头指示（播放时白条）
    ctx.fillStyle = state.playing ? "#fafafa" : "#333";
    ctx.fillRect(210, 255, 40, 2);
  }

  // ===== 状态灯 =====
  private drawStatusLED(
    ctx: CanvasRenderingContext2D,
    state: CassetteDrawState
  ) {
    const x = 24;
    const y = 258;
    // 灯
    if (state.playing || state.winding) {
      ctx.fillStyle = "#0a0a0a";
    } else {
      ctx.fillStyle = "#444";
    }
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    // 状态文字
    ctx.fillStyle = "#666";
    ctx.font = "8px ui-monospace, 'Courier New', monospace";
    const st = state.winding === "forward"
      ? "FF"
      : state.winding === "rewind"
        ? "REW"
        : state.playing
          ? "PLAY"
          : "STOP";
    ctx.fillText(st, 32, 261);
  }

  private drawBrandText(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#999";
    ctx.font = "8px ui-monospace, 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      "R E T R O   ·   C A S S E T T E   ·   D E C K",
      W / 2,
      261
    );
    ctx.textAlign = "left";
  }

  // ===== 拖拽 =====
  private toLogical(clientX: number, clientY: number) {
    const rect = this.canvasEl!.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * W,
      y: ((clientY - rect.top) / rect.height) * H,
    };
  }

  private hitTest(x: number, y: number): "left" | "right" | null {
    const dl = Math.hypot(x - REEL_L.x, y - REEL_L.y);
    const dr = Math.hypot(x - REEL_R.x, y - REEL_R.y);
    if (dl < REEL_L.r + 8 && dl <= dr) return "left";
    if (dr < REEL_R.r + 8) return "right";
    return null;
  }

  onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = this.toLogical(e.clientX, e.clientY);
    const side = this.hitTest(x, y);
    if (!side) return;
    e.preventDefault();
    this.dragging = true;
    this.dragSide = side;
    const reel = side === "left" ? REEL_L : REEL_R;
    this.dragCenter = { x: reel.x, y: reel.y };
    this.lastAngle = Math.atan2(y - reel.y, x - reel.x);
    window.addEventListener("pointermove", this.boundMove, {
      passive: false,
    });
    window.addEventListener("pointerup", this.boundUp);
    window.addEventListener("pointercancel", this.boundUp);
    this.props.onDragStart(side);
  };

  private onMove(e: PointerEvent) {
    if (!this.dragging) return;
    e.preventDefault();
    const { x, y } = this.toLogical(e.clientX, e.clientY);
    const angle = Math.atan2(y - this.dragCenter.y, x - this.dragCenter.x);
    const delta = angleDelta(this.lastAngle, angle);
    this.lastAngle = angle;
    this.props.onRotate(delta, this.dragSide);
  }

  private onUp() {
    if (!this.dragging) return;
    this.dragging = false;
    window.removeEventListener("pointermove", this.boundMove);
    window.removeEventListener("pointerup", this.boundUp);
    window.removeEventListener("pointercancel", this.boundUp);
    this.props.onDragEnd();
  }

  render() {
    return (
      <canvas
        ref={(el) => {
          this.canvasEl = el;
        }}
        onPointerDown={this.onPointerDown}
        className="w-full h-auto select-none"
        style={{ touchAction: "none", cursor: "grab" }}
      />
    );
  }
}
