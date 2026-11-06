"use client";

/**
 * AudioWorklet 采样模式处理器代码（字符串形式，通过 Blob URL 加载）
 *
 * 这是"采样模式"而非"播放模式"：
 * - 逐样本从 AudioBuffer 读取（手动维护播放指针）
 * - rate 可以是任意正数（1x, 10x, 100x, 1000x），无浏览器限制
 * - 线性插值处理小数位置 → 平滑变调（连续，非阶跃）
 * - 反向播放：playhead 递减
 *
 * 真正的"磁针读取磁带频率"——rate 即磁带移动速度，音高随之连续变化
 */
const WORKLET_CODE = `
class TapeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 音频数据（从主线程通过 message 传入）
    this.channelData = [];   // Array<Float32Array>
    this.length = 0;          // 样本数
    this.sampleRate = 0;
    this.playhead = 0;        // 当前播放位置（样本索引，可为小数）
    this.playing = false;
    this.targetRate = 1;      // 目标倍速（任意正数）
    this.smoothedRate = 1;    // 平滑后的倍速
    this.reverse = false;     // 是否反向
    this.volume = 0.85;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'buffer') {
        // 传入 AudioBuffer 数据
        this.channelData = msg.channels;
        this.length = msg.length;
        this.sampleRate = msg.sampleRate;
        this.playhead = 0;
      } else if (msg.type === 'play') {
        this.playing = true;
        if (msg.offset != null) this.playhead = msg.offset;
      } else if (msg.type === 'pause') {
        this.playing = false;
      } else if (msg.type === 'stop') {
        this.playing = false;
        this.playhead = 0;
      } else if (msg.type === 'seek') {
        this.playhead = Math.max(0, Math.min(msg.time * this.sampleRate, this.length - 1));
      } else if (msg.type === 'setRate') {
        this.targetRate = Math.max(0.0001, msg.rate);
      } else if (msg.type === 'setReverse') {
        this.reverse = msg.reverse;
      } else if (msg.type === 'setVolume') {
        this.volume = Math.max(0, Math.min(1, msg.volume));
      } else if (msg.type === 'getPlayhead') {
        this.port.postMessage({
          type: 'playhead',
          time: this.length > 0 ? this.playhead / this.sampleRate : 0,
        });
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const numCh = output.length;
    const blockSize = output[0].length;

    // 平滑 rate（指数移动平均）
    const smoothFactor = 0.15;
    this.smoothedRate += (this.targetRate - this.smoothedRate) * smoothFactor;

    if (!this.playing || this.channelData.length === 0) {
      // 静音输出
      for (let c = 0; c < numCh; c++) {
        output[c].fill(0);
      }
      return true;
    }

    const dataCh = Math.min(numCh, this.channelData.length);
    const rate = this.smoothedRate;
    const vol = this.volume;

    for (let i = 0; i < blockSize; i++) {
      // 检查边界
      if (this.playhead < 0 || this.playhead >= this.length - 1) {
        if (this.reverse) {
          // 反向到头
          this.playhead = 0;
          this.playing = false;
          this.port.postMessage({ type: 'ended' });
          for (let c = 0; c < numCh; c++) output[c].fill(0, i);
          return true;
        } else {
          // 正向到尾
          this.playhead = 0;
          this.playing = false;
          this.port.postMessage({ type: 'ended' });
          for (let c = 0; c < numCh; c++) output[c].fill(0, i);
          return true;
        }
      }

      // 线性插值读取样本
      const idx = Math.floor(this.playhead);
      const frac = this.playhead - idx;
      for (let c = 0; c < dataCh; c++) {
        const data = this.channelData[c];
        const s1 = data[idx] || 0;
        const s2 = data[idx + 1] || 0;
        output[c][i] = (s1 + (s2 - s1) * frac) * vol;
      }
      // 多余声道静音
      for (let c = dataCh; c < numCh; c++) {
        output[c][i] = 0;
      }

      // 推进播放指针（rate 任意大小，无限倍速）
      if (this.reverse) {
        this.playhead -= rate;
      } else {
        this.playhead += rate;
      }
    }

    return true;
  }
}

registerProcessor('tape-processor', TapeProcessor);
`;

let workletUrlCache: string | null = null;

/** 获取 worklet Blob URL（缓存） */
export function getWorkletUrl(): string {
  if (workletUrlCache) return workletUrlCache;
  const blob = new Blob([WORKLET_CODE], { type: "application/javascript" });
  workletUrlCache = URL.createObjectURL(blob);
  return workletUrlCache;
}

/** 释放 worklet URL */
export function revokeWorkletUrl() {
  if (workletUrlCache) {
    URL.revokeObjectURL(workletUrlCache);
    workletUrlCache = null;
  }
}
