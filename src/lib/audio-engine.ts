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
 * 所有音频（含网易云，经后端代理同源）均 fetch + decode 成 AudioBuffer
 */

export interface AudioEngineCallbacks {
  onEnded?: () => void;
  onLoaded?: (duration: number) => void;
  onError?: (msg: string) => void;
}

const MIN_RATE = 0.0625;
const MAX_RATE = 6;

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export class TapeAudioEngine {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;

  private playhead = 0;
  private playing = false;
  private targetRate = 1;
  private smoothedRate = 1;
  private volume = 0.85;
  private cb: AudioEngineCallbacks;

  // 性能：缓存 duration
  private cachedDuration = 0;

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
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  get currentTime() {
    return this.playhead;
  }

  get duration() {
    return this.cachedDuration;
  }

  get isPlaying() {
    return this.playing;
  }

  get currentRate() {
    return this.smoothedRate;
  }

  get isFallback() {
    return false;
  }

  /**
   * 加载音频：fetch + decodeAudioData（所有 URL 均同源或经代理）
   */
  async load(url: string): Promise<void> {
    this.ensureCtx();
    this.stopSource();
    this.buffer = null;
    this.playhead = 0;
    this.smoothedRate = 1;
    this.targetRate = 1;
    this.cachedDuration = 0;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const arr = await res.arrayBuffer();
      // decodeAudioData 可能返回 Promise 或用回调（旧 Safari），这里用 Promise 形式
      this.buffer = await this.ctx!.decodeAudioData(arr);
      this.cachedDuration = this.buffer.duration;
      this.cb.onLoaded?.(this.buffer.duration);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.cb.onError?.(`音频解码失败：${msg}`);
      throw e;
    }
  }

  play(offset?: number) {
    this.ensureCtx();
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
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
      // 自然播完（非主动 stop）
      if (this.playing) {
        this.playing = false;
        this.playhead = 0;
        this.smoothedRate = 1;
        this.targetRate = 1;
        this.cb.onEnded?.();
      }
    };
    const offset = clamp(this.playhead, 0, this.cachedDuration - 0.02);
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
    this.stopSource();
  }

  stop() {
    this.pause();
    this.setPlayhead(0);
  }

  /** 直接设置播放位置（不重启 source，倒带每帧调用） */
  setPlayhead(time: number) {
    this.playhead = clamp(time, 0, this.cachedDuration > 0 ? this.cachedDuration : 0);
  }

  /** seek：重启 source 到目标位置（拖动进度条用） */
  seek(time: number) {
    const wasPlaying = this.playing;
    this.stopSource();
    this.setPlayhead(time);
    if (wasPlaying) this.startSource();
  }

  /** 设置目标倍速（平滑过渡由 tick 处理） */
  setRate(rate: number) {
    this.targetRate = clamp(rate, MIN_RATE, MAX_RATE);
  }

  setVolume(v: number) {
    this.volume = clamp(v, 0, 1);
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
    const smoothFactor = Math.min(1, dt * 18);
    this.smoothedRate +=
      (this.targetRate - this.smoothedRate) * smoothFactor;

    if (this.playing && this.source) {
      this.source.playbackRate.value = this.smoothedRate;
      this.playhead += dt * this.smoothedRate;
      if (this.playhead >= this.cachedDuration) {
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
    this.ctx?.close();
    this.ctx = null;
  }
}
