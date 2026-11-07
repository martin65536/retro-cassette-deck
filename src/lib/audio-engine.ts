"use client";

import { getWorkletUrl, revokeWorkletUrl } from "./tape-worklet-code";

/**
 * 磁带音频引擎（AudioWorkletNode 采样模式）
 *
 * 核心区别：
 * - AudioBufferSourceNode（旧）：播放模式，playbackRate 受浏览器限制（~16x）
 * - AudioWorkletNode（新）：采样模式，逐样本手动读取，rate 无上限（100x/1000x 都行）
 *
 * "磁针读取磁带频率"——rate 即磁带移动速度，音高随 rate 连续变化（线性插值平滑）
 * 反向播放：playhead 递减，真实倒放音频
 */

export interface AudioEngineCallbacks {
  onEnded?: () => void;
  onLoaded?: (duration: number) => void;
  onError?: (msg: string) => void;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export class TapeAudioEngine {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;

  private playhead = 0;
  private playing = false;
  private reverse = false;
  private volume = 0.85;
  private cb: AudioEngineCallbacks;
  private cachedDuration = 0;
  private workletReady = false;

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

  /** 加载并注册 AudioWorklet */
  private async ensureWorklet() {
    if (this.workletReady) return;
    this.ensureCtx();
    try {
      await this.ctx!.audioWorklet.addModule(getWorkletUrl());
      this.workletReady = true;
    } catch (e) {
      throw new Error(
        `AudioWorklet 加载失败：${e instanceof Error ? e.message : e}`
      );
    }
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

  private smoothedRate = 1;

  get isReverse() {
    return this.reverse;
  }

  /**
   * 加载音频：fetch + decodeAudioData，然后传给 worklet
   */
  async load(url: string): Promise<void> {
    this.ensureCtx();
    await this.ensureWorklet();
    this.stopNode();
    this.buffer = null;
    this.playhead = 0;
    this.reverse = false;
    this.smoothedRate = 1;
    this.cachedDuration = 0;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error) detail = data.error;
        } catch {
          /* 非 JSON */
        }
        throw new Error(detail);
      }
      // 检查是否为音频（上游可能返回 HTML 404 页面）
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("text/html")) {
        throw new Error("该歌曲因版权保护无法获取音频，请尝试本地上传或示例曲目");
      }
      const arr = await res.arrayBuffer();
      this.buffer = await this.ctx!.decodeAudioData(arr);
      this.cachedDuration = this.buffer.duration;

      // 创建 worklet node 并传 buffer 数据
      this.workletNode = new AudioWorkletNode(this.ctx!, "tape-processor", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.workletNode.connect(this.gain!);

      // 传 AudioBuffer 的各声道数据到 worklet
      const numCh = this.buffer.numberOfChannels;
      const channels: Float32Array[] = [];
      for (let c = 0; c < numCh; c++) {
        channels.push(this.buffer.getChannelData(c));
      }
      this.workletNode.port.postMessage({
        type: "buffer",
        channels,
        length: this.buffer.length,
        sampleRate: this.buffer.sampleRate,
      });

      // 监听 worklet 消息
      this.workletNode.port.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === "ended") {
          this.playing = false;
          this.playhead = 0;
          this.smoothedRate = 1;
          this.cb.onEnded?.();
        } else if (msg.type === "playhead") {
          this.playhead = msg.time;
        }
      };

      // 同步初始状态
      this.workletNode.port.postMessage({
        type: "setVolume",
        volume: this.volume,
      });

      this.cb.onLoaded?.(this.buffer.duration);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.cb.onError?.(`音频加载失败：${msg}`);
      throw e;
    }
  }

  play(offset?: number) {
    this.ensureCtx();
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    if (offset != null) this.playhead = offset;
    if (!this.workletNode) return;
    this.workletNode.port.postMessage({
      type: "play",
      offset: offset != null ? offset * (this.buffer?.sampleRate || 44100) : undefined,
    });
    this.playing = true;
  }

  private stopNode() {
    if (this.workletNode) {
      try {
        this.workletNode.port.postMessage({ type: "pause" });
      } catch {
        /* ignore */
      }
    }
    this.playing = false;
  }

  pause() {
    if (!this.workletNode) return;
    this.workletNode.port.postMessage({ type: "pause" });
    this.playing = false;
  }

  stop() {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "stop" });
    }
    this.playing = false;
    this.playhead = 0;
  }

  /** 切换正放/倒放 */
  setReverse(reverse: boolean) {
    this.reverse = reverse;
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "setReverse", reverse });
    }
  }

  /** 设置目标倍速（任意正数，无上限） */
  setRate(rate: number) {
    this.smoothedRate = rate; // 主线程也同步（用于 UI）
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "setRate", rate });
    }
  }

  /** 设置有效采样率（0=自动，>0=手动 Hz） */
  setEffectiveSampleRate(value: number) {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "setEffectiveSampleRate", value });
    }
  }

  /** 平滑 rate（由 rAF 调用） */
  tick(dt: number) {
    // worklet 内部自己平滑，这里只更新 playhead 估算
    if (this.playing && this.buffer) {
      const rate = this.smoothedRate;
      if (this.reverse) {
        this.playhead -= dt * rate;
        if (this.playhead <= 0) {
          this.playhead = 0;
          this.playing = false;
          this.cb.onEnded?.();
        }
      } else {
        this.playhead += dt * rate;
        if (this.playhead >= this.cachedDuration) {
          this.playhead = 0;
          this.playing = false;
          this.cb.onEnded?.();
        }
      }
    }
  }

  /** seek */
  seek(time: number) {
    this.playhead = clamp(time, 0, this.cachedDuration > 0 ? this.cachedDuration : 0);
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "seek", time });
    }
  }

  setPlayhead(time: number) {
    this.playhead = clamp(time, 0, this.cachedDuration > 0 ? this.cachedDuration : 0);
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "seek", time });
    }
  }

  setVolume(v: number) {
    this.volume = clamp(v, 0, 1);
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "setVolume", volume: this.volume });
    }
  }

  dispose() {
    this.stopNode();
    try {
      this.workletNode?.disconnect();
    } catch {
      /* ignore */
    }
    this.workletNode = null;
    this.ctx?.close();
    this.ctx = null;
    this.workletReady = false;
    revokeWorkletUrl();
  }
}
