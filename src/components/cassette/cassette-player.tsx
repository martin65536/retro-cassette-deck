"use client";

import React from "react";
import {
  Volume2,
  VolumeX,
  Volume1,
  Info,
  Hand,
  Waves,
} from "lucide-react";
import {
  CassetteTape,
  REEL_GEOM,
  type Winding,
} from "./cassette-tape";
import { TransportControls } from "./transport-controls";
import { SourceLoader, type Track } from "./source-loader";
import { TapeSlider, type TapeSliderHandle } from "./tape-slider";
import { TapeSoundEngine } from "@/lib/tape-sound-engine";
import { TapeAudioEngine } from "@/lib/audio-engine";
import { setupCircularDrag } from "@/lib/circular-drag";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// 带卷视觉旋转速度（度/秒）
const PLAY_DEG_PER_SEC = 80;
const WIND_DEG_PER_SEC = 760;
const WIND_REWIND_SPEED = 8;
const FF_RATE = 4;
const SEEK_PER_RAD_REVERSE = 1.8;
const NORMAL_OMEGA = (PLAY_DEG_PER_SEC * Math.PI) / 180;
const DRAG_MAX_RATE = 5;

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
  progress: number; // 低频更新（磁带半径视觉）
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
 * CassettePlayer —— React 类组件实现（无任何 React hook）
 *
 * 用实例属性代替 useRef（ref 对象 / 闭包变量），
 * 用类方法代替 useCallback（方法天然稳定引用）。
 * rAF 智能启停 + updateUI DOM 直接更新去重，降低 CPU。
 */
export class CassettePlayer extends React.Component<Record<string, never>, PlayerState> {
  state: PlayerState = INITIAL_STATE;

  // 引擎实例（代替 useRef + useEffect 创建）
  private tapeSounds = new TapeSoundEngine();
  private audio = new TapeAudioEngine({
    onEnded: () => this.handleAudioEnded(),
    onLoaded: (dur) => this.handleAudioLoaded(dur),
    onError: (msg) => this.handleAudioError(msg),
  });

  // SVG 带卷元素（代替 useRef）
  private leftReelEl: SVGGElement | null = null;
  private rightReelEl: SVGGElement | null = null;
  private leftAngle = 0;
  private rightAngle = 0;

  // DOM 元素：rAF 直接更新 DOM（避免每帧 setState）
  private progressSlider: TapeSliderHandle | null = null;
  private currentTimeLabel: HTMLSpanElement | null = null;
  private rateBadge: HTMLSpanElement | null = null;

  // 同步状态镜像（rAF 读这些值，避免读 state 的闭包问题）
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

  // 圆形拖拽控制器（setupCircularDrag 返回）
  private leftDrag: ReturnType<typeof setupCircularDrag> | null = null;
  private rightDrag: ReturnType<typeof setupCircularDrag> | null = null;

  // React ref 用于类组件获取子组件实例（TapeSlider 是类组件，ref 拿到实例）
  private progressSliderRef = React.createRef<TapeSlider>();

  componentDidMount() {
    // 绑定 progressSlider 实例
    this.progressSlider = this.progressSliderRef.current;

    // 创建两个圆形拖拽控制器
    this.leftDrag = setupCircularDrag(
      () => this.leftReelEl,
      {
        onRotate: (d) => this.handleRotate(d, "left"),
        onDragStart: () => this.handleDragStart("left"),
        onDragEnd: () => this.handleDragEnd(),
      }
    );
    this.rightDrag = setupCircularDrag(
      () => this.rightReelEl,
      {
        onRotate: (d) => this.handleRotate(d, "right"),
        onDragStart: () => this.handleDragStart("right"),
        onDragEnd: () => this.handleDragEnd(),
      }
    );

    // 初始音量同步
    this.audio.setVolume(this.state.muted ? 0 : this.state.volume);
    this.tapeSounds.setSfxVolume(this.state.sfxVolume);
  }

  componentWillUnmount() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.leftDrag?.cleanup();
    this.rightDrag?.cleanup();
    this.tapeSounds.dispose();
    this.audio.dispose();
  }

  componentDidUpdate(_prevProps: Record<string, never>, prevState: PlayerState) {
    // 同步镜像（state → 实例字段，供 rAF 读取）
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
    // hasTape 镜像
    const hasTape = this.state.track !== null;
    if (prevState.track !== this.state.track) this.hasTape = hasTape;

    // 音量变化时同步到引擎
    if (
      prevState.volume !== this.state.volume ||
      prevState.muted !== this.state.muted
    ) {
      this.audio.setVolume(this.state.muted ? 0 : this.state.volume);
    }
    if (prevState.sfxVolume !== this.state.sfxVolume) {
      this.tapeSounds.setSfxVolume(this.state.sfxVolume);
    }

    // playing/winding 变化时确保 rAF 运行
    if (this.state.playing || this.state.winding !== null) {
      this.ensureRAF();
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
    // 延迟自动播放
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

  // ===== 音效引擎辅助 =====
  private ensureSounds(): TapeSoundEngine | null {
    if (!this.soundsOn) return null;
    this.tapeSounds.init();
    this.tapeSounds.resume();
    return this.tapeSounds;
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
        // ===== 拖拽模式 =====
        const sinceRotate = now - ds.lastRotateTime;
        if (ds.direction === "forward") {
          let omega = ds.omega;
          if (sinceRotate > 120) {
            omega = omega * Math.max(0, 1 - (sinceRotate - 120) / 400);
          }
          const rate = clamp(
            Math.abs(omega) / NORMAL_OMEGA,
            0.0625,
            DRAG_MAX_RATE
          );
          eng.setRate(rate);
          this.updateUI(eng.currentTime, rate);
          if (!eng.isPlaying) eng.play();
        } else if (ds.direction === "backward") {
          if (eng.isPlaying) eng.pause();
          let rewindSpeed = Math.abs(ds.omega) * 1.2;
          if (sinceRotate > 120) {
            rewindSpeed *= Math.max(0, 1 - (sinceRotate - 120) / 400);
          }
          rewindSpeed = clamp(rewindSpeed, 0, 12);
          const newTime = eng.currentTime - rewindSpeed * dt;
          eng.setPlayhead(newTime);
          this.updateUI(eng.currentTime, 0);
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
          this.applyReelTransform();
        }
      } else {
        // ===== 非拖拽：正常播放 / 快进快退 =====
        if (this.winding && eng && this.hasTape) {
          if (this.winding === "forward") {
            eng.setRate(FF_RATE);
            if (!eng.isPlaying) eng.play();
            this.updateUI(eng.currentTime, FF_RATE);
          } else {
            if (eng.isPlaying) eng.pause();
            const newTime = eng.currentTime - WIND_REWIND_SPEED * dt;
            eng.setPlayhead(newTime);
            this.updateUI(eng.currentTime, 0);
            if (eng.currentTime <= 0.05) this.stopWinding();
          }
        } else if (this.playing && eng) {
          eng.setRate(1);
          this.updateUI(eng.currentTime, 1);
        }
        if (this.hasTape) {
          if (this.winding === "forward") {
            this.leftAngle -= WIND_DEG_PER_SEC * dt;
            this.rightAngle += WIND_DEG_PER_SEC * dt;
            this.applyReelTransform();
          } else if (this.winding === "rewind") {
            this.leftAngle += WIND_DEG_PER_SEC * dt;
            this.rightAngle -= WIND_DEG_PER_SEC * dt;
            this.applyReelTransform();
          } else if (this.playing) {
            this.leftAngle -= PLAY_DEG_PER_SEC * dt;
            this.rightAngle += PLAY_DEG_PER_SEC * dt;
            this.applyReelTransform();
          }
        }
      }

      // 智能启停
      const active = this.playing || this.winding !== null || this.dragState.active;
      if (active) {
        this.rafId = requestAnimationFrame(loop);
      } else {
        this.rafActive = false;
        this.rafId = null;
      }
    };
    this.rafId = requestAnimationFrame(loop);
  };

  private applyReelTransform() {
    if (this.leftReelEl) {
      this.leftReelEl.setAttribute(
        "transform",
        `rotate(${this.leftAngle} ${REEL_GEOM.leftCx} ${REEL_GEOM.cy})`
      );
    }
    if (this.rightReelEl) {
      this.rightReelEl.setAttribute(
        "transform",
        `rotate(${this.rightAngle} ${REEL_GEOM.rightCx} ${REEL_GEOM.cy})`
      );
    }
  }

  // DOM 直接更新（去重，值不变不写 DOM）
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
    const eng = this.audio;
    if (!this.hasTape) return;
    this.audio.resume();
    eng.setRate(1);
    if (!eng.isPlaying) eng.play();
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
    const eng = this.audio;
    eng.pause();
    eng.setRate(1);
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
    const eng = this.audio;
    eng.stop();
    eng.setRate(1);
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
    const eng = this.audio;
    if (!this.hasTape) return;
    this.audio.resume();
    if (dir === "forward") {
      eng.setRate(FF_RATE);
      if (!eng.isPlaying) eng.play();
      this.setState({ playing: true });
      this.playing = true;
    } else {
      eng.pause();
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
    this.setState({ winding: null });
    this.winding = null;
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
    }
  };

  private eject = () => {
    this.audio.pause();
    this.audio.setRate(1);
    this.setState({ playing: false, winding: null, duration: 0, track: null });
    this.playing = false;
    this.winding = null;
    this.hasTape = false;
    this.durationVal = 0;
    this.updateUI(0, 0);
    this.leftAngle = 0;
    this.rightAngle = 0;
    this.applyReelTransform();
    if (this.soundsOn) {
      const sEng = this.ensureSounds();
      if (sEng) {
        sEng.eject();
        sEng.setHiss(false);
        sEng.setWind(0, true);
      }
    }
  };

  // ===== 拖拽 =====
  private handleDragStart = (side: "left" | "right") => {
    if (!this.hasTape) return;
    this.audio.resume();
    this.dragState.active = true;
    this.dragState.side = side;
    this.dragState.wasPlaying = this.playing;
    this.dragState.direction = "none";
    this.dragState.omega = 0;
    this.dragState.lastRotateTime = performance.now();
    this.ensureRAF();
    if (this.soundsOn) {
      const sEng = this.ensureSounds();
      if (sEng) {
        sEng.setHiss(false);
        sEng.setWind(0.45, side === "right");
      }
    }
  };

  private handleDragEnd = () => {
    if (!this.dragState.active) return;
    const wasPlaying = this.dragState.wasPlaying;
    this.dragState.active = false;
    this.dragState.direction = "none";
    this.audio.setRate(1);
    if (this.soundsOn) {
      const sEng = this.ensureSounds();
      if (sEng) {
        sEng.setWind(0, true);
        sEng.brake();
      }
    }
    if (wasPlaying) {
      this.audio.play();
      this.setState({ playing: true });
      this.playing = true;
      if (this.soundsOn) {
        const sEng = this.ensureSounds();
        if (sEng) sEng.setHiss(true);
      }
    } else {
      this.setState({ playing: false });
      this.playing = false;
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
    this.applyReelTransform();
  };

  private onReelPointerDown = (
    e: React.PointerEvent<SVGGElement>,
    side: "left" | "right"
  ) => {
    this.ensureSounds();
    if (side === "left") this.leftDrag?.handlers.onPointerDown(e);
    else this.rightDrag?.handlers.onPointerDown(e);
  };

  private setLeftReel = (el: SVGGElement | null) => {
    this.leftReelEl = el;
  };
  private setRightReel = (el: SVGGElement | null) => {
    this.rightReelEl = el;
  };

  // ===== 音频源加载 =====
  private loadTrack = async (newTrack: Track) => {
    if (this.hasTape && this.soundsOn) {
      const eng = this.ensureSounds();
      if (eng) eng.eject();
    }
    this.audio.pause();
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
    this.applyReelTransform();
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
        url: `/api/netease/audio?id=${song.id}`,
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
      progress,
    } = this.state;
    const hasTape = track !== null;
    const VolumeIcon =
      muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

    return (
      <div className="w-full max-w-3xl mx-auto">
        {/* 磁带本体 */}
        <div className="relative rounded-2xl p-3 sm:p-5 bg-gradient-to-b from-stone-100 to-stone-200 dark:from-stone-900 dark:to-stone-950 border border-stone-300 dark:border-stone-700 shadow-2xl">
          <CassetteTape
            progress={progress}
            name={track?.name || ""}
            artist={track?.artist || ""}
            album={track?.album}
            playing={playing}
            winding={winding}
            hasTape={hasTape}
            leftReelRef={this.setLeftReel}
            rightReelRef={this.setRightReel}
            onReelPointerDown={this.onReelPointerDown}
          />
        </div>

        {/* 拖拽提示 + 实时速率 */}
        {hasTape ? (
          <div className="mt-3 flex items-center justify-center gap-3 text-xs text-amber-800/80 dark:text-stone-400 flex-wrap">
            <span className="flex items-center gap-1.5">
              <Hand className="w-3.5 h-3.5" />
              <span>
                在带卷上转圈滑动进退（顺时针＝快进变调，逆时针＝倒带）
              </span>
            </span>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-950/60 border border-orange-700/40 text-orange-300 font-mono">
              <Waves className="w-3 h-3" />
              <span ref={(el) => { this.rateBadge = el; }}>1.00×</span>
            </span>
          </div>
        ) : null}

        {/* 传输控制 */}
        <div className="mt-4 p-4 rounded-2xl bg-gradient-to-b from-amber-100 to-amber-200 dark:from-stone-800 dark:to-stone-900 border border-amber-700/40 dark:border-stone-700 shadow-lg">
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
                className="text-xs font-mono tabular-nums text-amber-900 dark:text-stone-300 w-10 text-right"
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
              <span className="text-xs font-mono tabular-nums text-amber-800/80 dark:text-stone-400 w-10">
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
                className="h-8 w-8 text-amber-800 dark:text-stone-300 flex-shrink-0"
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
              <span className="text-[10px] font-mono tabular-nums text-amber-800/80 w-8 text-right">
                {Math.round((muted ? 0 : volume) * 100)}
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={soundsOn ? "secondary" : "outline"}
                      size="icon"
                      className="h-8 w-8 flex-shrink-0"
                      onClick={() => this.setState({ soundsOn: !soundsOn })}
                      aria-label="磁带音效开关"
                    >
                      <Info className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>磁带机械音效开关</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
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
              <span className="text-[10px] font-mono tabular-nums text-amber-800/80 w-8 text-right">
                {soundsOn ? Math.round(sfxVolume * 100) : 0}
              </span>
            </div>
          </div>
        </div>

        {/* 音频源加载 */}
        <div className="mt-4 p-4 rounded-2xl bg-amber-50/80 dark:bg-stone-900/70 border border-amber-700/40 dark:border-stone-700/60 backdrop-blur">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-4 w-1 bg-orange-600 rounded-full" />
            <h3 className="text-sm font-semibold text-amber-900 dark:text-stone-200">
              装入磁带
            </h3>
          </div>
          <SourceLoader
            onLoad={this.handleLoad}
            onNetEase={this.handleNetEase}
            loading={loading}
            error={error}
          />
        </div>
      </div>
    );
  }
}
