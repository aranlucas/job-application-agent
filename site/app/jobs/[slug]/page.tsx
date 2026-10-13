import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JobDetail } from "../JobDetail";
import { findJobBySlug, loadJobsBoard } from "../../../lib/load-jobs-board.mjs";
import { jobPostingJsonLd, similarOpenRoles, isListedOpenJob } from "../../../lib/live-jobs.mjs";

type Props = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const board = await loadJobsBoard();
  const job = findJobBySlug(board.all, slug);
  if (!job) return { title: "Role not found", robots: { index: false, follow: false } };
  const closed = job.livenessStatus === "closed";
  return {
    title: closed ? `${job.role} (closed)` : job.role,
    description: closed
      ? `${job.role} at ${job.company} is closed.`
      : `${job.role} at ${job.company}. Reviewed and live, checked daily.`,
    alternates: { canonical: `https://jobappagent.com/jobs/${job.slug}` },
    robots: { index: true, follow: true },
  };
}

export function generateStaticParams() {
  return [];
}

export default async function JobPage({ params }: Props) {
  const { slug } = await params;
  const board = await loadJobsBoard();
  const job = findJobBySlug(board.all, slug);
  if (!job) notFound();

  const staleOpen = job.livenessStatus !== "closed" && !isListedOpenJob(job, board.now);
  if (staleOpen) notFound();

  const similar = job.livenessStatus === "closed" ? similarOpenRoles(job, board.open, 3) : [];
  const jsonLd = jobPostingJsonLd(job);

  return <JobDetail job={job} similar={similar} jsonLd={jsonLd} />;
}
