"use client";

import React from "react";
import {
  Volume2,
  VolumeX,
  Volume1,
  Hand,
  Waves,
} from "lucide-react";
import {
  CassetteCanvas,
  type Winding,
} from "./cassette-canvas";
import { TransportControls } from "./transport-controls";
import { SourceLoader, type Track } from "./source-loader";
import { TapeSlider, type TapeSliderHandle } from "./tape-slider";
import { TapeSoundEngine } from "@/lib/tape-sound-engine";
import { TapeAudioEngine } from "@/lib/audio-engine";
import { Button } from "@/components/ui/button";

// 带卷视觉旋转速度（度/秒）
const PLAY_DEG_PER_SEC = 80;
// 真实磁带机快进/快退带卷转速（很快）
const WIND_DEG_PER_SEC = 1400;
// 快进/快退音频倍速（真实磁带约 ×15）
const FF_RATE = 15;
const REWIND_RATE = 15;
const NORMAL_OMEGA = (PLAY_DEG_PER_SEC * Math.PI) / 180;
// 拖拽倍速上限（Web Audio playbackRate 实际支持到 ~16-32）
const DRAG_MAX_RATE = 16;
const DRAG_REWIND_MAX_RATE = 12;

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

interface PlayerState {
  track: Track | null;
  playing: boolean;
  winding: Winding;
  duration: number;
  volume: number;
  muted: boolean;
  sfxVolume: number;
  loading: boolean;
  error: string | null;
  soundsOn: boolean;
  progress: number;
}

const INITIAL_STATE: PlayerState = {
  track: null,
  playing: false,
  winding: null,
  duration: 0,
  volume: 0.85,
  muted: false,
  sfxVolume: 0.6,
  loading: false,
  error: null,
  soundsOn: true,
  progress: 0,
};

/**
 * CassettePlayer —— React 类组件（无 hook）
 * 磁带画面用 Canvas 渲染（无 DOM SVG），rAF 每帧调 canvas.draw()
 */
export class CassettePlayer extends React.Component<Record<string, never>, PlayerState> {
  state: PlayerState = INITIAL_STATE;

  private tapeSounds = new TapeSoundEngine();
  private audio = new TapeAudioEngine({
    onEnded: () => this.handleAudioEnded(),
    onLoaded: (dur) => this.handleAudioLoaded(dur),
    onError: (msg) => this.handleAudioError(msg),
  });

  // Canvas 磁带组件实例（类组件 ref）
  private canvasRef = React.createRef<CassetteCanvas>();

  private leftAngle = 0;
  private rightAngle = 0;

  // DOM 元素：rAF 直接更新
  private progressSlider: TapeSliderHandle | null = null;
  private progressSliderRef = React.createRef<TapeSlider>();
  private currentTimeLabel: HTMLSpanElement | null = null;
  private rateBadge: HTMLSpanElement | null = null;

  // 状态镜像（rAF 读这些值）
  private playing = false;
  private winding: Winding = null;
  private hasTape = false;
  private durationVal = 0;
  private soundsOn = true;
  private rafId: number | null = null;
  private rafActive = false;
  private progressFrame = 0;
  private lastUITime = -1;
  private lastUIRate = -999;

  // 拖拽状态
  private dragState = {
    active: false,
    side: "right" as "left" | "right",
    wasPlaying: false,
    direction: "none" as "forward" | "backward" | "none",
    omega: 0,
    lastRotateTime: 0,
  };

  // 带卷惯性：快进/快退松手后带卷继续转并衰减（音频立即停）
  // velocity: deg/s，正值=快进方向（左卷逆时针/右卷顺时针）
  private reelInertia = { active: false, velocity: 0 };

  componentDidMount() {
    this.progressSlider = this.progressSliderRef.current;
    this.audio.setVolume(this.state.muted ? 0 : this.state.volume);
    this.tapeSounds.setSfxVolume(this.state.sfxVolume);
  }

  componentWillUnmount() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.tapeSounds.dispose();
    this.audio.dispose();
  }

  componentDidUpdate(_prevProps: Record<string, never>, prevState: PlayerState) {
    if (prevState.playing !== this.state.playing) this.playing = this.state.playing;
    if (prevState.winding !== this.state.winding) this.winding = this.state.winding;
    if (prevState.duration !== this.state.duration) this.durationVal = this.state.duration;
    if (prevState.soundsOn !== this.state.soundsOn) {
      this.soundsOn = this.state.soundsOn;
      if (!this.soundsOn) {
        this.tapeSounds.setHiss(false);
        this.tapeSounds.setWind(0, true);
      }
    }
    const hasTape = this.state.track !== null;
    if (prevState.track !== this.state.track) this.hasTape = hasTape;

    if (
      prevState.volume !== this.state.volume ||
      prevState.muted !== this.state.muted
    ) {
      this.audio.setVolume(this.state.muted ? 0 : this.state.volume);
    }
    if (prevState.sfxVolume !== this.state.sfxVolume) {
      this.tapeSounds.setSfxVolume(this.state.sfxVolume);
    }

    if (this.state.playing || this.state.winding !== null) {
      this.ensureRAF();
    }
    // rAF 未运行时，状态变化也要重绘 canvas（如换磁带名/暂停态）
    if (!this.rafActive) {
      this.drawCanvas();
    }
  }

  // ===== 音频引擎回调 =====
  private handleAudioEnded() {
    this.setState({ playing: false, winding: null });
    this.winding = null;
    this.updateUI(0, 1);
    if (this.soundsOn) {
      const eng = this.ensureSounds();
      if (eng) {
        eng.setHiss(false);
        eng.brake();
      }
    }
  }

  private handleAudioLoaded(dur: number) {
    this.setState({ duration: dur });
    this.durationVal = dur;
    if (this.soundsOn) {
      const eng = this.ensureSounds();
      if (eng) eng.load();
    }
    setTimeout(() => {
      if (this.hasTape) {
        this.audio.play(0);
        this.setState({ playing: true });
        this.playing = true;
        this.ensureRAF();
        if (this.soundsOn) {
          const eng = this.ensureSounds();
          if (eng) eng.setHiss(true);
        }
      }
    }, 700);
  }

  private handleAudioError(msg: string) {
    this.setState({ error: msg, playing: false });
  }

  private ensureSounds(): TapeSoundEngine | null {
    if (!this.soundsOn) return null;
    this.tapeSounds.init();
    this.tapeSounds.resume();
    return this.tapeSounds;
  }

  // ===== Canvas 绘制 =====
  private drawCanvas() {
    const c = this.canvasRef.current;
    if (!c) return;
    const dur = this.durationVal;
    c.draw({
      leftAngle: this.leftAngle,
      rightAngle: this.rightAngle,
      progress: dur > 0 ? this.audio.currentTime / dur : 0,
      name: this.state.track?.name || "",
      artist: this.state.track?.artist || "",
      album: this.state.track?.album,
      playing: this.playing,
      winding: this.winding,
      hasTape: this.hasTape,
    });
  }

  // ===== rAF 主循环（智能启停） =====
  private ensureRAF = () => {
    if (this.rafActive) return;
    this.rafActive = true;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const eng = this.audio;
      const ds = this.dragState;

      if (eng) eng.tick(dt);

      if (ds.active && eng && this.hasTape) {
        const sinceRotate = now - ds.lastRotateTime;
        if (ds.direction === "forward") {
          eng.setReverse(false);
          let omega = ds.omega;
          if (sinceRotate > 120) {
            omega = omega * Math.max(0, 1 - (sinceRotate - 120) / 400);
          }
          // 增益 3 倍，让中等手速就能达到高倍速
          const rate = clamp(
            (Math.abs(omega) / NORMAL_OMEGA) * 3,
            0.0625,
            DRAG_MAX_RATE
          );
          eng.setRate(rate);
          this.updateUI(eng.currentTime, rate);
          if (!eng.isPlaying) eng.play();
        } else if (ds.direction === "backward") {
          eng.setReverse(true);
          let rewindSpeed = Math.abs(ds.omega) * 1.2;
          if (sinceRotate > 120) {
            rewindSpeed *= Math.max(0, 1 - (sinceRotate - 120) / 400);
          }
          rewindSpeed = clamp(rewindSpeed, 0.0625, DRAG_REWIND_MAX_RATE);
          eng.setRate(rewindSpeed);
          if (!eng.isPlaying) eng.play();
          this.updateUI(eng.currentTime, -rewindSpeed);
        } else {
          eng.setRate(0.0625);
          this.updateUI(eng.currentTime, 0.0625);
        }
        if (ds.direction !== "none") {
          const visOmega = Math.abs(ds.omega);
          const visDeg = visOmega * (180 / Math.PI) * dt;
          const sign = ds.direction === "forward" ? 1 : -1;
          if (ds.side === "right") {
            this.rightAngle += sign * visDeg;
            this.leftAngle -= sign * visDeg;
          } else {
            this.leftAngle -= sign * visDeg;
            this.rightAngle += sign * visDeg;
          }
        }
      } else {
        if (this.winding && eng && this.hasTape) {
          if (this.winding === "forward") {
            eng.setReverse(false);
            eng.setRate(FF_RATE);
            if (!eng.isPlaying) eng.play();
            this.updateUI(eng.currentTime, FF_RATE);
          } else {
            eng.setReverse(true);
            eng.setRate(REWIND_RATE);
            if (!eng.isPlaying) eng.play();
            this.updateUI(eng.currentTime, -REWIND_RATE);
            if (eng.currentTime <= 0.05) this.stopWinding();
          }
        } else if (this.playing && eng) {
          eng.setReverse(false);
          eng.setRate(1);
          this.updateUI(eng.currentTime, 1);
        }
        if (this.hasTape) {
          if (this.winding === "forward") {
            this.leftAngle -= WIND_DEG_PER_SEC * dt;
            this.rightAngle += WIND_DEG_PER_SEC * dt;
          } else if (this.winding === "rewind") {
            this.leftAngle += WIND_DEG_PER_SEC * dt;
            this.rightAngle -= WIND_DEG_PER_SEC * dt;
          } else if (this.playing) {
            this.leftAngle -= PLAY_DEG_PER_SEC * dt;
            this.rightAngle += PLAY_DEG_PER_SEC * dt;
          }
        }
      }

      // 带卷惯性：快进/快退松手后带卷继续转并衰减
      if (this.reelInertia.active && this.hasTape) {
        const v = this.reelInertia.velocity;
        // velocity>0 = 快进方向（左卷逆时针/右卷顺时针）
        this.leftAngle -= v * dt;
        this.rightAngle += v * dt;
        // 指数衰减，约 1.2 秒停
        this.reelInertia.velocity *= Math.pow(0.05, dt);
        if (Math.abs(this.reelInertia.velocity) < 2) {
          this.reelInertia.active = false;
          this.reelInertia.velocity = 0;
        }
      }

      // 每帧绘制 Canvas
      this.drawCanvas();

      const active =
        this.playing ||
        this.winding !== null ||
        this.dragState.active ||
        this.reelInertia.active;
      if (active) {
        this.rafId = requestAnimationFrame(loop);
      } else {
        this.rafActive = false;
        this.rafId = null;
        this.drawCanvas(); // 停止前最后绘一帧
      }
    };
    this.rafId = requestAnimationFrame(loop);
  };

  // DOM 直接更新（去重）
  private updateUI(time: number, rate: number) {
    if (time !== this.lastUITime) {
      this.lastUITime = time;
      if (this.progressSlider) this.progressSlider.setValue(time);
      if (this.currentTimeLabel)
        this.currentTimeLabel.textContent = formatTime(time);
      this.progressFrame++;
      if (this.progressFrame >= 6) {
        this.progressFrame = 0;
        const dur = this.durationVal;
        this.setState({ progress: dur > 0 ? time / dur : 0 });
      }
    }
    if (rate !== this.lastUIRate) {
      this.lastUIRate = rate;
      if (this.rateBadge) {
        const label =
          rate === 0
            ? "—"
            : rate < 0
              ? `${Math.abs(rate).toFixed(2)}× ◀◀`
              : rate < 0.95
                ? `${rate.toFixed(2)}× ↓`
                : rate > 1.05
                  ? `${rate.toFixed(2)}× ↑`
                  : "1.00×";
        this.rateBadge.textContent = label;
      }
    }
  }

  // ===== 控制函数 =====
  private play = () => {
    if (!this.hasTape) return;
    this.audio.resume();
    this.audio.setReverse(false);
    this.audio.setRate(1);
    if (!this.audio.isPlaying) this.audio.play();
    this.setState({ playing: true });
    this.playing = true;
    this.ensureRAF();
    if (this.soundsOn) {
      const sEng = this.ensureSounds();
      if (sEng) {
        sEng.click(0.8);
        sEng.setHiss(true);
      }
    }
  };

  private pause = () => {
    this.audio.pause();
    this.audio.setRate(1);
    this.setState({ playing: false });
    this.playing = false;
    if (this.soundsOn) {
      const sEng = this.ensureSounds();
      if (sEng) {
        sEng.click(0.7);
        sEng.setHiss(false);
      }
    }
  };

  private stop = () => {
    this.audio.stop();
    this.audio.setReverse(false);
    this.audio.setRate(1);
    this.setState({ playing: false, winding: null });
    this.playing = false;
    this.winding = null;
    this.updateUI(0, 0);
    if (this.soundsOn) {
      const sEng = this.ensureSounds();
      if (sEng) {
        sEng.brake();
        sEng.setHiss(false);
        sEng.setWind(0, true);
      }
    }
  };

  private startWinding = (dir: "forward" | "rewind") => {
    if (!this.hasTape) return;
    this.audio.resume();
    if (dir === "forward") {
      this.audio.setReverse(false);
      this.audio.setRate(FF_RATE);
      if (!this.audio.isPlaying) this.audio.play();
      this.setState({ playing: true });
      this.playing = true;
    } else {
      this.audio.setReverse(true);
      this.audio.setRate(REWIND_RATE);
      if (!this.audio.isPlaying) this.audio.play();
      this.setState({ playing: false });
      this.playing = false;
    }
    this.setState({ winding: dir });
    this.winding = dir;
    this.ensureRAF();
    if (this.soundsOn) {
      const sEng = this.ensureSounds();
      if (sEng) {
        sEng.click(0.9);
        sEng.setHiss(false);
        sEng.setWind(0.85, dir === "forward");
      }
    }
  };

  private stopWinding = () => {
    if (!this.winding) return;
    const wasForward = this.winding === "forward";
    // 触发带卷惯性：松手后带卷继续转并衰减（音频立即停）
    this.reelInertia.active = true;
    this.reelInertia.velocity = wasForward ? WIND_DEG_PER_SEC : -WIND_DEG_PER_SEC;
    this.setState({ winding: null });
    this.winding = null;
    // 音频立即停止
    this.audio.pause();
    this.audio.setReverse(false);
    this.audio.setRate(1);
    if (this.soundsOn) {
      const sEng = this.ensureSounds();
      if (sEng) {
        sEng.setWind(0, true);
        sEng.brake();
      }
    }
    if (!wasForward) {
      this.setState({ playing: false });
      this.playing = false;
      this.updateUI(this.audio.currentTime, 0);
    } else {
      this.updateUI(this.audio.currentTime, 1);
    }
    this.ensureRAF();
  };

  private eject = () => {
    this.audio.pause();
    this.audio.setReverse(false);
    this.audio.setRate(1);
    this.setState({ playing: false, winding: null, duration: 0, track: null });
    this.playing = false;
    this.winding = null;
    this.hasTape = false;
    this.durationVal = 0;
    this.updateUI(0, 0);
    this.leftAngle = 0;
    this.rightAngle = 0;
    this.drawCanvas();
    if (this.soundsOn) {
      const sEng = this.ensureSounds();
      if (sEng) {
        sEng.eject();
        sEng.setHiss(false);
        sEng.setWind(0, true);
      }
    }
  };

  // ===== 拖拽（Canvas 回调） =====
  private handleDragStart = (side: "left" | "right") => {
    if (!this.hasTape) return;
    this.ensureSounds();
    this.audio.resume();
    this.dragState.active = true;
    this.dragState.side = side;
    this.dragState.wasPlaying = this.playing;
    this.dragState.direction = "none";
    this.dragState.omega = 0;
    this.dragState.lastRotateTime = performance.now();
    this.ensureRAF();
    if (this.soundsOn) {
      this.tapeSounds.setHiss(false);
      this.tapeSounds.setWind(0.45, side === "right");
    }
  };

  private handleDragEnd = () => {
    if (!this.dragState.active) return;
    const wasPlaying = this.dragState.wasPlaying;
    this.dragState.active = false;
    this.dragState.direction = "none";
    // 恢复正放模式
    this.audio.setReverse(false);
    this.audio.setRate(1);
    if (this.soundsOn) {
      const sEng = this.ensureSounds();
      if (sEng) {
        sEng.setWind(0, true);
        sEng.brake();
      }
    }
    if (wasPlaying) {
      // 拖拽前是播放，恢复播放
      this.audio.play();
      this.setState({ playing: true });
      this.playing = true;
      this.ensureRAF();
      if (this.soundsOn) this.tapeSounds.setHiss(true);
    } else {
      // 拖拽前是暂停，必须显式暂停引擎（拖拽中可能调了 play 启动倒放）
      this.audio.pause();
      this.setState({ playing: false });
      this.playing = false;
      this.updateUI(this.audio.currentTime, 0);
      this.drawCanvas();
    }
  };

  private handleRotate = (deltaRad: number, side: "left" | "right") => {
    if (!this.dragState.active || !this.hasTape) return;
    const now = performance.now();
    const ds = this.dragState;
    const dt = Math.max(0.001, (now - ds.lastRotateTime) / 1000);
    const instOmega = deltaRad / dt;
    ds.omega = ds.omega * 0.55 + instOmega * 0.45;
    ds.lastRotateTime = now;
    let forward: boolean;
    if (side === "right") {
      forward = deltaRad > 0;
    } else {
      forward = deltaRad < 0;
    }
    ds.direction = forward ? "forward" : "backward";
    const degDelta = deltaRad * (180 / Math.PI);
    if (side === "right") {
      this.rightAngle += degDelta;
      this.leftAngle -= degDelta;
    } else {
      this.leftAngle += degDelta;
      this.rightAngle -= degDelta;
    }
  };

  // ===== 音频源加载 =====
  private loadTrack = async (newTrack: Track) => {
    if (this.hasTape && this.soundsOn) {
      const eng = this.ensureSounds();
      if (eng) eng.eject();
    }
    this.audio.pause();
    this.audio.setReverse(false);
    this.audio.setRate(1);
    this.setState({
      playing: false,
      winding: null,
      duration: 0,
      error: null,
      track: newTrack,
    });
    this.playing = false;
    this.winding = null;
    this.hasTape = true;
    this.durationVal = 0;
    this.updateUI(0, 0);
    this.leftAngle = 0;
    this.rightAngle = 0;
    this.drawCanvas();
    this.setState({ loading: true });
    try {
      await this.audio.load(newTrack.url);
    } catch (e) {
      this.setState({
        error: `音频加载失败：${e instanceof Error ? e.message : "未知错误"}`,
      });
    } finally {
      this.setState({ loading: false });
    }
  };

  private handleNetEase = async (input: string) => {
    this.setState({ loading: true, error: null });
    try {
      const idMatch = input.trim().match(/\d+/);
      if (!idMatch) {
        this.setState({
          error: "无法识别歌曲 ID，请输入数字 ID 或网易云分享链接。",
        });
        return;
      }
      const id = idMatch[0];
      const res = await fetch(`/api/netease/song?id=${id}`);
      const data = await res.json();
      if (!data.ok) {
        this.setState({ error: data.error || "解析失败" });
        return;
      }
      const song = data.data;
      await this.loadTrack({
        url: song.audioProxyUrl,
        name: song.name,
        artist: song.artist,
        album: song.album,
        cover: song.cover,
      });
    } catch (e) {
      this.setState({
        error: `解析失败：${e instanceof Error ? e.message : "未知错误"}`,
      });
    } finally {
      this.setState({ loading: false });
    }
  };

  private handleNetEaseSearch = async (songId: string) => {
    this.setState({ loading: true, error: null });
    try {
      const res = await fetch(`/api/netease/song?id=${songId}`);
      const data = await res.json();
      if (!data.ok) {
        this.setState({ error: data.error || "解析失败" });
        return;
      }
      const song = data.data;
      await this.loadTrack({
        url: song.audioProxyUrl,
        name: song.name,
        artist: song.artist,
        album: song.album,
        cover: song.cover,
      });
    } catch (e) {
      this.setState({
        error: `解析失败：${e instanceof Error ? e.message : "未知错误"}`,
      });
    } finally {
      this.setState({ loading: false });
    }
  };

  private handleLoad = (newTrack: Track) => {
    this.loadTrack(newTrack);
  };

  private onProgressChange = (t: number) => {
    this.audio.setReverse(false);
    this.audio.setRate(1);
    this.audio.seek(t);
    this.updateUI(t, 1);
  };

  render() {
    const {
      track,
      playing,
      winding,
      duration,
      volume,
      muted,
      sfxVolume,
      loading,
      error,
      soundsOn,
    } = this.state;
    const hasTape = track !== null;
    const VolumeIcon =
      muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

    return (
      <div className="w-full max-w-3xl mx-auto">
        {/* 磁带本体（Canvas） */}
        <div className="relative p-3 sm:p-5" style={{ backgroundColor: '#2a2a2e', border: '2px solid #000', boxShadow: '0 0 0 1px #3e3e44, 0 4px 0 #000' }}>
          <CassetteCanvas
            ref={this.canvasRef}
            onDragStart={this.handleDragStart}
            onDragEnd={this.handleDragEnd}
            onRotate={this.handleRotate}
          />
        </div>

        {/* 拖拽提示 + 实时速率 */}
        {hasTape ? (
          <div className="mt-3 flex items-center justify-center gap-3 text-xs text-stone-400 flex-wrap">
            <span className="flex items-center gap-1.5">
              <Hand className="w-3.5 h-3.5" />
              <span>
                在带卷上转圈滑动进退（顺时针＝快进变调，逆时针＝实时倒放）
              </span>
            </span>
            <span className="flex items-center gap-1 px-2 py-0.5 font-mono" style={{ backgroundColor: '#000', color: '#e8a050', border: '1px solid #3e3e44' }}>
              <Waves className="w-3 h-3" />
              <span ref={(el) => { this.rateBadge = el; }}>1.00×</span>
            </span>
          </div>
        ) : null}

        {/* 传输控制 */}
        <div className="mt-4 p-4" style={{ backgroundColor: '#222226', border: '2px solid #000', boxShadow: '0 0 0 1px #2e2e32, 0 3px 0 #000' }}>
          <TransportControls
            playing={playing}
            winding={winding}
            hasTape={hasTape}
            onPlayPause={() => {
              this.ensureSounds();
              if (playing) this.pause();
              else this.play();
            }}
            onStop={this.stop}
            onFastForwardStart={() => this.startWinding("forward")}
            onFastForwardEnd={this.stopWinding}
            onRewindStart={() => this.startWinding("rewind")}
            onRewindEnd={this.stopWinding}
            onEject={this.eject}
          />

          {/* 进度条 */}
          <div className="mt-4 px-1">
            <div className="flex items-center gap-3">
              <span
                ref={(el) => { this.currentTimeLabel = el; }}
                className="text-xs font-mono tabular-nums text-stone-300 w-10 text-right"
              >
                0:00
              </span>
              <TapeSlider
                ref={this.progressSliderRef}
                value={0}
                min={0}
                max={duration > 0 ? duration : 1}
                step={0.1}
                onChange={this.onProgressChange}
                disabled={!hasTape}
                variant="progress"
                ariaLabel="播放进度"
              />
              <span className="text-xs font-mono tabular-nums text-stone-500 w-10">
                {formatTime(duration)}
              </span>
            </div>
          </div>

          {/* 音量 + 音效音量 */}
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 px-1">
            <div className="flex items-center gap-2.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-stone-300 flex-shrink-0"
                onClick={() => this.setState({ muted: !muted })}
                aria-label={muted ? "取消静音" : "静音"}
              >
                <VolumeIcon className="w-4 h-4" />
              </Button>
              <TapeSlider
                value={muted ? 0 : volume}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => {
                  this.setState({ volume: v, muted: v > 0 ? false : muted });
                }}
                variant="volume"
                ariaLabel="主音量"
              />
              <span className="text-[10px] font-mono tabular-nums text-stone-500 w-8 text-right">
                {Math.round((muted ? 0 : volume) * 100)}
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <Button
                variant={soundsOn ? "secondary" : "outline"}
                size="icon"
                className="h-8 w-8 flex-shrink-0"
                onClick={() => this.setState({ soundsOn: !soundsOn })}
                aria-label="磁带音效开关"
                title="磁带机械音效开关"
              >
                <Waves className="w-4 h-4" />
              </Button>
              <TapeSlider
                value={soundsOn ? sfxVolume : 0}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => {
                  this.setState({
                    sfxVolume: v,
                    soundsOn: v > 0 ? true : soundsOn,
                  });
                }}
                variant="volume"
                ariaLabel="磁带音效音量"
              />
              <span className="text-[10px] font-mono tabular-nums text-stone-500 w-8 text-right">
                {soundsOn ? Math.round(sfxVolume * 100) : 0}
              </span>
            </div>
          </div>
        </div>

        {/* 音频源加载 */}
        <div className="mt-4 p-4" style={{ backgroundColor: '#222226', border: '2px solid #000', boxShadow: '0 0 0 1px #2e2e32, 0 3px 0 #000' }}>
          <div className="flex items-center gap-2 mb-3">
            <div style={{ width: 4, height: 16, backgroundColor: '#e8a050' }} />
            <h3 className="text-sm font-semibold text-stone-200">
              装入磁带
            </h3>
          </div>
          <SourceLoader
            onLoad={this.handleLoad}
            onNetEase={this.handleNetEase}
            onNetEaseSearch={this.handleNetEaseSearch}
            loading={loading}
            error={error}
          />
        </div>
      </div>
    );
  }
}
