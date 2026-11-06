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
 * 解析网易云歌曲：获取详情 + 真实音频 CDN URL
 * 1. song/url/v1 获取真实 URL（优先）
 * 2. outer/url 外链 fallback
 * 不做 HEAD 预验证（HEAD 和 GET 行为可能不一致，会误判）
 * 前端 load 失败会显示错误
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { ok: false, error: "缺少 id 参数" },
      { status: 400 }
    );
  }

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    Referer: "https://music.163.com/",
    Cookie: "os=pc; MUSIC_U=0;",
  };

  try {
    const [detailRes, urlRes] = await Promise.all([
      fetch(`https://music.163.com/api/song/detail/?ids=[${id}]`, { headers }),
      fetch(
        `https://music.163.com/api/song/enhance/player/url/v1?ids=[${id}]&level=standard&encodeType=mp3`,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      ),
    ]);

    const detailData = (await detailRes.json()) as { songs?: NetEaseSong[] };
    const urlData = (await urlRes.json()) as {
      data?: { url: string | null; br: number; code: number; type: string }[];
    };

    const song = detailData.songs?.[0];
    if (!song) {
      return NextResponse.json(
        { ok: false, error: "未找到该歌曲" },
        { status: 404 }
      );
    }

    const urlInfo = urlData.data?.[0];
    const audioUrl = urlInfo?.url;
    const artist =
      song.artists?.map((a) => a.name).join(" / ") || "未知艺术家";

    // song/url/v1 返回真实 URL
    if (audioUrl) {
      return NextResponse.json({
        ok: true,
        data: {
          id: String(song.id),
          name: song.name,
          artist,
          album: song.album?.name || "",
          cover: song.album?.picUrl || "",
          duration: song.duration || 0,
          audioProxyUrl: `/api/netease/audio?url=${encodeURIComponent(audioUrl)}`,
        },
      });
    }

    // 回退到 outer/url（不做 HEAD 预验证，让前端尝试）
    const fallbackUrl = `https://music.163.com/song/media/outer/url?id=${song.id}.mp3`;
    return NextResponse.json({
      ok: true,
      data: {
        id: String(song.id),
        name: song.name,
        artist,
        album: song.album?.name || "",
        cover: song.album?.picUrl || "",
        duration: song.duration || 0,
        audioProxyUrl: `/api/netease/audio?url=${encodeURIComponent(fallbackUrl)}`,
        maybeRestricted: true,
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
