import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface SearchSong {
  id: number;
  name: string;
  artists: { name: string }[];
  album: { name: string; picUrl?: string };
  duration: number;
  fee: number;
}

/**
 * 网易云搜索（直接调网易云 API）
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
    const params = new URLSearchParams({
      s: keywords,
      type: "1",
      limit: String(limit),
      offset: "0",
    });

    const res = await fetch(
      `https://music.163.com/api/search/get?${params.toString()}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Referer: "https://music.163.com/",
          "Cookie": "os=pc; MUSIC_U=0;",
          Accept: "application/json",
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
      result?: { songs?: SearchSong[] };
      code?: number;
    };

    const songs = data.result?.songs || [];
    const list = songs.map((s) => ({
      id: String(s.id),
      name: s.name,
      artist: s.artists?.map((a) => a.name).join(" / ") || "未知",
      album: s.album?.name || "",
      cover: s.album?.picUrl || "",
      duration: s.duration || 0,
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
