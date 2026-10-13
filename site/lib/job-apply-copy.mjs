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

/** Paste prompt shown on the jobs board until `apply` is published on npm. */
export function buildApplyPastePrompt(url) {
  return `Apply to this role in review mode: ${url}`;
}
