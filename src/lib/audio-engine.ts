"use client";

/**
 * 磁带音频引擎（Web Audio API 实现）
 *
 * 核心思想：用 AudioBufferSourceNode 模拟"磁针读取磁带"
 * - 音频预先 decode 成 AudioBuffer
 * - source 持续播放，通过 playbackRate（AudioParam）连续控制速度与音高
 * - playbackRate 每帧平滑过渡 → 音调连续滑动（非阶跃）
 * - 播放位置 playhead 完全由引擎掌控，可正向推进、可倒退
 * - 倒带：stop source + 手动倒退 playhead + 卷带音效（真实磁带行为）
 *
 * CORS 降级：跨域音频无法 fetch/decode 时，回退到 HTML audio 元素
 * （此时变调为阶跃，但至少能播放）
 */

export interface AudioEngineCallbacks {
  onEnded?: () => void;
  onLoaded?: (duration: number) => void;
  onError?: (msg: string) => void;
}

const MIN_RATE = 0.0625; // 浏览器/Web Audio 最小 playbackRate
const MAX_RATE = 6;

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export class TapeAudioEngine {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;

  // 降级模式（HTML audio）
  private fallbackEl: HTMLAudioElement | null = null;
  private useFallback = false;

  private playhead = 0; // 当前播放位置（秒）
  private playing = false;
  private targetRate = 1;
  private smoothedRate = 1;
  private volume = 0.85;
  private cb: AudioEngineCallbacks;

  constructor(cb: AudioEngineCallbacks = {}) {
    this.cb = cb;
  }

  private ensureCtx() {
    if (this.ctx) return;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new AC();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.ctx.destination);
  }

  resume() {
    this.ctx?.resume();
    if (this.useFallback && this.fallbackEl) {
      this.fallbackEl.play().catch(() => {});
    }
  }

  get currentTime() {
    if (this.useFallback) return this.fallbackEl?.currentTime ?? 0;
    return this.playhead;
  }

  get duration() {
    if (this.useFallback) return this.fallbackEl?.duration ?? 0;
    return this.buffer?.duration ?? 0;
  }

  get isPlaying() {
    if (this.useFallback) return !this.fallbackEl?.paused;
    return this.playing;
  }

  get currentRate() {
    return this.useFallback ? this.targetRate : this.smoothedRate;
  }

  get isFallback() {
    return this.useFallback;
  }

  /**
   * 加载音频
   * 先尝试 fetch + decodeAudioData（Web Audio，支持连续变调）
   * 失败（CORS）则降级到 HTML audio
   */
  async load(url: string): Promise<void> {
    this.ensureCtx();
    this.stopSource();
    if (this.fallbackEl) {
      this.fallbackEl.pause();
      this.fallbackEl = null;
    }
    this.useFallback = false;
    this.buffer = null;
    this.playhead = 0;
    this.smoothedRate = 1;
    this.targetRate = 1;

    // blob URL（本地上传）或同源 URL 可以 fetch
    const isBlob = url.startsWith("blob:");
    const isSameOrigin =
      typeof window !== "undefined" &&
      (url.startsWith(window.location.origin) ||
        url.startsWith("/") ||
        url.startsWith("./"));

    if (isBlob || isSameOrigin) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arr = await res.arrayBuffer();
        this.buffer = await this.ctx!.decodeAudioData(arr);
        this.playhead = 0;
        this.cb.onLoaded?.(this.buffer.duration);
        return;
      } catch {
        // 继续降级
      }
    } else {
      // 跨域：尝试 fetch（部分服务器支持 CORS）
      try {
        const res = await fetch(url, { mode: "cors" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arr = await res.arrayBuffer();
        this.buffer = await this.ctx!.decodeAudioData(arr);
        this.playhead = 0;
        this.cb.onLoaded?.(this.buffer.duration);
        return;
      } catch {
        // 降级
      }
    }

    // 降级到 HTML audio
    this.useFallback = true;
    this.fallbackEl = new Audio();
    this.fallbackEl.src = url;
    this.fallbackEl.preload = "metadata";
    this.fallbackEl.volume = this.volume;
    (
      this.fallbackEl as HTMLAudioElement & {
        preservesPitch?: boolean;
        mozPreservesPitch?: boolean;
        webkitPreservesPitch?: boolean;
      }
    ).preservesPitch = false;
    (
      this.fallbackEl as HTMLAudioElement & { mozPreservesPitch?: boolean }
    ).mozPreservesPitch = false;
    (
      this.fallbackEl as HTMLAudioElement & {
        webkitPreservesPitch?: boolean;
      }
    ).webkitPreservesPitch = false;
    this.fallbackEl.onloadedmetadata = () => {
      this.cb.onLoaded?.(this.fallbackEl?.duration ?? 0);
    };
    this.fallbackEl.onended = () => this.cb.onEnded?.();
    this.fallbackEl.onerror = () => this.cb.onError?.("音频加载失败");
  }

  play(offset?: number) {
    this.ensureCtx();
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    if (this.useFallback) {
      if (offset != null && this.fallbackEl)
        this.fallbackEl.currentTime = offset;
      this.fallbackEl?.play().catch(() => {});
      return;
    }
    if (offset != null) this.playhead = offset;
    this.startSource();
  }

  private startSource() {
    if (!this.buffer || !this.ctx || !this.gain) return;
    this.stopSource();
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.gain);
    this.source.playbackRate.value = this.smoothedRate;
    this.source.onended = () => {
      if (this.playing) {
        this.playing = false;
        this.playhead = 0;
        this.smoothedRate = 1;
        this.targetRate = 1;
        this.cb.onEnded?.();
      }
    };
    const offset = clamp(this.playhead, 0, this.buffer.duration - 0.02);
    try {
      this.source.start(0, offset);
      this.playing = true;
    } catch {
      this.cb.onError?.("播放启动失败");
    }
  }

  private stopSource() {
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {
        /* ignore */
      }
      try {
        this.source.disconnect();
      } catch {
        /* ignore */
      }
      this.source = null;
    }
    this.playing = false;
  }

  pause() {
    if (this.useFallback) {
      this.fallbackEl?.pause();
      return;
    }
    this.stopSource();
  }

  stop() {
    this.pause();
    this.setPlayhead(0);
  }

  /** 直接设置播放位置（不重启 source，用于倒带每帧调用） */
  setPlayhead(time: number) {
    const dur = this.duration;
    this.playhead = clamp(time, 0, dur > 0 ? dur : 0);
    if (this.useFallback && this.fallbackEl) {
      try {
        this.fallbackEl.currentTime = this.playhead;
      } catch {
        /* ignore */
      }
    }
  }

  /** seek：重启 source 到目标位置（拖动进度条用） */
  seek(time: number) {
    if (this.useFallback) {
      this.setPlayhead(time);
      return;
    }
    const wasPlaying = this.playing;
    this.stopSource();
    this.setPlayhead(time);
    if (wasPlaying) this.startSource();
  }

  /** 设置目标倍速（平滑过渡由 tick 处理） */
  setRate(rate: number) {
    this.targetRate = clamp(rate, MIN_RATE, MAX_RATE);
    if (this.useFallback && this.fallbackEl) {
      try {
        this.fallbackEl.playbackRate = this.targetRate;
      } catch {
        /* ignore */
      }
    }
  }

  setVolume(v: number) {
    this.volume = clamp(v, 0, 1);
    if (this.useFallback && this.fallbackEl) {
      this.fallbackEl.volume = this.volume;
      return;
    }
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(
        this.volume,
        this.ctx.currentTime,
        0.02
      );
    }
  }

  /**
   * 每帧调用（rAF）
   * - 平滑 playbackRate（连续变调的关键）
   * - 推进 playhead
   */
  tick(dt: number) {
    // 平滑 rate（指数移动平均），让音调连续滑动
    const smoothFactor = Math.min(1, dt * 18); // ~55ms 时间常数
    this.smoothedRate +=
      (this.targetRate - this.smoothedRate) * smoothFactor;

    if (this.useFallback) return;

    if (this.playing && this.source) {
      this.source.playbackRate.value = this.smoothedRate;
      this.playhead += dt * this.smoothedRate;
      const dur = this.buffer?.duration ?? 0;
      if (this.playhead >= dur) {
        this.playhead = 0;
        this.stopSource();
        this.smoothedRate = 1;
        this.targetRate = 1;
        this.cb.onEnded?.();
      }
    }
  }
  dispose() {
    this.stopSource();
    this.fallbackEl?.pause();
    this.fallbackEl = null;
    this.ctx?.close();
    this.ctx = null;
  }
}
