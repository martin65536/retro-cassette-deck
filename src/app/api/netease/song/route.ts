import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface NetEaseSong {
  id: number;
  name: string;
  artists: { name: string }[];
  album: { name: string; picUrl?: string };
  duration: number;
}

/**
 * 解析输入：支持纯数字 ID、完整网易云链接、分享文本
 * 例如：
 *   1824020871
 *   https://music.163.com/#/song?id=1824020871
 *   https://y.music.163.com/m/song?id=1824020871
 */
export function parseNetEaseId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/[?&]id=(\d+)/) || trimmed.match(/song\/(\d+)/);
  return match ? match[1] : null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { ok: false, error: "缺少 id 参数" },
      { status: 400 }
    );
  }

  try {
    // 网易云歌曲详情接口
    const res = await fetch(
      `https://music.163.com/api/song/detail/?ids=[${id}]`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Referer: "https://music.163.com/",
          Cookie: "MUSIC_U=0;",
        },
        redirect: "follow",
      }
    );

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `网易云返回状态 ${res.status}` },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { songs?: NetEaseSong[] };
    const song = data.songs?.[0];

    if (!song) {
      return NextResponse.json(
        { ok: false, error: "未找到该歌曲，可能歌曲不存在或需要登录" },
        { status: 404 }
      );
    }

    const artist =
      song.artists?.map((a) => a.name).join(" / ") || "未知艺术家";

    return NextResponse.json({
      ok: true,
      data: {
        id: String(song.id),
        name: song.name,
        artist,
        album: song.album?.name || "",
        cover: song.album?.picUrl || "",
        duration: song.duration || 0,
        // 网易云外链播放地址（可能因版权无法播放，会返回提示音）
        url: `https://music.163.com/song/media/outer/url?id=${song.id}.mp3`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json(
      { ok: false, error: `解析失败：${message}` },
      { status: 500 }
    );
  }
}
