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
 * 2. outer/url 外链 fallback（服务端预先验证是否返回音频）
 * 3. 验证失败返回 ok:false（前端直接显示错误，不尝试加载）
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

    // 1. song/url/v1 返回真实 URL，直接用
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
          url: audioUrl,
          br: urlInfo?.br || 0,
        },
      });
    }

    // 2. song/url/v1 没返回，尝试 outer/url 外链
    const fallbackUrl = `https://music.163.com/song/media/outer/url?id=${song.id}.mp3`;

    // 服务端预先验证 outer/url 是否返回音频（HEAD 请求，不下载 body）
    try {
      const checkRes = await fetch(fallbackUrl, {
        method: "HEAD",
        redirect: "follow",
        headers: {
          "User-Agent": headers["User-Agent"],
          Referer: headers.Referer,
        },
      });
      const ct = checkRes.headers.get("content-type") || "";
      // 如果返回 HTML，说明是 404 页面，歌曲不可获取
      if (ct.includes("text/html")) {
        return NextResponse.json({
          ok: false,
          error: `该歌曲「${song.name}」暂无法获取音频（版权限制或已下架），请尝试本地上传或示例曲目`,
        });
      }
    } catch {
      // HEAD 失败不阻断，让前端尝试加载
    }

    // outer/url 验证通过（或 HEAD 失败），返回给前端
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
        url: fallbackUrl,
        br: 0,
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
