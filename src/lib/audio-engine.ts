"use client";

/**
 * 磁带音频引擎（Web Audio API 实现）
 *
 * 核心思想：用 AudioBufferSourceNode 模拟"磁针读取磁带"
 * - 音频预先 decode 成 AudioBuffer，并预生成反转副本
 * - 正放：用原 buffer，playhead 从 offset 正向推进
 * - 倒放：用反转 buffer，offset = duration - playhead，正向播放 = 反向听
 *   （AudioBufferSourceNode 不支持负 playbackRate，故用反转 buffer 模拟）
 * - playbackRate 每帧平滑过渡 → 音调连续滑动（非阶跃）
 * - 倒带时能听到真实的反向音频，像磁带倒带一样
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
  private reverseBuffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;

  private playhead = 0;
  private playing = false;
  private reverse = false; // 当前是否倒放模式
  private targetRate = 1;
  private smoothedRate = 1;
  private volume = 0.85;
  private cb: AudioEngineCallbacks;

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

  /** 生成反转 AudioBuffer（逐声道反转样本） */
  private createReverseBuffer(src: AudioBuffer): AudioBuffer {
    const ctx = this.ctx!;
    const channels = src.numberOfChannels;
    const len = src.length;
    const rev = ctx.createBuffer(channels, len, src.sampleRate);
    for (let c = 0; c < channels; c++) {
      const srcData = src.getChannelData(c);
      const dstData = rev.getChannelData(c);
      for (let i = 0; i < len; i++) {
        dstData[i] = srcData[len - 1 - i];
      }
    }
    return rev;
  }

  /**
   * 加载音频：fetch + decodeAudioData
   * 同步生成反转 buffer（用于倒放）
   */
  async load(url: string): Promise<void> {
    this.ensureCtx();
    this.stopSource();
    this.buffer = null;
    this.reverseBuffer = null;
    this.playhead = 0;
    this.reverse = false;
    this.smoothedRate = 1;
    this.targetRate = 1;
    this.cachedDuration = 0;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        // 尝试读取后端返回的 JSON 错误信息
        let detail = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error) detail = data.error;
        } catch {
          /* 非 JSON 响应 */
        }
        throw new Error(detail);
      }
      const arr = await res.arrayBuffer();
      this.buffer = await this.ctx!.decodeAudioData(arr);
      this.cachedDuration = this.buffer.duration;
      // 预生成反转 buffer（倒放用）
      this.reverseBuffer = this.createReverseBuffer(this.buffer);
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
    if (!this.buffer || !this.reverseBuffer || !this.ctx || !this.gain) return;
    this.stopSource();
    this.source = this.ctx.createBufferSource();
    // 倒放模式用反转 buffer
    this.source.buffer = this.reverse ? this.reverseBuffer : this.buffer;
    this.source.connect(this.gain);
    this.source.playbackRate.value = this.smoothedRate;
    this.source.onended = () => {
      if (this.playing) {
        // 倒放到头（反转 buffer 播完 = 正向 playhead 到 0）
        if (this.reverse) {
          this.playing = false;
          this.playhead = 0;
          this.smoothedRate = 1;
          this.targetRate = 1;
          this.cb.onEnded?.();
        } else {
          // 正放到尾
          this.playing = false;
          this.playhead = 0;
          this.smoothedRate = 1;
          this.targetRate = 1;
          this.cb.onEnded?.();
        }
      }
    };
    // 计算偏移：倒放时 offset = duration - playhead
    let offset: number;
    if (this.reverse) {
      offset = clamp(
        this.cachedDuration - this.playhead,
        0,
        this.cachedDuration - 0.02
      );
    } else {
      offset = clamp(this.playhead, 0, this.cachedDuration - 0.02);
    }
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

  /** 切换正放/倒放模式（倒带时调用） */
  setReverse(reverse: boolean) {
    if (this.reverse === reverse) return;
    this.reverse = reverse;
    // 切换需要重启 source（换 buffer）
    if (this.playing) {
      this.startSource();
    }
  }

  get isReverse() {
    return this.reverse;
  }

  /** 直接设置播放位置（倒带每帧用，倒放时 playhead 递减） */
  setPlayhead(time: number) {
    this.playhead = clamp(time, 0, this.cachedDuration > 0 ? this.cachedDuration : 0);
  }

  /** seek：重启 source 到目标位置 */
  seek(time: number) {
    const wasPlaying = this.playing;
    this.stopSource();
    this.setPlayhead(time);
    if (wasPlaying) this.startSource();
  }

  /** 设置目标倍速 */
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
   * - 平滑 playbackRate
   * - 推进 playhead（倒放时递减）
   */
  tick(dt: number) {
    const smoothFactor = Math.min(1, dt * 18);
    this.smoothedRate +=
      (this.targetRate - this.smoothedRate) * smoothFactor;

    if (this.playing && this.source) {
      this.source.playbackRate.value = this.smoothedRate;
      // 倒放模式：playhead 递减；正放：递增
      if (this.reverse) {
        this.playhead -= dt * this.smoothedRate;
        if (this.playhead <= 0) {
          this.playhead = 0;
          this.stopSource();
          this.smoothedRate = 1;
          this.targetRate = 1;
          this.cb.onEnded?.();
        }
      } else {
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
  }

  dispose() {
    this.stopSource();
    this.ctx?.close();
    this.ctx = null;
  }
}
