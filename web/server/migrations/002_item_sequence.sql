-- User-assignable sort order within an album. Duplicates are allowed; ties sort by id.
ALTER TABLE items ADD COLUMN sequence INTEGER;

-- Number existing items 1, 2, 3… per album in the order they were added.
UPDATE items i SET sequence = n.seq
  FROM (SELECT id, row_number() OVER (PARTITION BY album_id ORDER BY created_at, id) AS seq FROM items) n
 WHERE n.id = i.id;

ALTER TABLE items ALTER COLUMN sequence SET NOT NULL;
CREATE INDEX items_album_sequence_idx ON items (album_id, sequence, id);
