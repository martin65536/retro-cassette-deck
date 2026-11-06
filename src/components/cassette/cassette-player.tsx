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
import { useCircularDrag } from "@/hooks/use-circular-drag";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ===== 常量 =====
// 带卷视觉旋转速度（度/秒）
const PLAY_DEG_PER_SEC = 80;
const WIND_DEG_PER_SEC = 760;
// 快进/快退 seek 倍速
const WIND_SEEK_SPEED = 8;
// 拖拽时每弧度对应的 seek 秒数（用于逆时针倒退；顺时针让 audio 自然推进）
const SEEK_PER_RAD_REVERSE = 1.6;
// 正常播放对应的带卷角速度（rad/s），用于把拖拽角速度换算为 playbackRate
// PLAY_DEG_PER_SEC=80°/s ≈ 1.396 rad/s
const NORMAL_OMEGA = (PLAY_DEG_PER_SEC * Math.PI) / 180;
// 拖拽时 playbackRate 范围（Chrome 支持范围约 0.0625~16）
const MIN_RATE = 0.0625;
const MAX_RATE = 4.5;
// 快进按钮的播放倍率（会产生高音变调）
const FF_RATE = 6;

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/**
 * 设置 audio 元素为"磁带模式"：改变 playbackRate 时音高随之变化（不保持音高）
 * 这是实现实时变调的关键 —— 不需要 Web Audio API 的 MediaElementSource，
 * 直接用 HTMLMediaElement 原生属性，避免跨域 CORS 问题。
 */
function applyTapePitch(audio: HTMLAudioElement) {
  // 标准属性 + 浏览器前缀
  (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch =
    false;
  (
    audio as HTMLAudioElement & { mozPreservesPitch?: boolean }
  ).mozPreservesPitch = false;
  (
    audio as HTMLAudioElement & { webkitPreservesPitch?: boolean }
  ).webkitPreservesPitch = false;
}

export function CassettePlayer() {
  // ===== 播放状态 =====
  const [track, setTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [winding, setWinding] = useState<Winding>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [sfxVolume, setSfxVolume] = useState(0.6); // 磁带音效音量 0~1
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [soundsOn, setSoundsOn] = useState(true);
  const [liveRate, setLiveRate] = useState(1); // 当前实际 playbackRate（用于 UI 显示）

  const hasTape = track !== null;
  const progress = duration > 0 ? currentTime / duration : 0;

  // ===== refs =====
  const audioRef = useRef<HTMLAudioElement | null>(null);
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
    seekTarget: 0,
    /** 最近一次旋转的方向与瞬时角速度（rad/s）+ 时间戳 */
    direction: "none" as "forward" | "backward" | "none",
    omega: 0,
    lastRotateTime: 0,
  });

  const tapeSounds = useTapeSounds();

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

  // 同步音效音量
  useEffect(() => {
    tapeSounds.setSfxVolume(sfxVolume);
  }, [sfxVolume, tapeSounds]);

  // 设置带卷 transform
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

  // ===== rAF 循环：带卷旋转 + 拖拽/快进推进 =====
  const stopWindingRef = useRef<() => void>(() => {});

  useEffect(() => {
    let last = performance.now();
    const loop = (now: number) => {
      let next = true;
      try {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        const audio = audioRef.current;

        if (dragStateRef.current.active && audio && hasTapeRef.current) {
          const ds = dragStateRef.current;
          const sinceRotate = now - ds.lastRotateTime;
          const dur = durationRef.current;

          if (ds.direction === "forward") {
            // 顺时针：保持播放，playbackRate 由角速度决定（实时变调）
            let rate: number;
            if (sinceRotate < 200) {
              rate = clamp(
                Math.abs(ds.omega) / NORMAL_OMEGA,
                MIN_RATE,
                MAX_RATE
              );
            } else {
              rate = MIN_RATE;
            }
            audio.playbackRate = rate;
            setLiveRate(rate);
            setCurrentTime(audio.currentTime);
          } else if (ds.direction === "backward") {
            // 逆时针：暂停 + 手动倒退 + 卷带音效
            if (!audio.paused) audio.pause();
            if (sinceRotate < 200) {
              const speed = Math.abs(ds.omega);
              const rewindPerSec =
                (speed / NORMAL_OMEGA) * WIND_SEEK_SPEED;
              ds.seekTarget = clamp(
                ds.seekTarget - rewindPerSec * dt,
                0,
                dur > 0 ? dur : 0
              );
            }
            if (Math.abs(audio.currentTime - ds.seekTarget) > 0.05) {
              try {
                audio.currentTime = ds.seekTarget;
              } catch {
                /* ignore */
              }
            }
            setCurrentTime(ds.seekTarget);
            setLiveRate(0);
          } else {
            // direction=none，刚按下还没动
            audio.playbackRate = MIN_RATE;
            setLiveRate(MIN_RATE);
          }

          // 带卷视觉旋转跟随拖拽方向
          if (ds.direction !== "none") {
            const visSpeed = Math.abs(ds.omega) * (180 / Math.PI);
            const sign = ds.direction === "forward" ? 1 : -1;
            if (ds.side === "right") {
              rightAngleRef.current += sign * visSpeed * dt;
              leftAngleRef.current -= sign * visSpeed * dt;
            } else {
              leftAngleRef.current -= sign * visSpeed * dt;
              rightAngleRef.current += sign * visSpeed * dt;
            }
            applyReelTransform();
          }
        } else {
          // ===== 非拖拽：快进/快退 / 播放 =====
          if (windingRef.current && audio && hasTapeRef.current) {
            if (windingRef.current === "forward") {
              if (audio.paused) {
                audio.play().catch(() => {});
              }
              audio.playbackRate = FF_RATE;
              setLiveRate(FF_RATE);
            } else {
              if (!audio.paused) audio.pause();
              const newTime =
                audio.currentTime - WIND_SEEK_SPEED * dt;
              const dur = durationRef.current;
              const clamped = clamp(newTime, 0, dur > 0 ? dur - 0.05 : 0);
              try {
                audio.currentTime = clamped;
              } catch {
                /* ignore */
              }
              setCurrentTime(clamped);
              setLiveRate(0);
              if (clamped <= 0.05) stopWindingRef.current();
            }
          } else if (playingRef.current && audio) {
            audio.playbackRate = 1;
            setLiveRate(1);
          } else {
            setLiveRate(audio?.paused ? 0 : 1);
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
      } catch (err) {
        console.error("[rAF] loop error:", err);
      }
      if (next) {
        rafRef.current = requestAnimationFrame(loop);
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [applyReelTransform]);

  // ===== 控制函数 =====

  const ensureSounds = useCallback(() => {
    if (!soundsOnRef.current) return null;
    return tapeSounds.ensure();
  }, [tapeSounds]);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !hasTapeRef.current) return;
    applyTapePitch(audio);
    audio.playbackRate = 1;
    audio.volume = muted ? 0 : volume;
    audio
      .play()
      .then(() => {
        setPlaying(true);
        if (soundsOnRef.current) {
          const eng = tapeSounds.ensure();
          eng.click(0.8);
          eng.setHiss(true);
        }
      })
      .catch(() => {
        setError("播放失败，可能是音频源不可用或被浏览器阻止。");
      });
  }, [volume, muted, tapeSounds]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.playbackRate = 1;
    setPlaying(false);
    if (soundsOnRef.current) {
      const eng = tapeSounds.ensure();
      eng.click(0.7);
      eng.setHiss(false);
    }
  }, [tapeSounds]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.playbackRate = 1;
    audio.currentTime = 0;
    setPlaying(false);
    setWinding(null);
    windingRef.current = null;
    setCurrentTime(0);
    if (soundsOnRef.current) {
      const eng = tapeSounds.ensure();
      eng.brake();
      eng.setHiss(false);
      eng.setWind(0, true);
    }
  }, [tapeSounds]);

  const startWinding = useCallback(
    (dir: "forward" | "rewind") => {
      const audio = audioRef.current;
      if (!audio || !hasTapeRef.current) return;
      applyTapePitch(audio);
      if (dir === "forward") {
        // 快进：保持播放，playbackRate=6 产生高音变调
        if (audio.paused) {
          audio.volume = muted ? 0 : volume;
          audio.play().catch(() => {});
        }
        audio.playbackRate = FF_RATE;
        setPlaying(true);
      } else {
        // 快退：暂停 + 手动倒退
        audio.pause();
        audio.playbackRate = 1;
        setPlaying(false);
      }
      setWinding(dir);
      windingRef.current = dir;
      if (soundsOnRef.current) {
        const eng = tapeSounds.ensure();
        eng.click(0.9);
        eng.setHiss(false);
        eng.setWind(0.85, dir === "forward");
      }
    },
    [volume, muted, tapeSounds]
  );

  const stopWinding = useCallback(() => {
    if (!windingRef.current) return;
    const wasForward = windingRef.current === "forward";
    setWinding(null);
    windingRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      if (wasForward) {
        // 快进回到正常播放
        audio.playbackRate = 1;
      }
    }
    if (soundsOnRef.current) {
      const eng = tapeSounds.ensure();
      eng.setWind(0, true);
      eng.brake();
    }
  }, [tapeSounds]);

  useEffect(() => {
    stopWindingRef.current = stopWinding;
  }, [stopWinding]);

  const eject = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setPlaying(false);
    setWinding(null);
    windingRef.current = null;
    setCurrentTime(0);
    setDuration(0);
    durationRef.current = 0;
    setTrack(null);
    hasTapeRef.current = false;
    leftAngleRef.current = 0;
    rightAngleRef.current = 0;
    applyReelTransform();
    if (soundsOnRef.current) {
      const eng = tapeSounds.ensure();
      eng.eject();
      eng.setHiss(false);
      eng.setWind(0, true);
    }
  }, [tapeSounds, applyReelTransform]);

  // ===== 拖拽（在带卷上转圈滑动） =====

  const handleDragStart = useCallback(
    (side: "left" | "right") => {
      const audio = audioRef.current;
      if (!audio || !hasTapeRef.current) return;
      applyTapePitch(audio);
      dragStateRef.current.active = true;
      dragStateRef.current.side = side;
      dragStateRef.current.wasPlaying = playingRef.current;
      dragStateRef.current.seekTarget = audio.currentTime;
      dragStateRef.current.direction = "none";
      dragStateRef.current.omega = 0;
      dragStateRef.current.lastRotateTime = performance.now();
      if (soundsOnRef.current) {
        const eng = tapeSounds.ensure();
        eng.setHiss(false);
        eng.setWind(0.45, side === "right");
      }
    },
    [tapeSounds]
  );

  const handleDragEnd = useCallback(() => {
    if (!dragStateRef.current.active) return;
    const wasPlaying = dragStateRef.current.wasPlaying;
    dragStateRef.current.active = false;
    dragStateRef.current.direction = "none";
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = 1;
    }
    if (soundsOnRef.current) {
      const eng = tapeSounds.ensure();
      eng.setWind(0, true);
      eng.brake();
    }
    // 恢复播放
    if (wasPlaying && audio) {
      audio
        .play()
        .then(() => {
          setPlaying(true);
          if (soundsOnRef.current) tapeSounds.ensure().setHiss(true);
        })
        .catch(() => {});
    } else if (audio) {
      audio.pause();
      setPlaying(false);
    }
  }, [tapeSounds]);

  const handleRotate = useCallback(
    (deltaRad: number, side: "left" | "right") => {
      if (!dragStateRef.current.active || !hasTapeRef.current) return;
      const now = performance.now();
      const ds = dragStateRef.current;

      // 计算瞬时角速度（rad/s），用低通滤波平滑
      const dt = Math.max(0.001, (now - ds.lastRotateTime) / 1000);
      const instOmega = deltaRad / dt;
      ds.omega = ds.omega * 0.5 + instOmega * 0.5;
      ds.lastRotateTime = now;

      // 判断方向：右卷 delta>0 = 快进；左卷 delta>0 = 倒带
      let forward: boolean;
      if (side === "right") {
        forward = deltaRad > 0;
      } else {
        forward = deltaRad < 0;
      }
      ds.direction = forward ? "forward" : "backward";

      const degDelta = deltaRad * (180 / Math.PI);

      if (forward) {
        // 顺时针：让 audio 自然推进（playbackRate 跟随角速度，实时变调）
        const audio = audioRef.current;
        if (audio) {
          if (audio.paused) {
            audio.volume = muted ? 0 : volume;
            audio.play().catch(() => {});
          }
          // 立即设置 playbackRate（不等 rAF），让变调即时响应
          const rate = clamp(
            Math.abs(ds.omega) / NORMAL_OMEGA,
            MIN_RATE,
            MAX_RATE
          );
          audio.playbackRate = rate;
        }
      } else {
        // 逆时针：seekTarget 倒退
        const dur = durationRef.current;
        ds.seekTarget = clamp(
          ds.seekTarget - Math.abs(deltaRad) * SEEK_PER_RAD_REVERSE,
          0,
          dur > 0 ? dur : 0
        );
      }

      // 带卷视觉立即响应（更跟手）
      if (side === "right") {
        rightAngleRef.current += degDelta;
        leftAngleRef.current -= degDelta;
      } else {
        leftAngleRef.current += degDelta;
        rightAngleRef.current -= degDelta;
      }
      applyReelTransform();
    },
    [applyReelTransform, volume, muted]
  );

  // 两个圆形拖拽实例
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
    (newTrack: Track) => {
      if (hasTapeRef.current && soundsOnRef.current) {
        tapeSounds.ensure().eject();
      }
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
      }
      setPlaying(false);
      setWinding(null);
      windingRef.current = null;
      setCurrentTime(0);
      setDuration(0);
      durationRef.current = 0;
      setError(null);
      leftAngleRef.current = 0;
      rightAngleRef.current = 0;
      setTrack(newTrack);
      hasTapeRef.current = true;
    },
    [tapeSounds]
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
        loadTrack({
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

  // ===== audio 元素事件 =====

  const onLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;
    applyTapePitch(audio);
    const d = isFinite(audio.duration) ? audio.duration : 0;
    setDuration(d);
    durationRef.current = d;
    if (soundsOnRef.current) {
      tapeSounds.ensure().load();
    }
    setTimeout(() => {
      if (audio && hasTapeRef.current) {
        audio.volume = muted ? 0 : volume;
        audio
          .play()
          .then(() => {
            setPlaying(true);
            if (soundsOnRef.current) tapeSounds.ensure().setHiss(true);
          })
          .catch(() => {});
      }
    }, 700);
  };

  const onTimeUpdate = () => {
    // 拖拽/快进时由 rAF 接管，这里只处理正常播放
    if (dragStateRef.current.active) return;
    if (windingRef.current) return;
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
  };

  const onEnded = () => {
    setPlaying(false);
    windingRef.current = null;
    setWinding(null);
    if (soundsOnRef.current) {
      const eng = tapeSounds.ensure();
      eng.setHiss(false);
      eng.brake();
    }
    setCurrentTime(0);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.playbackRate = 1;
    }
  };

  const onAudioError = () => {
    const audio = audioRef.current;
    if (track?.url?.includes("music.163.com")) {
      setError(
        "网易云音频加载失败，通常因版权保护。请尝试本地上传或使用示例曲目。"
      );
    } else if (audio?.error) {
      setError(
        `音频加载失败（错误码 ${audio.error.code}）。请检查文件或网络。`
      );
    }
    setPlaying(false);
  };

  // 音量同步
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume;
    }
  }, [volume, muted]);

  // 进度条 seek（手动拖动进度条）
  const onProgressChange = (t: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = 1;
      try {
        audio.currentTime = t;
      } catch {
        /* ignore */
      }
    }
    setCurrentTime(t);
  };

  const VolumeIcon =
    muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  // 当前速率显示文案
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
      <audio
        ref={audioRef}
        src={track?.url || undefined}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
        onError={onAudioError}
        preload="metadata"
      />

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

        {/* 进度条（自定义滑块） */}
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
          {/* 主音量 */}
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

          {/* 磁带音效音量 */}
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
