-- Album-level cover photo (its own files, independent of any item) and story intro.
ALTER TABLE albums ADD COLUMN cover_image_key TEXT;
ALTER TABLE albums ADD COLUMN cover_thumb_key TEXT;
ALTER TABLE albums ADD COLUMN intro TEXT NOT NULL DEFAULT '';
