"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Volume2,
  VolumeX,
  Volume1,
  Info,
  Hand,
} from "lucide-react";
import {
  CassetteTape,
  REEL_GEOM,
  type Winding,
} from "./cassette-tape";
import { TransportControls } from "./transport-controls";
import { SourceLoader, type Track } from "./source-loader";
import { useTapeSounds } from "@/hooks/use-tape-sounds";
import { useCircularDrag } from "@/hooks/use-circular-drag";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// 旋转速度（度/秒）
const PLAY_DEG_PER_SEC = 80;
const WIND_DEG_PER_SEC = 760;
// 快进/快退的 seek 倍速
const WIND_SEEK_SPEED = 8;
// 拖拽时每弧度对应的 seek 秒数
const SEEK_PER_RAD = 1.6;

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export function CassettePlayer() {
  // 播放状态
  const [track, setTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [winding, setWinding] = useState<Winding>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [soundsOn, setSoundsOn] = useState(true);

  const hasTape = track !== null;
  const progress = duration > 0 ? currentTime / duration : 0;

  // refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const leftReelElRef = useRef<SVGGElement | null>(null);
  const rightReelElRef = useRef<SVGGElement | null>(null);
  const leftAngleRef = useRef(0);
  const rightAngleRef = useRef(0);

  const playingRef = useRef(false);
  const windingRef = useRef<Winding>(null);
  const hasTapeRef = useRef(false);
  const durationRef = useRef(0);
  const manualSeekRef = useRef(false); // 拖拽/快进时禁止 timeupdate 覆盖
  const soundsOnRef = useRef(true);
  const rafRef = useRef<number | null>(null);

  // 拖拽状态
  const dragStateRef = useRef({
    active: false,
    side: "right" as "left" | "right",
    wasPlaying: false,
    seekTarget: 0,
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

  // 用 ref 引用 stopWinding，避免 rAF useEffect 依赖频繁变化
  const stopWindingRef = useRef<() => void>(() => {});

  // rAF 循环：带卷旋转 + 拖拽/快进 seek
  useEffect(() => {
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const audio = audioRef.current;

      // 拖拽模式：同步 seek 目标
      if (dragStateRef.current.active && audio && hasTapeRef.current) {
        const target = dragStateRef.current.seekTarget;
        if (Math.abs(audio.currentTime - target) > 0.05) {
          try {
            audio.currentTime = target;
          } catch {
            /* ignore */
          }
        }
      }

      // 快进/快退模式：推进 currentTime
      if (
        windingRef.current &&
        audio &&
        hasTapeRef.current &&
        !dragStateRef.current.active
      ) {
        const dir = windingRef.current === "forward" ? 1 : -1;
        const newTime = audio.currentTime + dir * WIND_SEEK_SPEED * dt;
        const dur = durationRef.current;
        const clamped = clamp(newTime, 0, dur > 0 ? dur - 0.05 : 0);
        try {
          audio.currentTime = clamped;
        } catch {
          /* ignore */
        }
        setCurrentTime(clamped);
        // 到头自动停
        if (windingRef.current === "forward" && clamped >= dur - 0.1 && dur > 0) {
          stopWindingRef.current();
        } else if (windingRef.current === "rewind" && clamped <= 0.05) {
          stopWindingRef.current();
        }
      }

      // 带卷旋转（非拖拽时）
      if (!dragStateRef.current.active && hasTapeRef.current) {
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

      rafRef.current = requestAnimationFrame(loop);
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
    audio.playbackRate = 1;
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
  }, [tapeSounds]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
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
      // 快进/快退时暂停播放（但保留 playing 状态以便恢复？磁带机通常停止播放）
      audio.pause();
      setPlaying(false);
      setWinding(dir);
      windingRef.current = dir;
      manualSeekRef.current = true;
      if (soundsOnRef.current) {
        const eng = tapeSounds.ensure();
        eng.click(0.9);
        eng.setHiss(false);
        eng.setWind(0.85, dir === "forward");
      }
    },
    [tapeSounds]
  );

  const stopWinding = useCallback(() => {
    if (!windingRef.current) return;
    setWinding(null);
    windingRef.current = null;
    manualSeekRef.current = false;
    if (soundsOnRef.current) {
      const eng = tapeSounds.ensure();
      eng.setWind(0, true);
      eng.brake();
    }
  }, [tapeSounds]);

  // 同步 stopWindingRef
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
      dragStateRef.current.active = true;
      dragStateRef.current.side = side;
      dragStateRef.current.wasPlaying = playingRef.current;
      dragStateRef.current.seekTarget = audio.currentTime;
      manualSeekRef.current = true;
      // 暂停播放（物理暂停，保留状态）
      audio.pause();
      setPlaying(false);
      if (soundsOnRef.current) {
        const eng = tapeSounds.ensure();
        eng.setHiss(false);
        eng.setWind(0.55, side === "right");
      }
    },
    [tapeSounds]
  );

  const handleDragEnd = useCallback(() => {
    if (!dragStateRef.current.active) return;
    const wasPlaying = dragStateRef.current.wasPlaying;
    dragStateRef.current.active = false;
    manualSeekRef.current = false;
    if (soundsOnRef.current) {
      const eng = tapeSounds.ensure();
      eng.setWind(0, true);
      eng.brake();
    }
    // 恢复播放
    if (wasPlaying) {
      const audio = audioRef.current;
      if (audio) {
        audio
          .play()
          .then(() => {
            setPlaying(true);
            if (soundsOnRef.current) tapeSounds.ensure().setHiss(true);
          })
          .catch(() => {
            /* ignore */
          });
      }
    }
  }, [tapeSounds]);

  const handleRotate = useCallback(
    (deltaRad: number, side: "left" | "right") => {
      if (!dragStateRef.current.active || !hasTapeRef.current) return;
      const degDelta = deltaRad * (180 / Math.PI);
      const dur = durationRef.current;
      const maxSeek = dur > 0 ? dur : 0;
      if (side === "right") {
        // 右卷顺时针 = 快进
        rightAngleRef.current += degDelta;
        leftAngleRef.current -= degDelta;
        dragStateRef.current.seekTarget = clamp(
          dragStateRef.current.seekTarget + deltaRad * SEEK_PER_RAD,
          0,
          maxSeek
        );
      } else {
        // 左卷顺时针 = 倒带
        leftAngleRef.current += degDelta;
        rightAngleRef.current -= degDelta;
        dragStateRef.current.seekTarget = clamp(
          dragStateRef.current.seekTarget - deltaRad * SEEK_PER_RAD,
          0,
          maxSeek
        );
      }
      applyReelTransform();
      setCurrentTime(dragStateRef.current.seekTarget);
    },
    [applyReelTransform]
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
      // 解锁音频上下文
      ensureSounds();
      if (side === "left") leftDrag.handlers.onPointerDown(e);
      else rightDrag.handlers.onPointerDown(e);
    },
    [leftDrag, rightDrag, ensureSounds]
  );

  // ===== 音频源加载 =====

  const loadTrack = useCallback(
    (newTrack: Track) => {
      // 弹出旧磁带
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
      // 等待 onLoadedMetadata 播放装载声
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
    const d = isFinite(audio.duration) ? audio.duration : 0;
    setDuration(d);
    durationRef.current = d;
    // 装载声
    if (soundsOnRef.current) {
      const eng = tapeSounds.ensure();
      eng.load();
    }
    // 延迟自动播放
    setTimeout(() => {
      if (audio && hasTapeRef.current) {
        audio.volume = muted ? 0 : volume;
        audio
          .play()
          .then(() => {
            setPlaying(true);
            if (soundsOnRef.current) {
              const eng = tapeSounds.ensure();
              eng.setHiss(true);
            }
          })
          .catch(() => {
            // 自动播放被阻止，用户需手动点 PLAY
          });
      }
    }, 700);
  };

  const onTimeUpdate = () => {
    if (manualSeekRef.current) return;
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
    if (audioRef.current) audioRef.current.currentTime = 0;
  };

  const onAudioError = () => {
    const audio = audioRef.current;
    // 网易云音频可能因版权无法播放
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

  // 进度条 seek
  const onProgressChange = (values: number[]) => {
    const t = values[0];
    const audio = audioRef.current;
    if (audio) {
      try {
        audio.currentTime = t;
      } catch {
        /* ignore */
      }
    }
    setCurrentTime(t);
  };

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* 隐藏的 audio 元素 */}
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

      {/* 拖拽提示 */}
      {hasTape ? (
        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-stone-500 dark:text-stone-400">
          <Hand className="w-3.5 h-3.5" />
          <span>
            在带卷上按住并{" "}
            <span className="font-semibold text-orange-700 dark:text-orange-400">
              转圈滑动
            </span>
            即可手动快进 / 快退（右卷顺时针＝快进，左卷顺时针＝倒带）
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

        {/* 进度条 */}
        <div className="mt-4 px-1">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono tabular-nums text-stone-600 dark:text-stone-300 w-10 text-right">
              {formatTime(currentTime)}
            </span>
            <Slider
              value={[currentTime]}
              max={duration > 0 ? duration : 1}
              step={0.1}
              onValueChange={onProgressChange}
              disabled={!hasTape}
              className="flex-1 data-[disabled]:opacity-50"
            />
            <span className="text-xs font-mono tabular-nums text-stone-500 dark:text-stone-400 w-10">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* 音量 + 音效开关 */}
        <div className="mt-3 flex items-center gap-3 px-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-stone-600 dark:text-stone-300"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? "取消静音" : "静音"}
          >
            <VolumeIcon className="w-4 h-4" />
          </Button>
          <Slider
            value={[muted ? 0 : volume]}
            max={1}
            step={0.01}
            onValueChange={(v) => {
              setVolume(v[0]);
              if (v[0] > 0) setMuted(false);
            }}
            className="flex-1 max-w-[160px]"
          />
          <div className="flex-1" />
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={soundsOn ? "secondary" : "outline"}
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => setSoundsOn((s) => !s)}
                >
                  <Info className="w-3.5 h-3.5" />
                  {soundsOn ? "音效：开" : "音效：关"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>磁带机械音效（摩擦声、卷带声、按键声）</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
