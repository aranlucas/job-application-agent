import type { ReactNode } from "react";

/**
 * Jobs surfaces stay anonymous: no founding CTA in chrome, and child pages
 * opt out of landing analytics via the JobsAnalyticsGate below.
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
