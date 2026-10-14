import Link from "next/link";

/** Jobs-surface chrome: no founding/$49 CTA (privacy + copy rules). */
export function JobsBoardHeader() {
  return (
    <nav className="site-nav" aria-label="Primary navigation">
      <div className="nav-inner page-width">
        <a className="brand" href="https://jobappagent.com" aria-label="JobAppAgent home">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-lockup">
            <span className="brand-name">JobApp<span>Agent</span></span>
            <span className="brand-tagline">A calmer job search</span>
          </span>
        </a>
        <div className="nav-links jobs-nav-links">
          <Link href="/jobs" aria-current="page">Jobs</Link>
          <a href="https://stats.jobappagent.com">Community</a>
          <a href="https://jobappagent.com/#process">How it works</a>
          <a href="https://jobappagent.com/#boundaries">Boundaries</a>
        </div>
        <details className="jobs-mobile-menu">
          <summary>Menu</summary>
          <div className="jobs-mobile-menu-links">
            <Link href="/jobs">Jobs</Link>
            <a href="https://stats.jobappagent.com">Community</a>
            <a href="https://jobappagent.com/#process">How it works</a>
            <a href="https://jobappagent.com/#boundaries">Boundaries</a>
          </div>
        </details>
      </div>
    </nav>
  );
}

export function JobsBoardFooter() {
  return (
    <footer>
      <div className="page-width">
        <span>JobAppAgent jobs board · anonymous by design · no candidate profiles</span>
        <div>
          <a href="https://jobappagent.com">Product</a>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </div>
      </div>
    </footer>
  );
}
