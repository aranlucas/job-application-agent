import type { ReactNode } from "react";

/**
 * Jobs surfaces opt out of landing pageview analytics via JobsAnalyticsGate.
 * Shared SiteHeader/SiteFooter with foundingCta={false} (no Reserve/$49 on /jobs*).
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
