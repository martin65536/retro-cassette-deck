import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface NetEaseSong {
  id: number;
  name: string;
  artists: { name: string }[];
  album: { name: string; picUrl?: string };
  duration: number;
}

const NETEASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Referer: "https://music.163.com/",
  Cookie: "os=pc; MUSIC_U=0;",
};

/**
 * 通过第三方网易云解析代理（v.iarc.top）获取真实音频 CDN 地址。
 *
 * 这与 koishi-plugin-nazrin-music-netease 的实现一致：
 *   getSongResource(id) → https://v.iarc.top/?type=song&id=X → { url }
 *   getRedirectUrl(url) → 跟随 302 拿到 *.music.126.net 真实 mp3
 *
 * 该代理背后是带登录态的 NeteaseCloudMusicApi 部署，能拿到 song/url/v1
 * 匿名访问返回 null 的版权受限歌曲（如 1968334383）。
 *
 * 这里直接用 type=url 端点，它 302 跳到真实 CDN，手动跟随拿到最终 mp3 地址。
 */
async function resolveViaIarc(songId: string): Promise<string | null> {
  const endpoint = `https://v.iarc.top/?server=netease&type=url&id=${songId}`;
  try {
    const res = await fetch(endpoint, {
      headers: { "Content-Type": "application/json" },
      redirect: "manual",
    });
    // 正常情况：302 → Location 指向 *.music.126.net 真实 mp3
    if (res.status === 302 || res.status === 301) {
      const loc = res.headers.get("location") || "";
      if (/music\.126\.net/i.test(loc)) return loc;
    }
    // 兜底：手动跟随失败时用 follow 重试一次
    if (res.ok) {
      const ct = res.headers.get("content-type") || "";
      if (ct.startsWith("audio/")) return endpoint;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 网易云歌曲解析
 *
 * 获取顺序（与 koishi 插件一致，优先直连、受限时走代理）：
 * 1. song/url/v1 直连网易云 —— 普通/免费歌曲直接拿到 CDN 地址
 * 2. v.iarc.top 代理 fallback —— 版权受限歌曲（song/url/v1 返回 null）走此路
 *    （koishi-plugin-nazrin-music-netease 即用此代理）
 * 3. outer/url 最后兜底 —— 校验是否真的指向音频，不可播才报错
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

  try {
    const [detailRes, urlRes] = await Promise.all([
      fetch(`https://music.163.com/api/song/detail/?ids=[${id}]`, {
        headers: NETEASE_HEADERS,
      }),
      fetch(
        `https://music.163.com/api/song/enhance/player/url/v1?ids=[${id}]&level=standard&encodeType=mp3`,
        {
          method: "POST",
          headers: {
            ...NETEASE_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      ),
    ]);

    const detailData = (await detailRes.json()) as { songs?: NetEaseSong[] };
    const urlData = (await urlRes.json()) as {
      data?: {
        url: string | null;
        br: number;
        code: number;
        type: string;
      }[];
    };

    const song = detailData.songs?.[0];
    if (!song) {
      return NextResponse.json(
        { ok: false, error: "未找到该歌曲" },
        { status: 404 }
      );
    }

    const urlInfo = urlData.data?.[0];
    const directUrl = urlInfo?.url;
    const artist =
      song.artists?.map((a) => a.name).join(" / ") || "未知艺术家";

    const baseData = {
      id: String(song.id),
      name: song.name,
      artist,
      album: song.album?.name || "",
      cover: song.album?.picUrl || "",
      duration: song.duration || 0,
    };

    // 1. 直连网易云：普通歌曲直接拿到 CDN 地址
    if (directUrl && urlInfo.code === 200) {
      return NextResponse.json({
        ok: true,
        data: {
          ...baseData,
          audioProxyUrl: `/api/netease/audio?url=${encodeURIComponent(directUrl)}`,
        },
      });
    }

    // 2. v.iarc.top 代理 fallback（koishi-plugin-nazrin-music-netease 方案）
    //    能拿到 song/url/v1 返回 null 的版权受限歌曲
    const proxiedUrl = await resolveViaIarc(String(song.id));
    if (proxiedUrl) {
      return NextResponse.json({
        ok: true,
        data: {
          ...baseData,
          audioProxyUrl: `/api/netease/audio?url=${encodeURIComponent(proxiedUrl)}`,
          maybeRestricted: true,
        },
      });
    }

    // 3. outer/url 最后兜底：校验是否真的指向音频 CDN
    const outerUrl = `https://music.163.com/song/media/outer/url?id=${song.id}.mp3`;
    try {
      const outerRes = await fetch(outerUrl, {
        headers: {
          "User-Agent": NETEASE_HEADERS["User-Agent"],
          Referer: NETEASE_HEADERS.Referer,
        },
        redirect: "manual",
      });
      if (
        (outerRes.status === 302 || outerRes.status === 301) &&
        /music\.126\.net/i.test(outerRes.headers.get("location") || "")
      ) {
        return NextResponse.json({
          ok: true,
          data: {
            ...baseData,
            audioProxyUrl: `/api/netease/audio?url=${encodeURIComponent(outerUrl)}`,
            maybeRestricted: true,
          },
        });
      }
    } catch {
      /* 忽略，继续报错 */
    }

    // 所有途径都拿不到可播音频
    return NextResponse.json({
      ok: false,
      error: "该歌曲暂时无法播放（版权受限或未上架），请尝试其它歌曲或使用本地上传",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json(
      { ok: false, error: `解析失败：${message}` },
      { status: 500 }
    );
  }
}
