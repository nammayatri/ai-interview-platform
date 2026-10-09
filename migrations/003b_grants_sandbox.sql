-- Run by the table owner (postgres) right after 003_dsa_review.sql, so the app role can use the new tables.
-- In the GCP sandbox the app connects as atlas_rw, which owns nothing and cannot CREATE in schema public.
GRANT SELECT, INSERT, UPDATE, DELETE ON problems, puzzles, submissions, interview_phases, interview_events TO atlas_rw;
GRANT USAGE, SELECT ON SEQUENCE interview_events_id_seq TO atlas_rw;
