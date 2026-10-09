-- Run by the table owner (postgres) after 004_stages_and_runbooks.sql so the app role can use the new table.
GRANT SELECT, INSERT, UPDATE, DELETE ON runbooks TO atlas_rw;
