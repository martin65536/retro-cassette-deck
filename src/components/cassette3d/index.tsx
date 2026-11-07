"use client";

import dynamic from "next/dynamic";
import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, Search, Loader2, Music2, AlertCircle, X } from "lucide-react";
import { TapeAudioEngine } from "@/lib/audio-engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Three.js 必须客户端渲染，禁 SSR
const CassetteDeck3DCanvas = dynamic(
  () => import("./cassette-deck-3d").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-[#1c1c22]">
        <div className="text-stone-500 text-xs font-mono tracking-widest animate-pulse">
          LOADING 3D SCENE…
        </div>
      </div>
    ),
  }
);

interface Track {
  url: string;
  name: string;
  artist: string;
}

interface CassetteDeck3DProps {
  /** 不传 onBack 时显示返回首页链接 */
  onBack?: () => void;
}

type Direction = "forward" | "rewind" | "stop";

/**
 * 3D 磁带机全屏页面（带真实播放功能）
 * - 复用 TapeAudioEngine（AudioWorklet 采样模式，支持 FF/REW 变调）
 * - 网易云搜索/ID 解析加载歌曲
 * - 3D 按钮控制播放/停止/快进/快退/弹出
 */
export function CassetteDeck3D({ onBack }: CassetteDeck3DProps) {
  // 音频引擎
  const audioEngineRef = useRef<TapeAudioEngine | null>(null);
  useEffect(() => {
    audioEngineRef.current = new TapeAudioEngine({
      onEnded: () => {
        setPlaying(false);
        setDirection("stop");
      },
      onError: (msg) => setError(msg),
    });
    return () => {
      audioEngineRef.current?.dispose();
      audioEngineRef.current = null;
    };
  }, []);

  // 播放状态
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [direction, setDirection] = useState<Direction>("stop");
  const [lidOpen, setLidOpen] = useState(false);
  const [track, setTrack] = useState<Track | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 歌曲加载 UI 状态
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    Array<{ id: string; name: string; artist: string; album: string; fee: number }>
  >([]);
  const [searching, setSearching] = useState(false);
  const [loadingSong, setLoadingSong] = useState(false);
  const [showLoader, setShowLoader] = useState(true);

  // 搜索
  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const res = await fetch(
        `/api/netease/search?keywords=${encodeURIComponent(q)}&limit=20`
      );
      const data = await res.json();
      if (data.ok) setSearchResults(data.data || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  // 解析歌曲 ID
  const handleLoadSong = useCallback(async (songId: string) => {
    setError(null);
    setLoadingSong(true);
    try {
      const res = await fetch(`/api/netease/song?id=${songId}`);
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "解析失败");
        return;
      }
      const song = data.data;
      // 先停止当前播放
      const eng = audioEngineRef.current;
      if (eng) {
        eng.pause();
        eng.setRate(1);
        eng.setReverse(false);
      }
      setPlaying(false);
      setDirection("stop");
      setLoaded(false);
      setLidOpen(true); // 开盖准备装入
      setTrack({
        url: song.audioProxyUrl,
        name: song.name,
        artist: song.artist,
      });
      setShowLoader(false);
    } catch (e) {
      setError(`解析失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setLoadingSong(false);
    }
  }, []);

  const handleEnded = useCallback(() => {
    setPlaying(false);
    setDirection("stop");
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-[#1c1c22]" style={{ touchAction: "none" }}>
      {/* 3D 画布 */}
      <CassetteDeck3DCanvas
        audioEngine={audioEngineRef}
        trackUrl={track?.url ?? null}
        songName={track ? `${track.name}` : "NO TAPE"}
        loaded={loaded}
        setLoaded={setLoaded}
        playing={playing}
        setPlaying={setPlaying}
        direction={direction}
        setDirection={setDirection}
        lidOpen={lidOpen}
        setLidOpen={setLidOpen}
        onEnded={handleEnded}
      />

      {/* 顶部 HUD */}
      <div className="absolute top-0 left-0 right-0 p-4 sm:p-5 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-3">
          {onBack ? (
            <button
              onClick={onBack}
              className="pointer-events-auto flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-stone-200 text-xs hover:bg-black/70 transition-colors"
              aria-label="返回"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">返回</span>
            </button>
          ) : (
            <Link
              href="/"
              className="pointer-events-auto flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-stone-200 text-xs hover:bg-black/70 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">首页</span>
            </Link>
          )}
          <div className="px-3 py-2 rounded-full bg-black/50 backdrop-blur-md border border-white/10">
            <p className="text-[10px] tracking-[0.25em] font-mono text-amber-400/80">
              3D · CASSETTE DECK
            </p>
          </div>
        </div>

        <div className="pointer-events-auto">
          <p className="hidden sm:block text-[11px] font-mono text-stone-400 px-3 py-2 rounded-full bg-black/40 backdrop-blur-md border border-white/5">
            双指缩放 · 拖动卡带 · 点按按钮
          </p>
        </div>
      </div>

      {/* 当前曲目信息（左下） */}
      {track && (
        <div className="absolute bottom-4 left-4 pointer-events-none max-w-[60vw]">
          <div className="px-3.5 py-2.5 rounded-xl bg-black/55 backdrop-blur-md border border-white/10">
            <p className="text-[10px] font-mono text-amber-400/70 tracking-wider mb-0.5">
              NOW PLAYING
            </p>
            <p className="text-sm text-stone-100 font-medium truncate">{track.name}</p>
            <p className="text-[11px] text-stone-400 truncate">{track.artist}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <span
                className={cn(
                  "text-[9px] font-mono px-1.5 py-0.5 rounded",
                  playing
                    ? "bg-green-500/20 text-green-400"
                    : "bg-stone-700/40 text-stone-400"
                )}
              >
                {playing ? "● PLAYING" : "■ STOPPED"}
              </span>
              {direction !== "stop" && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
                  {direction === "forward" ? "▶▶ FF" : "◀◀ REW"}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 装带按钮（右下，当无曲目或显示装载器时） */}
      <div className="absolute bottom-4 right-4 pointer-events-auto">
        <Button
          onClick={() => setShowLoader((v) => !v)}
          size="sm"
          variant="secondary"
          className="rounded-full bg-black/55 backdrop-blur-md border border-white/10 text-stone-200 hover:bg-black/70"
        >
          <Music2 className="w-3.5 h-3.5 mr-1.5" />
          {track ? "换一首" : "装带"}
        </Button>
      </div>

      {/* 歌曲装载器面板 */}
      {showLoader && (
        <div className="absolute bottom-16 right-4 pointer-events-auto w-[90vw] max-w-sm">
          <div className="rounded-2xl bg-black/65 backdrop-blur-md border border-white/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-stone-200">装入磁带</p>
              <button
                onClick={() => setShowLoader(false)}
                className="text-stone-500 hover:text-stone-300 transition-colors"
                aria-label="关闭"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 搜索框 */}
            <div className="flex gap-2 mb-3">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearch();
                  }}
                  placeholder="搜索歌曲 / 歌手"
                  className="pl-8 h-8 text-xs bg-stone-900/60 border-stone-700"
                />
              </div>
              <Button
                onClick={handleSearch}
                disabled={searching || !searchQuery.trim()}
                size="sm"
                variant="secondary"
                className="h-8 px-3"
              >
                {searching ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  "搜索"
                )}
              </Button>
            </div>

            {/* 搜索结果 */}
            {searchResults.length > 0 && (
              <div className="max-h-48 overflow-y-auto pr-1 space-y-1 mb-2">
                {searchResults.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleLoadSong(s.id)}
                    disabled={loadingSong}
                    className="w-full flex items-center gap-2 text-left p-2 rounded-lg bg-stone-900/40 hover:bg-stone-800/60 transition-colors disabled:opacity-50"
                  >
                    <div className="w-6 h-6 bg-stone-700 rounded flex items-center justify-center flex-shrink-0">
                      <Music2 className="w-3 h-3 text-amber-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-stone-200 truncate">
                        {s.name}
                        {s.fee === 0 ? (
                          <span className="ml-1 text-[9px] text-green-500">免费</span>
                        ) : s.fee === 1 ? (
                          <span className="ml-1 text-[9px] text-amber-500">VIP</span>
                        ) : null}
                      </p>
                      <p className="text-[10px] text-stone-500 truncate">{s.artist}</p>
                    </div>
                    {loadingSong && <Loader2 className="w-3 h-3 animate-spin text-stone-500" />}
                  </button>
                ))}
              </div>
            )}

            {/* ID 直接解析 */}
            <div className="pt-2 border-t border-stone-700/40">
              <p className="text-[10px] text-stone-500 mb-1.5">或输入歌曲 ID</p>
              <SongIdInput onResolve={handleLoadSong} loading={loadingSong} />
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="mt-2 flex items-start gap-1.5 p-2 rounded-lg bg-red-950/40 border border-red-900/50">
                <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-red-300">{error}</p>
              </div>
            )}

            <p className="mt-2 text-[10px] text-stone-500 leading-relaxed">
              装入后用 3D 按钮控制：▶ 播放 / ■ 停止 / ◀◀▶▶ 快退快进 / ⏏ 弹出
            </p>
          </div>
        </div>
      )}

      {/* 底部水印 */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none">
        <p className="text-[9px] font-mono text-stone-600 tracking-wider">
          THREE.js · R3F · Web Audio
        </p>
      </div>
    </div>
  );
}

/* 歌曲 ID 输入子组件 */
function SongIdInput({
  onResolve,
  loading,
}: {
  onResolve: (id: string) => void;
  loading: boolean;
}) {
  const [id, setId] = useState("");
  return (
    <div className="flex gap-2">
      <Input
        value={id}
        onChange={(e) => setId(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && id.trim()) onResolve(id.trim());
        }}
        placeholder="如 1968334383"
        className="h-8 text-xs bg-stone-900/60 border-stone-700"
      />
      <Button
        onClick={() => id.trim() && onResolve(id.trim())}
        disabled={loading || !id.trim()}
        size="sm"
        className="h-8 px-3"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "装入"}
      </Button>
    </div>
  );
}

export default CassetteDeck3D;
