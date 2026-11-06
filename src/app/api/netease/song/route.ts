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
 * 用 song/url/v1 接口（比 outer/url 外链更可靠）
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
    // 并行获取详情和音频 URL
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

    // 如果 song/url/v1 返回了真实 URL，用它
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
          // 前端通过 audio 代理获取（同源）
          audioProxyUrl: `/api/netease/audio?url=${encodeURIComponent(audioUrl)}`,
          url: audioUrl, // 也返回原始 URL 供参考
          br: urlInfo?.br || 0,
        },
      });
    }

    // song/url/v1 没返回 URL，尝试外链 outer/url 作为 fallback
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
        // 外链可能因版权返回 404，代理会校验
        audioProxyUrl: `/api/netease/audio?url=${encodeURIComponent(fallbackUrl)}`,
        url: fallbackUrl,
        br: 0,
        // 标记：可能无法播放
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
