import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 音频流代理（透传上游响应，但对 HTML 404 页做兜底拦截）
 *
 * 与 koishi-plugin-music / go-cqhttp 一致：播放地址来自 outer/url，
 * 受限歌曲该地址会 302 到 music.163.com/404 的 HTML 页。
 * 若上游最终是 HTML（而非音频），说明外链不可用 —— 此时不再把
 * HTML 喂给前端 decodeAudioData，而是返回明确错误。
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

    const ct = upstream.headers.get("content-type") || "";

    // 兜底：上游返回的是 HTML 页（通常是 outer/url 跳到 /404），
    // 直接拦截，避免前端 decodeAudioData 报晦涩错误。
    if (ct.includes("text/html")) {
      return NextResponse.json(
        {
          ok: false,
          error: "该歌曲暂时无法播放（版权受限或未上架），请尝试其它歌曲或使用本地上传",
        },
        { status: 502 }
      );
    }

    const headers = new Headers();
    headers.set("Content-Type", ct || "application/octet-stream");
    headers.set("Cache-Control", "no-store");
    headers.set("Access-Control-Allow-Origin", "*");
    const cl = upstream.headers.get("content-length");
    if (cl) headers.set("Content-Length", cl);

    // 完全透传音频流
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
