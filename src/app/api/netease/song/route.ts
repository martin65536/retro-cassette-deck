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
 * 校验 outer/url 外链是否真的指向音频（而非被 302 到 /404 HTML 页）。
 * 与 koishi-plugin-music / go-cqhttp 一致：它们直接用 outer/url 作为播放地址，
 * 但对于版权受限歌曲该地址会 302 跳到 music.163.com/404。这里在服务端提前探测，
 * 用 manual redirect + 检查最终 URL / content-type，避免把 HTML 404 页喂给前端 decodeAudioData。
 */
async function isOuterUrlPlayable(songId: string): Promise<boolean> {
  const outerUrl = `https://music.163.com/song/media/outer/url?id=${songId}.mp3`;
  try {
    const res = await fetch(outerUrl, {
      headers: {
        "User-Agent": NETEASE_HEADERS["User-Agent"],
        Referer: NETEASE_HEADERS.Referer,
      },
      redirect: "manual",
    });
    // outer/url 正常情况下返回 302，Location 指向 *.music.126.net 的真实 mp3
    if (res.status === 302 || res.status === 301) {
      const loc = res.headers.get("location") || "";
      // 受限歌曲会 302 到 music.163.com/404
      if (/music\.163\.com\/404/i.test(loc)) return false;
      // 真实音频 CDN 域名
      if (/music\.126\.net/i.test(loc)) return true;
    }
    // 某些情况会直接 200 返回音频
    if (res.ok) {
      const ct = res.headers.get("content-type") || "";
      if (ct.startsWith("audio/") || ct === "application/octet-stream") {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 网易云歌曲解析（直接调网易云 API，MetingAPI 风格路由）
 * 1. song/url/v1 获取真实 URL（带 code 判断，code !== 200 视为不可获取）
 * 2. outer/url 外链 fallback（先校验是否真的可播，不可播则返回明确错误）
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
        freeTrialInfo?: unknown;
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
    const audioUrl = urlInfo?.url;
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

    // 主接口返回真实可用的 CDN 地址
    if (audioUrl && urlInfo.code === 200) {
      return NextResponse.json({
        ok: true,
        data: {
          ...baseData,
          audioProxyUrl: `/api/netease/audio?url=${encodeURIComponent(audioUrl)}`,
        },
      });
    }

    // 主接口拿不到 URL（受限/无版权），校验 outer/url 外链是否可用
    const playable = await isOuterUrlPlayable(String(song.id));
    if (!playable) {
      return NextResponse.json({
        ok: false,
        error: "该歌曲暂时无法播放（版权受限或未上架），请尝试其它歌曲或使用本地上传",
      });
    }

    const fallbackUrl = `https://music.163.com/song/media/outer/url?id=${song.id}.mp3`;
    return NextResponse.json({
      ok: true,
      data: {
        ...baseData,
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
