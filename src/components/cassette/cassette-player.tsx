"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { TapeSlider } from "./tape-slider";
import { useTapeSounds } from "@/hooks/use-tape-sounds";
import { useAudioEngine } from "@/hooks/use-audio-engine";
import { useCircularDrag } from "@/hooks/use-circular-drag";
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
// 快退 seek 速度（倍速）
const WIND_REWIND_SPEED = 8;
// 快进按钮播放倍率（实时变调高音）
const FF_RATE = 4;
// 拖拽：每弧度对应的倒带秒数（逆时针用）
const SEEK_PER_RAD_REVERSE = 1.8;
// 正常播放对应的带卷角速度（rad/s），用于把拖拽角速度换算为 rate
const NORMAL_OMEGA = (PLAY_DEG_PER_SEC * Math.PI) / 180;
// 拖拽顺时针 rate 范围
const DRAG_MAX_RATE = 5;

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export function CassettePlayer() {
  // ===== 状态 =====
  const [track, setTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [winding, setWinding] = useState<Winding>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [sfxVolume, setSfxVolume] = useState(0.6);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [soundsOn, setSoundsOn] = useState(true);
  const [liveRate, setLiveRate] = useState(1);
  const [isFallback, setIsFallback] = useState(false);

  const hasTape = track !== null;
  const progress = duration > 0 ? currentTime / duration : 0;

  // ===== refs =====
  const leftReelElRef = useRef<SVGGElement | null>(null);
  const rightReelElRef = useRef<SVGGElement | null>(null);
  const leftAngleRef = useRef(0);
  const rightAngleRef = useRef(0);

  const playingRef = useRef(false);
  const windingRef = useRef<Winding>(null);
  const hasTapeRef = useRef(false);
  const durationRef = useRef(0);
  const soundsOnRef = useRef(true);
  const rafRef = useRef<number | null>(null);

  // 拖拽状态
  const dragStateRef = useRef({
    active: false,
    side: "right" as "left" | "right",
    wasPlaying: false,
    direction: "none" as "forward" | "backward" | "none",
    omega: 0,
    lastRotateTime: 0,
    rewindSpeed: 0, // 逆时针倒带速度（秒/秒）
  });

  const tapeSounds = useTapeSounds();
  const audio = useAudioEngine();

  // 回调绑定
  audio.onEndedRef.current = () => {
    setPlaying(false);
    windingRef.current = null;
    setWinding(null);
    setCurrentTime(0);
    setLiveRate(1);
    if (soundsOnRef.current) {
      const eng = tapeSounds.ensure();
      eng.setHiss(false);
      eng.brake();
    }
  };
  audio.onLoadedRef.current = (dur) => {
    setDuration(dur);
    durationRef.current = dur;
    const eng = audio.getEngine();
    setIsFallback(eng?.isFallback ?? false);
    if (soundsOnRef.current) {
      tapeSounds.ensure().load();
    }
    // 延迟自动播放
    setTimeout(() => {
      if (hasTapeRef.current) {
        audio.play(0);
        setPlaying(true);
        if (soundsOnRef.current) tapeSounds.ensure().setHiss(true);
      }
    }, 700);
  };
  audio.onErrorRef.current = (msg) => {
    setError(msg);
    setPlaying(false);
  };

  // 同步 ref
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    windingRef.current = winding;
  }, [winding]);
  useEffect(() => {
    hasTapeRef.current = hasTape;
  }, [hasTape]);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);
  useEffect(() => {
    soundsOnRef.current = soundsOn;
    if (!soundsOn) {
      tapeSounds.engine?.setHiss(false);
      tapeSounds.engine?.setWind(0, true);
    }
  }, [soundsOn, tapeSounds]);
  useEffect(() => {
    tapeSounds.setSfxVolume(sfxVolume);
  }, [sfxVolume, tapeSounds]);
  useEffect(() => {
    audio.setVolume(muted ? 0 : volume);
  }, [volume, muted, audio]);

  // 带卷 transform
  const applyReelTransform = useCallback(() => {
    if (leftReelElRef.current) {
      leftReelElRef.current.setAttribute(
        "transform",
        `rotate(${leftAngleRef.current} ${REEL_GEOM.leftCx} ${REEL_GEOM.cy})`
      );
    }
    if (rightReelElRef.current) {
      rightReelElRef.current.setAttribute(
        "transform",
        `rotate(${rightAngleRef.current} ${REEL_GEOM.rightCx} ${REEL_GEOM.cy})`
      );
    }
  }, []);

  // ===== rAF 主循环 =====
  const stopWindingRef = useRef<() => void>(() => {});

  useEffect(() => {
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const eng = audio.getEngine();

      // 引擎 tick（平滑 rate + 推进 playhead）
      if (eng) eng.tick(dt);

      const ds = dragStateRef.current;

      if (ds.active && eng && hasTapeRef.current) {
        // ===== 拖拽模式 =====
        const sinceRotate = now - ds.lastRotateTime;

        if (ds.direction === "forward") {
          // 顺时针：source 保持播放，rate 跟随角速度（连续变调）
          let omega = ds.omega;
          // 停顿时 omega 衰减
          if (sinceRotate > 120) {
            omega = omega * Math.max(0, 1 - (sinceRotate - 120) / 400);
          }
          const rate = clamp(
            Math.abs(omega) / NORMAL_OMEGA,
            0.0625,
            DRAG_MAX_RATE
          );
          eng.setRate(rate);
          setLiveRate(rate);
          if (!eng.isPlaying) eng.play();
          // 同步 UI 时间
          setCurrentTime(eng.currentTime);
        } else if (ds.direction === "backward") {
          // 逆时针：暂停 source + 手动倒退 playhead（精确）
          if (eng.isPlaying) eng.pause();
          let rewindSpeed = Math.abs(ds.omega) * 1.2; // rad/s → 倍速
          if (sinceRotate > 120) {
            rewindSpeed *= Math.max(0, 1 - (sinceRotate - 120) / 400);
          }
          rewindSpeed = clamp(rewindSpeed, 0, 12);
          const newTime = eng.currentTime - rewindSpeed * dt;
          eng.setPlayhead(newTime);
          setCurrentTime(eng.currentTime);
          setLiveRate(0);
        } else {
          // direction=none：刚按下
          eng.setRate(0.0625);
          setLiveRate(0.0625);
        }

        // 带卷视觉跟随角速度
        if (ds.direction !== "none") {
          const visOmega = Math.abs(ds.omega);
          const visDeg = visOmega * (180 / Math.PI) * dt;
          const sign = ds.direction === "forward" ? 1 : -1;
          if (ds.side === "right") {
            rightAngleRef.current += sign * visDeg;
            leftAngleRef.current -= sign * visDeg;
          } else {
            leftAngleRef.current -= sign * visDeg;
            rightAngleRef.current += sign * visDeg;
          }
          applyReelTransform();
        }
      } else {
        // ===== 非拖拽：正常播放 / 快进快退 =====
        if (windingRef.current && eng && hasTapeRef.current) {
          if (windingRef.current === "forward") {
            // 快进：保持播放，rate=FF_RATE（连续变调）
            eng.setRate(FF_RATE);
            if (!eng.isPlaying) eng.play();
            setLiveRate(FF_RATE);
            setCurrentTime(eng.currentTime);
          } else {
            // 快退：暂停 + 倒退 playhead
            if (eng.isPlaying) eng.pause();
            const newTime = eng.currentTime - WIND_REWIND_SPEED * dt;
            eng.setPlayhead(newTime);
            setCurrentTime(eng.currentTime);
            setLiveRate(0);
            if (eng.currentTime <= 0.05) stopWindingRef.current();
          }
        } else if (playingRef.current && eng) {
          eng.setRate(1);
          setLiveRate(1);
          setCurrentTime(eng.currentTime);
        } else {
          setLiveRate(eng?.isPlaying ? eng.currentRate : 0);
        }

        // 带卷旋转
        if (hasTapeRef.current) {
          if (windingRef.current === "forward") {
            leftAngleRef.current -= WIND_DEG_PER_SEC * dt;
            rightAngleRef.current += WIND_DEG_PER_SEC * dt;
            applyReelTransform();
          } else if (windingRef.current === "rewind") {
            leftAngleRef.current += WIND_DEG_PER_SEC * dt;
            rightAngleRef.current -= WIND_DEG_PER_SEC * dt;
            applyReelTransform();
          } else if (playingRef.current) {
            leftAngleRef.current -= PLAY_DEG_PER_SEC * dt;
            rightAngleRef.current += PLAY_DEG_PER_SEC * dt;
            applyReelTransform();
          }
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [applyReelTransform, audio]);

  // ===== 控制函数 =====

  const ensureSounds = useCallback(() => {
    if (!soundsOnRef.current) return null;
    return tapeSounds.ensure();
  }, [tapeSounds]);

  const play = useCallback(() => {
    const eng = audio.getEngine();
    if (!eng || !hasTapeRef.current) return;
    audio.resume();
    eng.setRate(1);
    if (!eng.isPlaying) eng.play();
    setPlaying(true);
    if (soundsOnRef.current) {
      const sEng = tapeSounds.ensure();
      sEng.click(0.8);
      sEng.setHiss(true);
    }
  }, [audio, tapeSounds]);

  const pause = useCallback(() => {
    const eng = audio.getEngine();
    if (!eng) return;
    eng.pause();
    eng.setRate(1);
    setPlaying(false);
    if (soundsOnRef.current) {
      const sEng = tapeSounds.ensure();
      sEng.click(0.7);
      sEng.setHiss(false);
    }
  }, [audio, tapeSounds]);

  const stop = useCallback(() => {
    const eng = audio.getEngine();
    if (!eng) return;
    eng.stop();
    eng.setRate(1);
    setPlaying(false);
    setWinding(null);
    windingRef.current = null;
    setCurrentTime(0);
    setLiveRate(0);
    if (soundsOnRef.current) {
      const sEng = tapeSounds.ensure();
      sEng.brake();
      sEng.setHiss(false);
      sEng.setWind(0, true);
    }
  }, [audio, tapeSounds]);

  const startWinding = useCallback(
    (dir: "forward" | "rewind") => {
      const eng = audio.getEngine();
      if (!eng || !hasTapeRef.current) return;
      audio.resume();
      if (dir === "forward") {
        eng.setRate(FF_RATE);
        if (!eng.isPlaying) eng.play();
        setPlaying(true);
      } else {
        eng.pause();
        setPlaying(false);
      }
      setWinding(dir);
      windingRef.current = dir;
      if (soundsOnRef.current) {
        const sEng = tapeSounds.ensure();
        sEng.click(0.9);
        sEng.setHiss(false);
        sEng.setWind(0.85, dir === "forward");
      }
    },
    [audio, tapeSounds]
  );

  const stopWinding = useCallback(() => {
    if (!windingRef.current) return;
    const wasForward = windingRef.current === "forward";
    setWinding(null);
    windingRef.current = null;
    const eng = audio.getEngine();
    if (eng) {
      eng.setRate(1);
    }
    if (soundsOnRef.current) {
      const sEng = tapeSounds.ensure();
      sEng.setWind(0, true);
      sEng.brake();
    }
    // 快进松手后保持播放（已经是 playing 状态）
    if (!wasForward) {
      setPlaying(false);
    }
  }, [audio, tapeSounds]);

  useEffect(() => {
    stopWindingRef.current = stopWinding;
  }, [stopWinding]);

  const eject = useCallback(() => {
    const eng = audio.getEngine();
    if (eng) {
      eng.pause();
      eng.setRate(1);
    }
    setPlaying(false);
    setWinding(null);
    windingRef.current = null;
    setCurrentTime(0);
    setDuration(0);
    durationRef.current = 0;
    setTrack(null);
    hasTapeRef.current = false;
    setIsFallback(false);
    leftAngleRef.current = 0;
    rightAngleRef.current = 0;
    applyReelTransform();
    if (soundsOnRef.current) {
      const sEng = tapeSounds.ensure();
      sEng.eject();
      sEng.setHiss(false);
      sEng.setWind(0, true);
    }
  }, [audio, tapeSounds, applyReelTransform]);

  // ===== 拖拽 =====

  const handleDragStart = useCallback(
    (side: "left" | "right") => {
      const eng = audio.getEngine();
      if (!eng || !hasTapeRef.current) return;
      audio.resume();
      dragStateRef.current.active = true;
      dragStateRef.current.side = side;
      dragStateRef.current.wasPlaying = playingRef.current;
      dragStateRef.current.direction = "none";
      dragStateRef.current.omega = 0;
      dragStateRef.current.lastRotateTime = performance.now();
      if (soundsOnRef.current) {
        const sEng = tapeSounds.ensure();
        sEng.setHiss(false);
        sEng.setWind(0.45, side === "right");
      }
    },
    [audio, tapeSounds]
  );

  const handleDragEnd = useCallback(() => {
    if (!dragStateRef.current.active) return;
    const wasPlaying = dragStateRef.current.wasPlaying;
    const ds = dragStateRef.current;
    ds.active = false;
    ds.direction = "none";
    const eng = audio.getEngine();
    if (eng) {
      eng.setRate(1);
    }
    if (soundsOnRef.current) {
      const sEng = tapeSounds.ensure();
      sEng.setWind(0, true);
      sEng.brake();
    }
    // 恢复播放
    if (wasPlaying && eng) {
      eng.play();
      setPlaying(true);
      if (soundsOnRef.current) tapeSounds.ensure().setHiss(true);
    } else if (eng) {
      setPlaying(false);
    }
  }, [audio, tapeSounds]);

  const handleRotate = useCallback(
    (deltaRad: number, side: "left" | "right") => {
      if (!dragStateRef.current.active || !hasTapeRef.current) return;
      const now = performance.now();
      const ds = dragStateRef.current;

      // 瞬时角速度，低通滤波平滑
      const dt = Math.max(0.001, (now - ds.lastRotateTime) / 1000);
      const instOmega = deltaRad / dt;
      ds.omega = ds.omega * 0.55 + instOmega * 0.45;
      ds.lastRotateTime = now;

      // 判断方向：右卷 delta>0 = 快进；左卷 delta>0 = 倒带
      let forward: boolean;
      if (side === "right") {
        forward = deltaRad > 0;
      } else {
        forward = deltaRad < 0;
      }
      ds.direction = forward ? "forward" : "backward";

      // 立即更新带卷视觉（跟手）
      const degDelta = deltaRad * (180 / Math.PI);
      if (side === "right") {
        rightAngleRef.current += degDelta;
        leftAngleRef.current -= degDelta;
      } else {
        leftAngleRef.current += degDelta;
        rightAngleRef.current -= degDelta;
      }
      applyReelTransform();
    },
    [applyReelTransform]
  );

  const leftDrag = useCircularDrag({
    onRotate: (d) => handleRotate(d, "left"),
    onDragStart: () => handleDragStart("left"),
    onDragEnd: handleDragEnd,
  });
  const rightDrag = useCircularDrag({
    onRotate: (d) => handleRotate(d, "right"),
    onDragStart: () => handleDragStart("right"),
    onDragEnd: handleDragEnd,
  });

  const leftReelRef = useCallback(
    (el: SVGGElement | null) => {
      leftReelElRef.current = el;
      leftDrag.bind(el);
    },
    [leftDrag]
  );
  const rightReelRef = useCallback(
    (el: SVGGElement | null) => {
      rightReelElRef.current = el;
      rightDrag.bind(el);
    },
    [rightDrag]
  );

  const onReelPointerDown = useCallback(
    (e: React.PointerEvent<SVGGElement>, side: "left" | "right") => {
      ensureSounds();
      if (side === "left") leftDrag.handlers.onPointerDown(e);
      else rightDrag.handlers.onPointerDown(e);
    },
    [leftDrag, rightDrag, ensureSounds]
  );

  // ===== 音频源加载 =====

  const loadTrack = useCallback(
    async (newTrack: Track) => {
      if (hasTapeRef.current && soundsOnRef.current) {
        tapeSounds.ensure().eject();
      }
      const eng = audio.getEngine();
      if (eng) {
        eng.pause();
      }
      setPlaying(false);
      setWinding(null);
      windingRef.current = null;
      setCurrentTime(0);
      setDuration(0);
      durationRef.current = 0;
      setError(null);
      setIsFallback(false);
      leftAngleRef.current = 0;
      rightAngleRef.current = 0;
      setTrack(newTrack);
      hasTapeRef.current = true;
      // 加载音频
      setLoading(true);
      try {
        await audio.load(newTrack.url);
      } catch (e) {
        setError(
          `音频加载失败：${e instanceof Error ? e.message : "未知错误"}`
        );
      } finally {
        setLoading(false);
      }
    },
    [audio, tapeSounds]
  );

  const handleNetEase = useCallback(
    async (input: string) => {
      setLoading(true);
      setError(null);
      try {
        const idMatch = input.trim().match(/\d+/);
        if (!idMatch) {
          setError("无法识别歌曲 ID，请输入数字 ID 或网易云分享链接。");
          setLoading(false);
          return;
        }
        const id = idMatch[0];
        const res = await fetch(`/api/netease/song?id=${id}`);
        const data = await res.json();
        if (!data.ok) {
          setError(data.error || "解析失败");
          setLoading(false);
          return;
        }
        const song = data.data;
        await loadTrack({
          url: song.url,
          name: song.name,
          artist: song.artist,
          album: song.album,
          cover: song.cover,
        });
      } catch (e) {
        setError(
          `解析失败：${e instanceof Error ? e.message : "未知错误"}`
        );
      } finally {
        setLoading(false);
      }
    },
    [loadTrack]
  );

  const handleLoad = useCallback(
    (newTrack: Track) => {
      loadTrack(newTrack);
    },
    [loadTrack]
  );

  // 进度条 seek
  const onProgressChange = (t: number) => {
    const eng = audio.getEngine();
    if (eng) {
      eng.setRate(1);
      eng.seek(t);
    }
    setCurrentTime(t);
  };

  const VolumeIcon =
    muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  const rateLabel =
    liveRate === 0
      ? "—"
      : liveRate < 0.95
        ? `${liveRate.toFixed(2)}× ↓`
        : liveRate > 1.05
          ? `${liveRate.toFixed(2)}× ↑`
          : "1.00×";

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
          leftReelRef={leftReelRef}
          rightReelRef={rightReelRef}
          onReelPointerDown={onReelPointerDown}
        />
      </div>

      {/* 拖拽提示 + 实时速率 */}
      {hasTape ? (
        <div className="mt-3 flex items-center justify-center gap-3 text-xs text-stone-500 dark:text-stone-400 flex-wrap">
          <span className="flex items-center gap-1.5">
            <Hand className="w-3.5 h-3.5" />
            <span>
              在带卷上转圈滑动进退（顺时针＝快进变调，逆时针＝倒带）
            </span>
          </span>
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-950/60 border border-orange-700/40 text-orange-300 font-mono">
            <Waves className="w-3 h-3" />
            {rateLabel}
          </span>
        </div>
      ) : null}

      {/* 降级提示 */}
      {isFallback ? (
        <div className="mt-2 text-center text-[11px] text-amber-600 dark:text-amber-400">
          ⚠ 当前音频为跨域源，已降级为 HTML 播放（变调可能不够平滑），本地上传或示例曲目可享完整 Web Audio 体验
        </div>
      ) : null}

      {/* 传输控制 */}
      <div className="mt-4 p-4 rounded-2xl bg-gradient-to-b from-stone-200 to-stone-300 dark:from-stone-800 dark:to-stone-900 border border-stone-400/40 dark:border-stone-700">
        <TransportControls
          playing={playing}
          winding={winding}
          hasTape={hasTape}
          onPlayPause={() => {
            ensureSounds();
            if (playing) pause();
            else play();
          }}
          onStop={stop}
          onFastForwardStart={() => startWinding("forward")}
          onFastForwardEnd={stopWinding}
          onRewindStart={() => startWinding("rewind")}
          onRewindEnd={stopWinding}
          onEject={eject}
        />

        {/* 进度条 */}
        <div className="mt-4 px-1">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono tabular-nums text-stone-600 dark:text-stone-300 w-10 text-right">
              {formatTime(currentTime)}
            </span>
            <TapeSlider
              value={currentTime}
              min={0}
              max={duration > 0 ? duration : 1}
              step={0.1}
              onChange={onProgressChange}
              disabled={!hasTape}
              variant="progress"
              ariaLabel="播放进度"
            />
            <span className="text-xs font-mono tabular-nums text-stone-500 dark:text-stone-400 w-10">
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
              className="h-8 w-8 text-stone-600 dark:text-stone-300 flex-shrink-0"
              onClick={() => setMuted((m) => !m)}
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
                setVolume(v);
                if (v > 0) setMuted(false);
              }}
              variant="volume"
              ariaLabel="主音量"
            />
            <span className="text-[10px] font-mono tabular-nums text-stone-500 w-8 text-right">
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
                    onClick={() => setSoundsOn((s) => !s)}
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
                setSfxVolume(v);
                if (v > 0) setSoundsOn(true);
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
      <div className="mt-4 p-4 rounded-2xl bg-white/70 dark:bg-stone-900/70 border border-stone-300/60 dark:border-stone-700/60 backdrop-blur">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-4 w-1 bg-orange-600 rounded-full" />
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">
            装入磁带
          </h3>
        </div>
        <SourceLoader
          onLoad={handleLoad}
          onNetEase={handleNetEase}
          loading={loading}
          error={error}
        />
      </div>
    </div>
  );
}
