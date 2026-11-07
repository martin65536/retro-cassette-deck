import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 音频流代理（透传上游响应）
 *
 * 接收 ?url=<上游音频URL>，直接 pipe upstream body 到响应
 * - 流式转发（不完整缓冲）
 * - 透传上游 content-type / status，不拦截 HTML
 * - 前端 audio-engine.load() 会因 decodeAudioData 失败而报错
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

    // 透传上游 content-type 和 body（包括 HTML 404）
    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    const headers = new Headers();
    headers.set("Content-Type", ct);
    headers.set("Cache-Control", "no-store");
    const cl = upstream.headers.get("content-length");
    if (cl) headers.set("Content-Length", cl);
    const ar = upstream.headers.get("accept-ranges");
    if (ar) headers.set("Accept-Ranges", ar);
    headers.set("Access-Control-Allow-Origin", "*");

    // 如果上游返回 HTML（版权 404），改为返回 JSON 错误（前端能解析）
    if (ct.includes("text/html")) {
      const body = await upstream.text();
      return NextResponse.json(
        {
          ok: false,
          error: "该歌曲因版权保护无法获取音频，请尝试本地上传或示例曲目",
          upstream: {
            status: upstream.status,
            contentType: ct,
            bodyPreview: body.slice(0, 200),
            url: url,
          },
        },
        { status: 403 }
      );
    }

    // 音频流式转发
    return new NextResponse(upstream.body, {
      status: upstream.status,
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
