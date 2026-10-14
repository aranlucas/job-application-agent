import { statsSitemapXml } from "../../lib/structured-data.mjs";

/** Internal path rewritten to /sitemap.xml on stats.jobappagent.com. */
export function GET() {
  return new Response(statsSitemapXml(), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
