import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 网易云音频流代理
 * 后端拉取网易云音频并流式转发给前端，使前端能以同源方式 fetch + decodeAudioData
 * （AudioBufferSourceNode 需要 ArrayBuffer，无法直接消费跨域流）
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
      },
      redirect: "follow",
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { ok: false, error: `上游返回 ${upstream.status}` },
        { status: 502 }
      );
    }

    // 网易云版权受限时会返回很短的提示音频或 403 页面
    // 检查 content-type，非音频则报错
    const ct = upstream.headers.get("content-type") || "";
    if (!ct.includes("audio") && !ct.includes("octet-stream")) {
      return NextResponse.json(
        {
          ok: false,
          error: "该歌曲因版权保护无法获取音频流，请尝试本地上传或示例曲目",
        },
        { status: 403 }
      );
    }

    const cl = upstream.headers.get("content-length");
    const headers = new Headers();
    headers.set("Content-Type", ct);
    headers.set("Cache-Control", "no-store");
    if (cl) headers.set("Content-Length", cl);
    // 允许前端读取（同源本就允许，这里显式设置）
    headers.set("Access-Control-Allow-Origin", "*");

    // 流式转发 body
    return new NextResponse(upstream.body, {
      status: 200,
      headers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json(
      { ok: false, error: `音频代理失败：${message}` },
      { status: 500 }
    );
  }
}
