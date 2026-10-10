import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set the server-only DATABASE_URL for the migration owner.');
const client = new pg.Client({
  connectionString: url,
  ssl: {
    rejectUnauthorized: true,
    ...(process.env.DATABASE_CA_FILE
      ? { ca: readFileSync(process.env.DATABASE_CA_FILE, 'utf8') }
      : {}),
  },
});
try {
  await client.connect();
  await client.query('begin');
  await client.query("select pg_advisory_xact_lock(hashtextextended('openrange:migrations',0))");
  await client.query(
    'create schema if not exists openrange; create table if not exists openrange.schema_migrations(name text primary key,checksum text not null,applied_at timestamptz not null default now())',
  );
  for (const name of (await readdir('supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = await readFile(`supabase/migrations/${name}`, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = (
      await client.query('select checksum from openrange.schema_migrations where name=$1', [name])
    ).rows[0];
    if (existing) {
      if (existing.checksum !== checksum)
        throw new Error(`Applied migration ${name} was changed. Add a new migration.`);
      continue;
    }
    await client.query(sql);
    await client.query('insert into openrange.schema_migrations(name,checksum) values($1,$2)', [
      name,
      checksum,
    ]);
    process.stdout.write(`Applied ${name}\n`);
  }
  await client.query('commit');
} catch {
  await client.query('rollback').catch(() => {});
  process.stderr.write(
    'Migration failed. Verify database access and migration history with the provider.\n',
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
