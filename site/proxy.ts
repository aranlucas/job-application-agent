import { NextRequest, NextResponse } from "next/server";
import { statsRobotsTxt } from "./lib/structured-data.mjs";

const STATS_HOST = "stats.jobappagent.com";
const PRODUCT_HOSTS = new Set(["jobappagent.com", "www.jobappagent.com"]);

export function proxy(request: NextRequest) {
  const hostname = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
  const pathname = request.nextUrl.pathname;
  if (hostname === STATS_HOST) {
    if (pathname === "/") {
      return NextResponse.rewrite(new URL("/community-view", request.url));
    }
    if (pathname === "/sitemap.xml") {
      return NextResponse.rewrite(new URL("/stats-sitemap.xml", request.url));
    }
    if (pathname === "/robots.txt") {
      return new NextResponse(statsRobotsTxt(), {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
      });
    }
  }
  if (PRODUCT_HOSTS.has(hostname) && pathname === "/community") {
    return NextResponse.redirect("https://stats.jobappagent.com/", 308);
  }
  if (PRODUCT_HOSTS.has(hostname) && pathname === "/community-view") {
    return NextResponse.redirect("https://stats.jobappagent.com/", 308);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/", "/community", "/community-view", "/sitemap.xml", "/robots.txt"] };
