"use client";

/**
 * AudioWorklet 采样模式处理器代码（通过 Blob URL 加载）
 *
 * 采样模式：逐样本手动读取 buffer，rate 无上限
 * - 线性插值平滑变调
 * - 反向播放：playhead 递减
 * - 高倍速低通滤波：rate>1 时自动降低截止频率，模拟磁带快进高频衰减
 *   （避免数字采样产生的镜像频率/混叠刺耳声）
 *
 * 真实磁带快进不刺耳的原因：模拟信号高频自然衰减 + 磁头接触不紧密
 * 数字采样需要主动加低通模拟这个效果
 */
const WORKLET_CODE = `
class TapeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channelData = [];
    this.length = 0;
    this.sampleRate = 0;
    this.playhead = 0;
    this.playing = false;
    this.targetRate = 1;
    this.smoothedRate = 1;
    this.reverse = false;
    this.volume = 0.85;

    // 一阶低通滤波器状态（每声道）
    this.filterState = [0, 0];
    // 上一个样本（用于更高阶插值）
    this.prevSample = [0, 0];

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'buffer') {
        this.channelData = msg.channels;
        this.length = msg.length;
        this.sampleRate = msg.sampleRate;
        this.playhead = 0;
        this.filterState = new Array(this.channelData.length).fill(0);
        this.prevSample = new Array(this.channelData.length).fill(0);
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
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const numCh = output.length;
    const blockSize = output[0].length;

    // 平滑 rate
    const smoothFactor = 0.15;
    this.smoothedRate += (this.targetRate - this.smoothedRate) * smoothFactor;

    if (!this.playing || this.channelData.length === 0) {
      for (let c = 0; c < numCh; c++) output[c].fill(0);
      return true;
    }

    const dataCh = Math.min(numCh, this.channelData.length);
    const rate = this.smoothedRate;
    const vol = this.volume;
    const sr = this.sampleRate || 44100;

    // 低通滤波器系数：rate 越高，截止频率越低（模拟磁带快进高频衰减）
    // 正常播放(rate=1)时几乎不滤波；rate=10 时截止约 4kHz；rate=20 时约 2kHz
    // 使用一阶低通：y[n] = y[n-1] + a*(x[n] - y[n-1])
    // 截止频率 fc，a = 2*PI*fc/sr（简化）
    let cutoffFreq;
    if (rate <= 1.5) {
      // 低倍速：不滤波（保持原音质）
      cutoffFreq = sr * 0.45;
    } else {
      // 高倍速：截止频率随 rate 反比下降
      // 真实磁带快进时，高频约保留到 (sr/2) / rate
      cutoffFreq = Math.max(800, (sr * 0.45) / Math.sqrt(rate));
    }
    const a = Math.min(1, (2 * Math.PI * cutoffFreq) / sr);

    for (let i = 0; i < blockSize; i++) {
      // 边界检查
      if (this.playhead < 0 || this.playhead >= this.length - 2) {
        this.playhead = this.reverse ? 0 : 0;
        this.playing = false;
        this.port.postMessage({ type: 'ended' });
        for (let c = 0; c < numCh; c++) output[c].fill(0, i);
        return true;
      }

      const idx = Math.floor(this.playhead);
      const frac = this.playhead - idx;

      for (let c = 0; c < dataCh; c++) {
        const data = this.channelData[c];
        // 线性插值读取
        const s1 = data[idx] || 0;
        const s2 = data[idx + 1] || 0;
        let sample = s1 + (s2 - s1) * frac;

        // 一阶低通滤波（高倍速时抑制刺耳高频）
        const prev = this.filterState[c];
        const filtered = prev + a * (sample - prev);
        this.filterState[c] = filtered;

        output[c][i] = filtered * vol;
      }
      for (let c = dataCh; c < numCh; c++) {
        output[c][i] = 0;
      }

      // 推进播放指针
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

export function getWorkletUrl(): string {
  if (workletUrlCache) return workletUrlCache;
  const blob = new Blob([WORKLET_CODE], { type: "application/javascript" });
  workletUrlCache = URL.createObjectURL(blob);
  return workletUrlCache;
}

export function revokeWorkletUrl() {
  if (workletUrlCache) {
    URL.revokeObjectURL(workletUrlCache);
    workletUrlCache = null;
  }
}
