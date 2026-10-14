declare module "*/structured-data.mjs" {
  export const SITE_ORIGIN: string;
  export const STATS_ORIGIN: string;
  export const GITHUB_URL: string;
  export function organizationJsonLd(): Record<string, unknown>;
  export function websiteJsonLd(): Record<string, unknown>;
  export function softwareApplicationJsonLd(): Record<string, unknown>;
  export function siteJsonLdGraph(): Record<string, unknown>;
  export function breadcrumbListJsonLd(
    crumbs: { name: string; path: string }[],
  ): Record<string, unknown>;
  export function statsSitemapXml(): string;
  export function statsRobotsTxt(): string;
}
