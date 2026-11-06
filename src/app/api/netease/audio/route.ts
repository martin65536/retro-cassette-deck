import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 音频流代理
 * 接收 ?url=<上游音频URL>，完整缓冲后返回 ArrayBuffer
 * 校验 content-type 是否为音频，拒绝 HTML 404 页面
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json(
      { ok: false, error: "缺少 url 参数" },
      { status: 400 }
    );
  }

  // 只允许 http/https
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return NextResponse.json(
      { ok: false, error: "无效的 url" },
      { status: 400 }
    );
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Referer: "https://music.163.com/",
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

    // 完整缓冲
    const buf = await upstream.arrayBuffer();

    // 拒绝 HTML（版权受限的 404 页面）
    if (ct.includes("text/html") || (cl > 0 && cl < 2048)) {
      return NextResponse.json(
        {
          ok: false,
          error: "该歌曲因版权保护无法获取音频，请尝试本地上传或示例曲目",
        },
        { status: 403 }
      );
    }

    // 二次校验：检测音频帧头（MP3/ID3/MP4/OGG/FLAC/WAV）
    // 避免伪装成音频的 HTML
    const head = new Uint8Array(buf.slice(0, 12));
    const isAudio =
      // ID3 (MP3)
      (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) ||
      // MP3 帧同步
      (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) ||
      // fLaC
      (head[0] === 0x66 &&
        head[1] === 0x4c &&
        head[2] === 0x61 &&
        head[3] === 0x43) ||
      // OGG
      (head[0] === 0x4f &&
        head[1] === 0x67 &&
        head[2] === 0x67 &&
        head[3] === 0x53) ||
      // RIFF (WAV)
      (head[0] === 0x52 &&
        head[1] === 0x49 &&
        head[2] === 0x46 &&
        head[3] === 0x46) ||
      // MP4/M4A (ftyp)
      (head[4] === 0x66 &&
        head[5] === 0x74 &&
        head[6] === 0x79 &&
        head[7] === 0x70);

    if (!isAudio) {
      return NextResponse.json(
        {
          ok: false,
          error: "该歌曲因版权保护无法获取音频，请尝试本地上传或示例曲目",
        },
        { status: 403 }
      );
    }

    // 返回音频数据
    const audioCt = ct.includes("audio") || ct.includes("octet-stream")
      ? ct
      : "audio/mpeg";
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": audioCt,
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
