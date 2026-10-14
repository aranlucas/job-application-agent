ALTER TABLE community_jobs ADD COLUMN liveness_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK(liveness_status IN ('open', 'closed', 'unknown'));
ALTER TABLE community_jobs ADD COLUMN last_checked_at TEXT;
ALTER TABLE community_jobs ADD COLUMN closed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_community_jobs_live
  ON community_jobs(publication_status, review_status, liveness_status, last_seen_at DESC, job_id DESC);
