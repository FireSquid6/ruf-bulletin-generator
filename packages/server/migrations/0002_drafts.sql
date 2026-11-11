-- The bulletin table was introduced in 0001. Preserve its date constraint and
-- composition column; new drafts use the same row so later block editing can
-- evolve the JSON document without tying storage to one PDF page layout.
ALTER TABLE bulletin ADD CONSTRAINT bulletin_revision_positive CHECK (revision > 0);
ALTER TABLE bulletin ALTER COLUMN composition SET DEFAULT '{"cover":[],"flow":[]}';
UPDATE bulletin SET composition = '{"cover":[],"flow":[]}' WHERE composition = '[]';
