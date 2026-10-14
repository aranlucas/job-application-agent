-- Private contact store for support and product updates.
-- Bound only to PRIVATE_CONTACTS_DB. No public Worker route reads this table.
CREATE TABLE IF NOT EXISTS install_contacts (
  install_id TEXT PRIMARY KEY NOT NULL,
  candidate_name TEXT,
  candidate_email TEXT,
  skill_version TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_install_contacts_updated
  ON install_contacts(updated_at);

CREATE INDEX IF NOT EXISTS idx_install_contacts_email
  ON install_contacts(candidate_email);
