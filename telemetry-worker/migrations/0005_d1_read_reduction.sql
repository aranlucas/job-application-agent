-- Reduce D1 rows-read for liveness cron, /v1/jobs/live, and public stats.
-- Lifetime counters stay cumulative and match prior SUM/COUNT aggregates.

ALTER TABLE community_jobs ADD COLUMN contribution_count INTEGER NOT NULL DEFAULT 0;

UPDATE community_jobs
SET contribution_count = (
  SELECT COUNT(*) FROM community_job_contributions AS contributions
  WHERE contributions.job_id = community_jobs.job_id
);

-- Oldest-checked batch selection for */15 liveness cron (nulls sort first in ASC).
CREATE INDEX IF NOT EXISTS idx_community_jobs_liveness_due
  ON community_jobs(publication_status, review_status, last_checked_at, job_id);

CREATE TABLE IF NOT EXISTS public_stats_lifetime (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  installations INTEGER NOT NULL DEFAULT 0 CHECK (installations >= 0),
  jobs_assessed INTEGER NOT NULL DEFAULT 0 CHECK (jobs_assessed >= 0),
  applications_submitted INTEGER NOT NULL DEFAULT 0 CHECK (applications_submitted >= 0),
  interviews INTEGER NOT NULL DEFAULT 0 CHECK (interviews >= 0),
  offers INTEGER NOT NULL DEFAULT 0 CHECK (offers >= 0),
  active_installations_30d INTEGER NOT NULL DEFAULT 0 CHECK (active_installations_30d >= 0),
  refreshed_at TEXT NOT NULL
);

INSERT INTO public_stats_lifetime (
  id,
  installations,
  jobs_assessed,
  applications_submitted,
  interviews,
  offers,
  active_installations_30d,
  refreshed_at
)
SELECT
  1,
  (SELECT COUNT(*) FROM public_installations),
  COALESCE((SELECT SUM(count) FROM public_daily_metrics WHERE metric = 'jobs_assessed'), 0),
  COALESCE((SELECT SUM(count) FROM public_daily_metrics WHERE metric = 'applications_submitted'), 0),
  COALESCE((SELECT SUM(count) FROM public_daily_metrics WHERE metric = 'interviews'), 0),
  COALESCE((SELECT SUM(count) FROM public_daily_metrics WHERE metric = 'offers'), 0),
  (SELECT COUNT(*) FROM public_installations WHERE last_active_at >= datetime('now', '-30 days')),
  datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM public_stats_lifetime WHERE id = 1);

CREATE TABLE IF NOT EXISTS public_liveness_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  newest_last_checked_at TEXT
);

INSERT INTO public_liveness_meta (id, newest_last_checked_at)
SELECT
  1,
  (
    SELECT MAX(last_checked_at)
    FROM community_jobs
    WHERE publication_status = 'published'
      AND review_status = 'maintainer-reviewed'
  )
WHERE NOT EXISTS (SELECT 1 FROM public_liveness_meta WHERE id = 1);
