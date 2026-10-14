/** Shorten a URL for on-screen display; Copy still uses the full value. */
export function shortenUrlForDisplay(url, maxPath = 28) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    const clipped = path.length > maxPath ? `${path.slice(0, Math.max(8, maxPath - 1))}…` : path;
    return `${parsed.hostname}${clipped}`;
  } catch {
    return url.length > 48 ? `${url.slice(0, 45)}…` : url;
  }
}

/** Paste prompt kept as a secondary fallback if the CLI is unavailable. */
export function buildApplyPastePrompt(url) {
  return `Apply to this role in review mode: ${url}`;
}

/** Primary Apply CTA once `job-application-agent@3.7.7+` ships `apply <url>`. */
export function buildApplyCliCommand(url) {
  return `npx job-application-agent@latest apply ${url}`;
}
