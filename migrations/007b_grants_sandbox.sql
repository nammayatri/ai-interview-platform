-- Run by the table owner (postgres) after 007_batch_invites.sql so the app role can use the new table.
GRANT SELECT, INSERT, UPDATE, DELETE ON interview_batch_invites TO atlas_rw;
