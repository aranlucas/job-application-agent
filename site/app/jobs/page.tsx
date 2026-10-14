import type { Metadata } from "next";
import { JobsBoard } from "./JobsBoard";
import { loadJobsBoard } from "../../lib/load-jobs-board.mjs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Open roles",
  description: "Maintainer-reviewed open roles from the JobAppAgent community registry. Reviewed and live, checked daily.",
  alternates: { canonical: "https://jobappagent.com/jobs" },
  robots: { index: true, follow: true },
};

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
