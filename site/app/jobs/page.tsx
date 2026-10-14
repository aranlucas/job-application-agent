import type { Metadata } from "next";
import { JobsBoard } from "./JobsBoard";
import { loadJobsBoard } from "../../lib/load-jobs-board.mjs";
import { TRUST_LINE } from "../../lib/live-jobs.mjs";

export const dynamic = "force-dynamic";

const JOBS_TITLE = "Open roles";
const JOBS_DESCRIPTION = `Maintainer-reviewed open roles from the JobAppAgent community registry. ${TRUST_LINE}.`;
const JOBS_URL = "https://jobappagent.com/jobs";

export const metadata: Metadata = {
  title: JOBS_TITLE,
  description: JOBS_DESCRIPTION,
  alternates: { canonical: JOBS_URL },
  robots: { index: true, follow: true },
  openGraph: {
    title: `${JOBS_TITLE} · JobAppAgent`,
    description: JOBS_DESCRIPTION,
    url: JOBS_URL,
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "JobAppAgent open roles" }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${JOBS_TITLE} · JobAppAgent`,
    description: JOBS_DESCRIPTION,
    images: ["/og.png"],
  },
};

export async function headers() {
  return {
    "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
  };
}

function checkedLabel(iso: string | null) {
  if (!iso) return "";
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const time = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    }).format(date);
    const sameDay = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
      === date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    if (sameDay) return `today ${time} IST`;
    const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(date);
    return `${day} ${time} IST`;
  } catch {
    return "";
  }
}

export default async function JobsPage() {
  const board = await loadJobsBoard();
  return <JobsBoard jobs={board.open} checkedAtLabel={checkedLabel(board.checkedAt)} />;
}
