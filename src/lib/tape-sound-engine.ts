"use client";

/**
 * 磁带音效合成引擎（纯类，无 React 依赖）
 * 使用 Web Audio API 实时合成磁带机械音效：
 * - 持续的磁带摩擦声 (hiss) —— 播放时低音量白噪声
 * - 快进/快退的快速卷带声 (wind) —— 带通滤波白噪声，频率随速度变化
 * - 机械按键声 (click) —— 短促的带通噪声脉冲
 * - 刹车停止声 (brake) —— 低频脉冲 + 噪声衰减
 * - 磁带装载/弹出声 (load/eject) —— 连续咔哒 + 滑动声
 *
 * 生命周期：组件 new 一个实例，卸载时调 dispose()。
 * sfxVolume=0 时自动休眠持续源（hiss/wind），>0 时唤醒。
 */
export class TapeSoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private hissSource: AudioBufferSourceNode | null = null;
  private hissGain: GainNode | null = null;
  private hissFilter: BiquadFilterNode | null = null;

  private windSource: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windLfo: OscillatorNode | null = null;
  private windLfoGain: GainNode | null = null;

  private started = false;
  private sourcesActive = false;
  private sfxVolume = 0.6;

  /** 必须在用户交互后调用，以解锁 AudioContext */
  init() {
    if (this.ctx) return;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new AC();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.sfxVolume;
    this.masterGain.connect(this.ctx.destination);
    this.noiseBuffer = this.createNoiseBuffer();
    this.started = true;
    if (this.sfxVolume > 0) this.startContinuousSources();
  }

  resume() {
    this.ctx?.resume();
  }

  private createNoiseBuffer(): AudioBuffer {
    const ctx = this.ctx!;
    const size = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private setupHiss() {
    const ctx = this.ctx!;
    this.hissSource = ctx.createBufferSource();
    this.hissSource.buffer = this.noiseBuffer;
    this.hissSource.loop = true;
    this.hissFilter = ctx.createBiquadFilter();
    this.hissFilter.type = "lowpass";
    this.hissFilter.frequency.value = 3200;
    this.hissFilter.Q.value = 0.4;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    this.hissSource.connect(this.hissFilter);
    this.hissFilter.connect(this.hissGain);
    this.hissGain.connect(this.masterGain!);
    this.hissSource.start();
  }

  private setupWind() {
    const ctx = this.ctx!;
    this.windSource = ctx.createBufferSource();
    this.windSource.buffer = this.noiseBuffer;
    this.windSource.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 2200;
    this.windFilter.Q.value = 1.2;
    this.windLfo = ctx.createOscillator();
    this.windLfo.type = "sine";
    this.windLfo.frequency.value = 8;
    this.windLfoGain = ctx.createGain();
    this.windLfoGain.gain.value = 600;
    this.windLfo.connect(this.windLfoGain);
    this.windLfoGain.connect(this.windFilter.frequency);
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSource.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain!);
    this.windSource.start();
    this.windLfo.start();
  }

  private startContinuousSources() {
    if (!this.ctx || this.sourcesActive) return;
    this.setupHiss();
    this.setupWind();
    this.sourcesActive = true;
  }

  private stopContinuousSources() {
    if (!this.sourcesActive) return;
    try { this.hissSource?.stop(); } catch { /* ignore */ }
    try { this.windSource?.stop(); } catch { /* ignore */ }
    try { this.windLfo?.stop(); } catch { /* ignore */ }
    try { this.hissSource?.disconnect(); } catch { /* ignore */ }
    try { this.windSource?.disconnect(); } catch { /* ignore */ }
    try { this.windLfo?.disconnect(); } catch { /* ignore */ }
    this.hissSource = null;
    this.hissGain = null;
    this.hissFilter = null;
    this.windSource = null;
    this.windGain = null;
    this.windFilter = null;
    this.windLfo = null;
    this.windLfoGain = null;
    this.sourcesActive = false;
  }

  setHiss(active: boolean, volume = 0.05) {
    if (!this.sourcesActive || !this.ctx || !this.hissGain) return;
    const now = this.ctx.currentTime;
    this.hissGain.gain.cancelScheduledValues(now);
    this.hissGain.gain.setTargetAtTime(active ? volume : 0, now, 0.08);
  }

  setWind(speed: number, forward: boolean) {
    if (!this.sourcesActive || !this.ctx || !this.windGain || !this.windFilter || !this.windLfo)
      return;
    const now = this.ctx.currentTime;
    const s = Math.max(0, Math.min(1, speed));
    this.windGain.gain.cancelScheduledValues(now);
    this.windGain.gain.setTargetAtTime(s * 0.16, now, 0.06);
    this.windFilter.frequency.setTargetAtTime(1400 + s * 3600, now, 0.08);
    this.windLfo.frequency.setTargetAtTime(forward ? 7 + s * 6 : 5 + s * 4, now, 0.1);
  }

  click(intensity = 1) {
    if (!this.ctx || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = false;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1100;
    filter.Q.value = 1.5;
    const gain = this.ctx.createGain();
    const peak = 0.28 * intensity;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.09);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);
    src.start(now, 0, 0.12);
    src.stop(now + 0.14);
  }

  brake() {
    if (!this.ctx || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.18);
    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.0001, now);
    oscGain.gain.linearRampToValueAtTime(0.18, now + 0.01);
    oscGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.22);
    osc.connect(oscGain);
    oscGain.connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.25);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1500;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.2);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);
    src.start(now, 0, 0.22);
    src.stop(now + 0.24);
  }

  load() {
    if (!this.ctx || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const clicks = [0, 0.06, 0.13, 0.22, 0.3];
    clicks.forEach((t, i) => {
      const src = this.ctx!.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = this.ctx!.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 900 + i * 200;
      filter.Q.value = 2;
      const gain = this.ctx!.createGain();
      gain.gain.setValueAtTime(0, now + t);
      gain.gain.linearRampToValueAtTime(0.22, now + t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.06);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain!);
      src.start(now + t, 0, 0.08);
      src.stop(now + t + 0.1);
    });
    const slide = this.ctx.createBufferSource();
    slide.buffer = this.noiseBuffer;
    const slideFilter = this.ctx.createBiquadFilter();
    slideFilter.type = "lowpass";
    slideFilter.frequency.setValueAtTime(800, now + 0.3);
    slideFilter.frequency.linearRampToValueAtTime(2400, now + 0.55);
    const slideGain = this.ctx.createGain();
    slideGain.gain.setValueAtTime(0, now + 0.3);
    slideGain.gain.linearRampToValueAtTime(0.1, now + 0.38);
    slideGain.gain.exponentialRampToValueAtTime(0.001, now + 0.62);
    slide.connect(slideFilter);
    slideFilter.connect(slideGain);
    slideGain.connect(this.masterGain!);
    slide.start(now + 0.3, 0, 0.35);
    slide.stop(now + 0.66);
  }

  eject() {
    if (!this.ctx || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const slide = this.ctx.createBufferSource();
    slide.buffer = this.noiseBuffer;
    const slideFilter = this.ctx.createBiquadFilter();
    slideFilter.type = "lowpass";
    slideFilter.frequency.setValueAtTime(2400, now);
    slideFilter.frequency.linearRampToValueAtTime(700, now + 0.25);
    const slideGain = this.ctx.createGain();
    slideGain.gain.setValueAtTime(0.12, now);
    slideGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    slide.connect(slideFilter);
    slideFilter.connect(slideGain);
    slideGain.connect(this.masterGain!);
    slide.start(now, 0, 0.3);
    slide.stop(now + 0.32);
    const click = this.ctx.createBufferSource();
    click.buffer = this.noiseBuffer;
    const clickFilter = this.ctx.createBiquadFilter();
    clickFilter.type = "bandpass";
    clickFilter.frequency.value = 1400;
    clickFilter.Q.value = 2;
    const clickGain = this.ctx.createGain();
    clickGain.gain.setValueAtTime(0, now + 0.26);
    clickGain.gain.linearRampToValueAtTime(0.3, now + 0.265);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(this.masterGain!);
    click.start(now + 0.26, 0, 0.1);
    click.stop(now + 0.36);
  }

  /** 设置磁带机械音效总音量 (0~1)；0 时休眠持续源，>0 时唤醒 */
  setSfxVolume(v: number) {
    this.sfxVolume = Math.max(0, Math.min(1, v));
    if (!this.ctx || !this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(this.sfxVolume, this.ctx.currentTime, 0.03);
    if (this.sfxVolume <= 0.001 && this.sourcesActive) {
      this.stopContinuousSources();
    } else if (this.sfxVolume > 0.001 && !this.sourcesActive && this.started) {
      this.startContinuousSources();
    }
  }

  dispose() {
    try {
      this.hissSource?.stop();
      this.windSource?.stop();
      this.windLfo?.stop();
    } catch {
      /* ignore */
    }
    this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}
