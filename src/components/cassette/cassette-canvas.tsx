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
const W = 440;
const H = 300;

// 带卷几何
const REEL_L = { x: 135, y: 175, r: 56 };
const REEL_R = { x: 305, y: 175, r: 56 };
const TAPE_MAX_R = 44;
const TAPE_MIN_R = 13;

// 配色（新风格：暗色碳纤维 + 铜橙）
const C = {
  shellA: "#2b2b30",
  shellB: "#161619",
  shellEdge: "#08080a",
  shellHi: "#3e3e44",
  window: "#0d0d0f",
  windowEdge: "#3a3a40",
  reelBase: "#1c1c20",
  reelTeeth: "#4a4a52",
  tape: "#241408",
  tapeRing: "#3a2410",
  hub: "#b87333",
  hubDark: "#6a4220",
  label: "#3a2a1c",
  labelEdge: "#6a4a2a",
  accent: "#d97706",
  accentBright: "#f59e0b",
  ledOn: "#f59e0b",
  ledOff: "#3a2a1a",
  text: "#e8dcc8",
  textDim: "#9a8a6a",
  textAccent: "#e8a050",
  screw: "#6a6a70",
  screwSlot: "#2a2a2e",
};

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
  maxWidth: number
) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

/**
 * Canvas 磁带渲染器（无 DOM SVG，全部 Canvas 2D 绘制）
 * - 父组件持有 ref，每帧调用 draw(state) 更新画面
 * - 内置带卷拖拽手势：pointerdown 命中检测，pointermove 计算角度增量
 * - touch-action:none 阻止下拉刷新
 */
export class CassetteCanvas extends React.Component<CassetteCanvasProps> {
  private canvasEl: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private dpr = 1;

  // 拖拽状态
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
      // 初始绘制
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

  /** 父组件每帧调用，传入当前状态绘制 */
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

  private drawShell(ctx: CanvasRenderingContext2D) {
    const g = ctx.createLinearGradient(0, 8, 0, H - 8);
    g.addColorStop(0, C.shellA);
    g.addColorStop(1, C.shellB);
    ctx.fillStyle = g;
    this.roundRect(ctx, 6, 6, W - 12, H - 12, 16);
    ctx.fill();
    ctx.strokeStyle = C.shellEdge;
    ctx.lineWidth = 2;
    ctx.stroke();
    // 内边高光
    ctx.strokeStyle = C.shellHi;
    ctx.lineWidth = 1;
    this.roundRect(ctx, 14, 14, W - 28, H - 28, 11);
    ctx.stroke();
  }

  private drawScrews(ctx: CanvasRenderingContext2D) {
    const pos = [
      [24, 24],
      [W - 24, 24],
      [24, H - 24],
      [W - 24, H - 24],
    ];
    for (const [x, y] of pos) {
      ctx.fillStyle = C.screw;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = C.screwSlot;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x - 2.5, y);
      ctx.lineTo(x + 2.5, y);
      ctx.stroke();
    }
  }

  private drawLabel(
    ctx: CanvasRenderingContext2D,
    state: CassetteDrawState
  ) {
    // 标签纸（暗铜色）
    const g = ctx.createLinearGradient(0, 30, 0, 100);
    g.addColorStop(0, "#4a3422");
    g.addColorStop(1, C.label);
    ctx.fillStyle = g;
    this.roundRect(ctx, 30, 30, W - 60, 70, 4);
    ctx.fill();
    ctx.strokeStyle = C.labelEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
    // 左侧橙色色带
    ctx.fillStyle = C.accent;
    ctx.fillRect(30, 30, 6, 70);
    ctx.fillStyle = "rgba(217,119,6,0.4)";
    ctx.fillRect(36, 30, 3, 70);

    // 歌名
    ctx.fillStyle = C.text;
    ctx.font = "700 16px ui-monospace, 'Courier New', monospace";
    ctx.textBaseline = "alphabetic";
    const name = state.hasTape
      ? truncText(ctx, state.name, 270)
      : "—— NO TAPE ——";
    ctx.fillText(name, 50, 54);

    // 艺术家
    ctx.fillStyle = C.textDim;
    ctx.font = "11px ui-monospace, 'Courier New', monospace";
    const artist = state.hasTape
      ? truncText(ctx, state.artist.toUpperCase(), 270)
      : "INSERT A CASSETTE TO PLAY";
    ctx.fillText(artist, 50, 72);

    // 专辑
    if (state.hasTape && state.album) {
      ctx.fillStyle = "#7a6a4a";
      ctx.font = "9px ui-monospace, 'Courier New', monospace";
      ctx.fillText(truncText(ctx, state.album, 270), 50, 86);
    }

    // 右侧 SIDE A
    ctx.fillStyle = C.textAccent;
    ctx.font = "700 11px ui-monospace, 'Courier New', monospace";
    ctx.textAlign = "right";
    ctx.fillText("SIDE A", W - 50, 50);
    ctx.fillStyle = C.textDim;
    ctx.font = "8px ui-monospace, 'Courier New', monospace";
    ctx.fillText("90 MIN · CHROME", W - 50, 62);
    ctx.textAlign = "left";
  }

  private drawWindow(ctx: CanvasRenderingContext2D) {
    const g = ctx.createRadialGradient(W / 2, 165, 40, W / 2, 165, 170);
    g.addColorStop(0, "#1a1a1e");
    g.addColorStop(1, C.window);
    ctx.fillStyle = g;
    this.roundRect(ctx, 55, 115, W - 110, 120, 60);
    ctx.fill();
    ctx.strokeStyle = C.windowEdge;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private drawEmptyReels(ctx: CanvasRenderingContext2D) {
    for (const reel of [REEL_L, REEL_R]) {
      ctx.strokeStyle = "#3a2a1f";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(reel.x, reel.y, reel.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.hubDark;
      ctx.beginPath();
      ctx.arc(reel.x, reel.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.hub;
      ctx.beginPath();
      ctx.arc(reel.x, reel.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawTapeBand(
    ctx: CanvasRenderingContext2D,
    lt: number,
    rt: number
  ) {
    const lx = REEL_L.x + lt * 0.45;
    const ly = REEL_L.y + lt * 0.89;
    const rx = REEL_R.x - rt * 0.45;
    const ry = REEL_R.y + rt * 0.89;
    const hl = 190;
    const hr = 250;
    const hy = 243;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.quadraticCurveTo(lx + 15, hy + 6, hl, hy);
    ctx.lineTo(hr, hy);
    ctx.quadraticCurveTo(rx - 15, hy + 6, rx, ry);
    ctx.strokeStyle = C.tape;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.strokeStyle = C.tapeRing;
    ctx.lineWidth = 0.6;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawReel(
    ctx: CanvasRenderingContext2D,
    reel: { x: number; y: number; r: number },
    angle: number,
    tapeR: number
  ) {
    ctx.save();
    ctx.translate(reel.x, reel.y);
    ctx.rotate((angle * Math.PI) / 180);

    // 主圆盘
    ctx.fillStyle = C.reelBase;
    ctx.beginPath();
    ctx.arc(0, 0, reel.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.reelTeeth;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 6 个齿轮齿
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.rotate((i * 60 * Math.PI) / 180);
      ctx.fillStyle = C.reelTeeth;
      ctx.fillRect(-3.5, -reel.r - 5, 7, 9);
      ctx.restore();
    }

    // 内圈装饰环
    ctx.strokeStyle = C.reelTeeth;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(0, 0, TAPE_MAX_R + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 磁带缠绕
    ctx.fillStyle = C.tape;
    ctx.beginPath();
    ctx.arc(0, 0, tapeR, 0, Math.PI * 2);
    ctx.fill();

    // 同心圆纹理
    if (tapeR > TAPE_MIN_R + 2) {
      ctx.strokeStyle = C.tapeRing;
      ctx.lineWidth = 0.4;
      ctx.globalAlpha = 0.5;
      for (const p of [0.35, 0.55, 0.72, 0.86]) {
        ctx.beginPath();
        ctx.arc(0, 0, TAPE_MIN_R + (tapeR - TAPE_MIN_R) * p, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // 径向高光
    if (tapeR > TAPE_MIN_R + 4) {
      ctx.strokeStyle = C.tapeRing;
      ctx.lineWidth = 0.3;
      ctx.globalAlpha = 0.25;
      for (let i = 0; i < 12; i++) {
        const a = (i * 30 * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * TAPE_MIN_R, Math.sin(a) * TAPE_MIN_R);
        ctx.lineTo(Math.cos(a) * (tapeR - 1), Math.sin(a) * (tapeR - 1));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // 中心轴孔
    ctx.fillStyle = "#0d0d0f";
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.hub;
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    // 六角花键
    ctx.strokeStyle = "#0d0d0f";
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const a = (i * 60 * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 2, Math.sin(a) * 2);
      ctx.lineTo(Math.cos(a) * 6.5, Math.sin(a) * 6.5);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawHeadWindow(
    ctx: CanvasRenderingContext2D,
    state: CassetteDrawState
  ) {
    ctx.fillStyle = C.window;
    this.roundRect(ctx, 175, 225, 90, 20, 3);
    ctx.fill();
    ctx.strokeStyle = C.windowEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
    // 磁头
    ctx.fillStyle = "#5a4030";
    ctx.fillRect(185, 232, 70, 6);
    // 读头指示
    ctx.fillStyle = state.playing ? C.accentBright : "#5a4030";
    ctx.globalAlpha = state.playing ? 0.9 : 0.4;
    ctx.fillRect(205, 234, 30, 2);
    ctx.globalAlpha = 1;
  }

  private drawStatusLED(
    ctx: CanvasRenderingContext2D,
    state: CassetteDrawState
  ) {
    const x = 42;
    const y = 248;
    // 状态灯
    if (state.playing || state.winding) {
      // 发光
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 10);
      glow.addColorStop(0, state.winding ? "#fbbf24" : C.ledOn);
      glow.addColorStop(1, "rgba(245,158,11,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - 10, y - 10, 20, 20);
      ctx.fillStyle = state.winding ? "#fbbf24" : C.ledOn;
    } else {
      ctx.fillStyle = C.ledOff;
    }
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();

    // 状态文字
    ctx.fillStyle = C.textDim;
    ctx.font = "8px ui-monospace, 'Courier New', monospace";
    const st = state.winding === "forward"
      ? "FF"
      : state.winding === "rewind"
        ? "REW"
        : state.playing
          ? "PLAY"
          : "STOP";
    ctx.fillText(st, 50, 251);
  }

  private drawBrandText(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = C.textDim;
    ctx.font = "9px ui-monospace, 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillText("R E T R O   ·   C A S S E T T E   ·   D E C K", W / 2, 280);
    ctx.textAlign = "left";
  }

  // ===== 拖拽手势 =====
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
