"use client";

import React from "react";
import { Upload, Music2, Loader2, Link2, Play, AlertCircle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface Track {
  url: string;
  name: string;
  artist: string;
  album?: string;
  cover?: string;
}

interface SourceLoaderProps {
  onLoad: (track: Track, source: "upload" | "sample") => void;
  onNetEase: (input: string) => void;
  onNetEaseSearch: (songId: string) => void;
  loading: boolean;
  error: string | null;
}

// 示例曲目（本地托管，支持 Web Audio 连续变调）
const SAMPLES: Track[] = [
  {
    url: "/samples/song-1.mp3",
    name: "Midnight Drive",
    artist: "SoundHelix",
    album: "Open Road EP",
  },
  {
    url: "/samples/song-3.mp3",
    name: "Velvet Tape Hiss",
    artist: "SoundHelix",
    album: "Analog Memories",
  },
  {
    url: "/samples/song-8.mp3",
    name: "Reel To Reel",
    artist: "SoundHelix",
    album: "Magnetic Field",
  },
];

interface SourceLoaderState {
  neteaseInput: string;
  dragOver: boolean;
  searchQuery: string;
  searchResults: Array<{
    id: string;
    name: string;
    artist: string;
    album: string;
    fee: number;
  }>;
  searching: boolean;
}

export class SourceLoader extends React.Component<
  SourceLoaderProps,
  SourceLoaderState
> {
  private fileInputEl: HTMLInputElement | null = null;

  constructor(props: SourceLoaderProps) {
    super(props);
    this.state = {
      neteaseInput: "",
      dragOver: false,
      searchQuery: "",
      searchResults: [],
      searching: false,
    };
  }

  private handleFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("audio/")) return;
    const url = URL.createObjectURL(file);
    this.props.onLoad(
      {
        url,
        name: file.name.replace(/\.[^.]+$/, ""),
        artist: "Local File",
        album: file.type,
      },
      "upload"
    );
  };

  private handleNetEase = () => {
    const v = this.state.neteaseInput.trim();
    if (!v) return;
    this.props.onNetEase(v);
  };

  private handleSearch = async () => {
    const q = this.state.searchQuery.trim();
    if (!q) return;
    this.setState({ searching: true, searchResults: [] });
    try {
      const res = await fetch(
        `/api/netease/search?keywords=${encodeURIComponent(q)}&limit=20`
      );
      const data = await res.json();
      if (data.ok) {
        this.setState({ searchResults: data.data || [] });
      } else {
        this.setState({ searchResults: [] });
      }
    } catch {
      this.setState({ searchResults: [] });
    } finally {
      this.setState({ searching: false });
    }
  };

  private handleSelectSearchResult = (songId: string) => {
    this.props.onNetEaseSearch(songId);
  };

  render() {
    const { loading, error } = this.props;
    const { neteaseInput, dragOver, searchQuery, searchResults, searching } = this.state;

    return (
      <div className="w-full">
        <Tabs defaultValue="upload" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="upload" className="text-xs sm:text-sm">
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              上传
            </TabsTrigger>
            <TabsTrigger value="netease" className="text-xs sm:text-sm">
              <Music2 className="w-3.5 h-3.5 mr-1.5" />
              网易云
            </TabsTrigger>
            <TabsTrigger value="sample" className="text-xs sm:text-sm">
              <Play className="w-3.5 h-3.5 mr-1.5" />
              示例
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="mt-3">
            <div
              onClick={() => this.fileInputEl?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                this.setState({ dragOver: true });
              }}
              onDragLeave={() => this.setState({ dragOver: false })}
              onDrop={(e) => {
                e.preventDefault();
                this.setState({ dragOver: false });
                this.handleFile(e.dataTransfer.files?.[0]);
              }}
              className={cn(
                "flex flex-col items-center justify-center gap-2",
                "p-6 cursor-pointer transition-colors",
                dragOver
                  ? "bg-stone-800"
                  : "bg-stone-900 hover:bg-stone-800"
              )}
              style={{ border: "1px dashed #555" }}
            >
              <Upload className="w-7 h-7 text-stone-400" />
              <p className="text-sm font-medium text-stone-200">
                点击或拖拽音频文件到此
              </p>
              <p className="text-xs text-stone-500">
                支持 MP3 / WAV / OGG / FLAC / M4A
              </p>
            </div>
            <input
              ref={(el) => {
                this.fileInputEl = el;
              }}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => this.handleFile(e.target.files?.[0])}
            />
          </TabsContent>

          <TabsContent value="netease" className="mt-3">
            <div className="space-y-3">
              {/* 搜索区 */}
              <div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                    <Input
                      value={searchQuery}
                      onChange={(e) =>
                        this.setState({ searchQuery: e.target.value })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") this.handleSearch();
                      }}
                      placeholder="搜索歌曲 / 歌手"
                      className="pl-9"
                    />
                  </div>
                  <Button
                    onClick={this.handleSearch}
                    disabled={searching || !searchQuery.trim()}
                    variant="secondary"
                  >
                    {searching ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "搜索"
                    )}
                  </Button>
                </div>
              </div>

              {/* 搜索结果 */}
              {searchResults.length > 0 ? (
                <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto pr-1">
                  {searchResults.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => this.handleSelectSearchResult(s.id)}
                      disabled={loading}
                      className={cn(
                        "flex items-center gap-3 text-left p-2.5 transition-colors group disabled:opacity-50",
                        "bg-stone-900 hover:bg-stone-800"
                      )}
                      style={{ border: "1px solid #3a3a3a" }}
                    >
                      <div className="w-8 h-8 bg-stone-700 flex items-center justify-center flex-shrink-0" style={{ border: '1px solid #555' }}>
                        <Music2 className="w-3.5 h-3.5 text-amber-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-stone-200 truncate">
                          {s.name}
                          {s.fee === 0 ? (
                            <span className="ml-1.5 text-[9px] text-green-500 align-middle">免费</span>
                          ) : s.fee === 1 ? (
                            <span className="ml-1.5 text-[9px] text-amber-500 align-middle">VIP</span>
                          ) : (
                            <span className="ml-1.5 text-[9px] text-stone-500 align-middle">试听</span>
                          )}
                        </p>
                        <p className="text-[11px] text-stone-500 truncate">
                          {s.artist} · {s.album}
                        </p>
                      </div>
                      <Play className="w-3.5 h-3.5 text-stone-500 group-hover:text-amber-400 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              ) : searching ? (
                <div className="text-center py-4 text-xs text-stone-500">
                  搜索中…
                </div>
              ) : null}

              {/* ID 直接解析 */}
              <div className="pt-2 border-t border-stone-700/40">
                <p className="text-[10px] text-stone-500 mb-1.5">或直接输入歌曲 ID / 分享链接</p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                    <Input
                      value={neteaseInput}
                      onChange={(e) =>
                        this.setState({ neteaseInput: e.target.value })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") this.handleNetEase();
                      }}
                      placeholder="歌曲ID 或 分享链接"
                      className="pl-9"
                    />
                  </div>
                  <Button
                    onClick={this.handleNetEase}
                    disabled={loading || !neteaseInput.trim()}
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "解析"
                    )}
                  </Button>
                </div>
                <p className="text-[11px] text-stone-500 leading-relaxed mt-1.5">
                  输入网易云歌曲 ID 或分享链接。
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="sample" className="mt-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
              {SAMPLES.map((s) => (
                <button
                  key={s.url}
                  type="button"
                  onClick={() => this.props.onLoad(s, "sample")}
                  className={cn(
                    "flex items-center gap-3 text-left p-3 transition-colors group",
                    "bg-stone-900 hover:bg-stone-800"
                  )}
                  style={{ border: '1px solid #3a3a3a' }}
                >
                  <div className="w-9 h-9 bg-stone-700 flex items-center justify-center flex-shrink-0" style={{ border: '1px solid #555' }}>
                    <Music2 className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-stone-200 truncate">
                      {s.name}
                    </p>
                    <p className="text-[11px] text-stone-500 truncate">
                      {s.artist} · {s.album}
                    </p>
                  </div>
                  <Play className="w-4 h-4 text-stone-500 group-hover:text-amber-400 flex-shrink-0" />
                </button>
              ))}
            </div>
            <p className="text-[11px] text-stone-500 mt-2">
              示例曲目来自 SoundHelix，用于快速体验功能。
            </p>
          </TabsContent>
        </Tabs>

        {error ? (
          <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
          </div>
        ) : null}
      </div>
    );
  }
}
