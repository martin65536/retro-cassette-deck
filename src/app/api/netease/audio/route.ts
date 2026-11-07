import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 音频流代理（完全透传上游响应）
 * 不拦截、不校验，直接 pipe upstream body
 * 前端 decodeAudioData 会自行判断是否为有效音频
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
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

    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    const headers = new Headers();
    headers.set("Content-Type", ct);
    headers.set("Cache-Control", "no-store");
    headers.set("Access-Control-Allow-Origin", "*");
    const cl = upstream.headers.get("content-length");
    if (cl) headers.set("Content-Length", cl);

    // 完全透传（包括 HTML 404 页面）
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
