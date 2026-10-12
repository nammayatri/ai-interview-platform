-- Run by the table owner (postgres) after 005_interview_templates.sql so the app role can use the new table.
GRANT SELECT, INSERT, UPDATE, DELETE ON interview_templates TO atlas_rw;
