import type { ReactNode } from "react";

/**
 * Jobs surfaces opt out of landing pageview analytics via JobsAnalyticsGate.
 * Chrome matches the rest of the site (shared SiteHeader / SiteFooter).
 */
export default function JobsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <JobsAnalyticsGate />
      {children}
    </>
  );
}

function JobsAnalyticsGate() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `window.__JAA_JOBS_NO_ANALYTICS__=1;`,
      }}
    />
  );
}
