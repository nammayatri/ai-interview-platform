-- Run by the table owner (postgres) after 006_interview_batches.sql so the app role can use the new table.
GRANT SELECT, INSERT, UPDATE, DELETE ON interview_batches TO atlas_rw;
