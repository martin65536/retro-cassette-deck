import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 音频流代理（流式转发，无完整缓冲，无严格帧头校验）
 *
 * 接收 ?url=<上游音频URL>，直接 pipe upstream body 到响应
 * - 流式：不完整缓冲，内存占用低，首字节快
 * - 宽松校验：只看 content-type header，非 text/html 即放行
 * - 部分歌曲（fee:8 免费）可正常获取，VIP/版权受限返回 HTML 404 会被拒
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

    if (!upstream.ok) {
      return NextResponse.json(
        { ok: false, error: `上游返回 ${upstream.status}` },
        { status: 502 }
      );
    }

    const ct = upstream.headers.get("content-type") || "";

    // 宽松校验：仅拒绝 HTML（版权受限的 404 页面）
    // 不做帧头字节校验，避免误杀合法音频
    if (ct.includes("text/html")) {
      return NextResponse.json(
        {
          ok: false,
          error: "该歌曲因版权保护无法获取音频，请尝试本地上传或示例曲目",
        },
        { status: 403 }
      );
    }

    // 流式转发 body（不完整缓冲）
    const headers = new Headers();
    const audioCt =
      ct.includes("audio") || ct.includes("octet-stream") || ct.includes("mpeg")
        ? ct
        : "audio/mpeg";
    headers.set("Content-Type", audioCt);
    headers.set("Cache-Control", "no-store");
    // 透传 Content-Length / Accept-Ranges 支持范围请求
    const cl = upstream.headers.get("content-length");
    if (cl) headers.set("Content-Length", cl);
    const ar = upstream.headers.get("accept-ranges");
    if (ar) headers.set("Accept-Ranges", ar);
    headers.set("Access-Control-Allow-Origin", "*");

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
