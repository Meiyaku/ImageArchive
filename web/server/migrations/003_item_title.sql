-- Optional item title; '' means none (same convention as the notes columns).
ALTER TABLE items ADD COLUMN title TEXT NOT NULL DEFAULT '';
