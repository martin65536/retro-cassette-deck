"use client";

/**
 * AudioWorklet 采样模式处理器（通过 Blob URL 加载）
 *
 * 采样模式：逐样本手动读取 buffer，rate 无上限
 * - 线性插值 + 二阶低通滤波（高倍速抑制刺耳混叠）
 * - effectiveSampleRate：有效采样率，控制低通强度
 *   - 0 = 自动（根据 rate 自动降低，模拟磁带快进高频衰减）
 *   - >0 = 手动设定（Hz，如 8000 = 闷声）
 * - 反向播放：playhead 递减
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
    // 有效采样率：0=自动，>0=手动（Hz）
    this.effectiveSampleRate = 0;

    // 二阶低通滤波器状态（每声道 2 个状态）
    this.filterState1 = [0, 0];
    this.filterState2 = [0, 0];

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'buffer') {
        this.channelData = msg.channels;
        this.length = msg.length;
        this.sampleRate = msg.sampleRate;
        this.playhead = 0;
        const n = this.channelData.length;
        this.filterState1 = new Array(n).fill(0);
        this.filterState2 = new Array(n).fill(0);
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
      } else if (msg.type === 'setEffectiveSampleRate') {
        this.effectiveSampleRate = Math.max(0, msg.value);
      }
    };
  }

  // 二阶低通滤波器（级联两个一阶，衰减斜率更陡）
  // 返回滤波后样本
  processSample(sample, ch, a) {
    // 第一级
    const s1 = this.filterState1[ch] + a * (sample - this.filterState1[ch]);
    this.filterState1[ch] = s1;
    // 第二级
    const s2 = this.filterState2[ch] + a * (s1 - this.filterState2[ch]);
    this.filterState2[ch] = s2;
    return s2;
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
    const sr = this.sampleRate || 44100;

    // 响度随速度指数衰减：vol * (1/rate)^0.5 = vol / sqrt(rate)
    // rate=1 时满音量，rate=10 时约 0.32，rate=20 时约 0.22
    const speedVolume = this.volume / Math.sqrt(Math.max(1, rate));

    // 计算低通滤波器系数
    // effectiveSampleRate=0 时自动：根据 rate 降低截止频率
    // effectiveSampleRate>0 时手动：截止频率 = effectiveSampleRate/2
    let cutoffFreq;
    if (this.effectiveSampleRate > 0) {
      // 手动模式：截止频率 = 有效采样率的一半
      cutoffFreq = this.effectiveSampleRate * 0.45;
    } else if (rate <= 1.5) {
      // 正常播放：不滤波
      cutoffFreq = sr * 0.45;
    } else {
      // 自动模式：截止频率随 rate 降低（二阶衰减更狠）
      // 真实磁带快进：高频保留约 (sr/2)/rate
      // 这里用更激进的衰减让高倍速更闷
      cutoffFreq = Math.max(500, (sr * 0.4) / rate);
    }
    // 一阶低通系数：a = 1 - exp(-2*PI*fc/sr)
    const a = 1 - Math.exp(-(2 * Math.PI * cutoffFreq) / sr);

    for (let i = 0; i < blockSize; i++) {
      if (this.playhead < 0 || this.playhead >= this.length - 2) {
        // 到达边界：停在边界处，不跳到另一头，停止播放
        if (this.playhead < 0) this.playhead = 0;
        else if (this.playhead >= this.length - 2) this.playhead = this.length - 2;
        this.playing = false;
        this.port.postMessage({ type: 'ended' });
        for (let c = 0; c < numCh; c++) output[c].fill(0, i);
        return true;
      }

      const idx = Math.floor(this.playhead);
      const frac = this.playhead - idx;

      for (let c = 0; c < dataCh; c++) {
        const data = this.channelData[c];
        const s1 = data[idx] || 0;
        const s2 = data[idx + 1] || 0;
        let sample = s1 + (s2 - s1) * frac;

        // 二阶低通滤波
        if (rate > 1.5 || this.effectiveSampleRate > 0) {
          sample = this.processSample(sample, c, a);
        }

        output[c][i] = sample * speedVolume;
      }
      for (let c = dataCh; c < numCh; c++) {
        output[c][i] = 0;
      }

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
