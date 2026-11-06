import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 网易云音频代理
 * 完整缓冲上游音频（非流式），返回 ArrayBuffer，使前端能 fetch + decodeAudioData
 * 对版权受限歌曲（返回 HTML 404）返回清晰错误
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

  const target = `https://music.163.com/song/media/outer/url?id=${id}.mp3`;

  try {
    const upstream = await fetch(target, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Referer: "https://music.163.com/",
        Cookie: "MUSIC_U=0;",
      },
      redirect: "follow",
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { ok: false, error: `上游返回 ${upstream.status}` },
        { status: 502 }
      );
    }

    const ct = upstream.headers.get("content-type") || "";
    const cl = parseInt(upstream.headers.get("content-length") || "0", 10);

    // 完整缓冲 body（非流式，避免流式传输问题）
    const buf = await upstream.arrayBuffer();

    // 版权受限：网易云返回 HTML 404 页面（content-type: text/html）
    // 或返回很小的非音频内容
    if (ct.includes("text/html") || (cl > 0 && cl < 2048)) {
      return NextResponse.json(
        {
          ok: false,
          error: "该歌曲因版权保护无法获取音频，请尝试本地上传或示例曲目",
        },
        { status: 403 }
      );
    }

    // 二次校验：MP3 帧头 / ID3 标签
    const head = new Uint8Array(buf.slice(0, 3));
    const isMP3 =
      (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) || // ID3
      (head[0] === 0xff && (head[1] & 0xe0) === 0xe0); // MP3 帧同步
    if (!isMP3) {
      return NextResponse.json(
        {
          ok: false,
          error: "该歌曲因版权保护无法获取音频，请尝试本地上传或示例曲目",
        },
        { status: 403 }
      );
    }

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "Content-Length": String(buf.byteLength),
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json(
      { ok: false, error: `音频代理失败：${message}` },
      { status: 500 }
    );
  }
}
