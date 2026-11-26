#!/bin/sh
# Run on the node by run.sh. Compares the restored scratch DB and NAS photos with production.
K="kubectl -n imagearchive"
R="$K exec -i restore-test -c db --"
P="$K exec -i postgres-0 --"

SQL="select t, md5(string_agg(r, '|' order by r)) from (
  select 'users' t, u::text r from users u
  union all select 'sessions', s::text from sessions s
  union all select 'albums', a::text from albums a
  union all select 'items', i::text from items i
  union all select 'login_attempts', l::text from login_attempts l
  union all select 'schema_migrations', m.name from schema_migrations m
) x group by t order by t;"

echo "--- table checksums (restored | production)"
$R psql -At -U imagearchive -d imagearchive -c "$SQL" > /tmp/ia-r.txt
$P psql -At -U imagearchive -d imagearchive -c "$SQL" > /tmp/ia-p.txt
paste -d' ' /tmp/ia-r.txt /tmp/ia-p.txt
cmp -s /tmp/ia-r.txt /tmp/ia-p.txt && echo "TABLES MATCH" || echo "TABLES DIFFER"

echo "--- files the restored DB refers to that are missing from the NAS photos"
KEYS="select k from (select image_key k from items union all select thumb_key from items
  union all select cover_image_key from albums union all select cover_thumb_key from albums) x where k is not null;"
$R psql -At -U imagearchive -d imagearchive -c "$KEYS" | while read -r k; do
  $R test -f "/restore/photos/$k" || echo "MISSING $k"
done
echo "(end of list)"

echo "--- photo checksums (NAS copy vs live volume)"
$R sh -c 'cd /restore/photos && md5sum * | sort' > /tmp/ia-rp.txt
$K exec deploy/imagearchive -- sh -c 'cd /data/uploads && md5sum * | sort' > /tmp/ia-pp.txt
wc -l < /tmp/ia-rp.txt
cmp -s /tmp/ia-rp.txt /tmp/ia-pp.txt && echo "PHOTOS MATCH" || { echo "PHOTOS DIFFER"; diff /tmp/ia-rp.txt /tmp/ia-pp.txt; }
rm -f /tmp/ia-r.txt /tmp/ia-p.txt /tmp/ia-rp.txt /tmp/ia-pp.txt
