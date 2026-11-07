import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface CloudSearchSong {
  id: number;
  name: string;
  ar: { name: string }[];
  al: { name: string; picUrl?: string };
  dt: number;
  fee: number;
}

/**
 * 网易云搜索（使用 cloudsearch/pc 接口，与 koishi-plugin-music 一致）
 * 返回歌曲列表，fee=0 为完全免费可播放
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const keywords = searchParams.get("keywords") || "";
  const limit = Math.min(50, parseInt(searchParams.get("limit") || "20", 10));

  if (!keywords.trim()) {
    return NextResponse.json(
      { ok: false, error: "缺少 keywords 参数" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(
      `http://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(keywords)}&type=1&offset=0&limit=${limit}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Referer: "https://music.163.com/",
          Cookie: "os=pc; MUSIC_U=0;",
        },
      }
    );

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `搜索失败：HTTP ${res.status}` },
        { status: 502 }
      );
    }

    const data = (await res.json()) as {
      code: number;
      result?: { songs?: CloudSearchSong[]; songCount?: number };
    };

    if (data.code !== 200) {
      return NextResponse.json(
        { ok: false, error: `搜索失败：code ${data.code}` },
        { status: 502 }
      );
    }

    const songs = data.result?.songs || [];
    const list = songs.map((s) => ({
      id: String(s.id),
      name: s.name,
      artist: s.ar?.map((a) => a.name).join(" / ") || "未知",
      album: s.al?.name || "",
      cover: s.al?.picUrl || "",
      duration: s.dt || 0,
      fee: s.fee || 0,
    }));

    return NextResponse.json({ ok: true, data: list });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json(
      { ok: false, error: `搜索失败：${message}` },
      { status: 500 }
    );
  }
}
