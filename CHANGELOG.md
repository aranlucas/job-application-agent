# Changelog

## 3.7.5

- Require `telemetry.fieldsFilled` and `telemetry.resumeUploaded` on live `ledger add` when `answers` are empty, so `application_submitted` no longer defaults to 0 fields / no résumé when agents omit fill metrics.
- Block live submits that report 0 fields and no résumé unless `thinSubmissionOverride: "THIN SUBMISSION ACKNOWLEDGED"` (true empty ATS accepts only); fixture / vendor-sandbox applies stay exempt.
- Derive fill metrics from answer *keys* when present, and document count-only telemetry (no paths or answer text).
- Fix attention/`batch` `invalid_input` from partial session-binding fields: only write a binding when `browserProfilePath` is set; map common blocker/action aliases; reject `answers` on attention add with a clear message; surface display/VNC binding errors as actionable invalid input.
- Confirm setup `internal_error` on v3.7.2 was the cloud `Usage:` mislabel fixed in 3.7.3 (`invalid_input` + `errorCategory=usage`); keep the regression coverage.

## 3.7.4

- Emit `application_started` from `score` when the decision is `review`, and emit `application_paused` from `attention add`, so those events no longer depend on the browser workflow remembering `telemetry record`.
- Deduplicate `application_started` / `application_paused` per job attempt when the skill also calls `telemetry record`.
- Reject unused `identity` keys on telemetry event envelopes (analytics keep install id + schema fields only).

## 3.7.3

- Treat corrupt `telemetry.json` as enabled (unless an explicit opt-out file/env/`telemetry disable`), and rewrite the file instead of permanently disabling analytics.
- Send the first command after disclosure and on upgrades that lack `telemetry.json`, including the install event (no more dropped grace-period command).
- Persist a bounded on-disk telemetry queue with modest retry/backoff so one failed send no longer drops the rest of the command; debug-log each drop reason.
- Debug-log schema-invalid events and emit a `skill_error` counter with `errorCategory=schema_invalid` (no invalid payload).
- Start the telemetry session before cloud-state preparation so failures still emit `skill_error` / `command_completed`.
- Emit domain events (`job_assessed`, `application_submitted`, `application_skipped`, round/source coverage, etc.) as they happen instead of only after the command finishes.
- Stop sending candidate name/email on PostHog analytics event payloads; relay no longer forwards `candidateName` / `candidateEmail`.
- Add a private contact store (`POST /v1/contact` → `PRIVATE_CONTACTS_DB.install_contacts`) that upserts saved name/email once per install and when values change, with `telemetry contact disable` opt-out; skipped when telemetry is opted out; uses the same queue/retry path.
- Update first-run disclosure plus site Privacy/Terms to describe private contact storage for support and product updates.
- Add sanitized `skill_error` details (`errorCategory`, `sanitizedMessage`, `fieldLabel`) and accept real application durations via `durationMs` / `startedAt`/`endedAt`.
- Emit `application_skipped` from score decisions `skip`/`exclude`; keep `application_started` available via `telemetry record`.
- Classify Usage, profile-missing/migration, lease, cloud HTTP, and duplicate/cooldown errors more accurately instead of opaque `internal_error`.
