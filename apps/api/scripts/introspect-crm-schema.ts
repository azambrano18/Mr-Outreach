/**
 * One-off, manually-run introspection of the external Neon CRM database
 * (table `maestro_clientes`) — never part of `nest build`, never imported
 * by app code. Etapa 0 of the admin-reorg plan: the spec explicitly says
 * not to assume the table's column names or its `status` value format, so
 * this prints ONLY column metadata and distinct status values/counts —
 * never a full row, and never the connection string itself (not even on
 * error, since some pg error paths embed it).
 *
 * Usage: npx ts-node --compiler-options {"module":"CommonJS"} apps/api/scripts/introspect-crm-schema.ts
 */
import { Pool } from 'pg';

async function main(): Promise<void> {
  const connectionString = process.env.CRM_DATABASE_URL;
  if (!connectionString) {
    console.error('CRM_DATABASE_URL is not set — nothing to introspect.');
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString });
  try {
    const columns = await pool.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = $1
       ORDER BY ordinal_position`,
      ['maestro_clientes'],
    );
    console.log('--- maestro_clientes columns ---');
    for (const row of columns.rows) {
      console.log(`${row.column_name}: ${row.data_type} (nullable=${row.is_nullable})`);
    }

    const hasStatusColumn = columns.rows.some((row) => row.column_name === 'status');
    if (hasStatusColumn) {
      const statuses = await pool.query(
        `SELECT status, count(*)::int AS count FROM maestro_clientes GROUP BY status ORDER BY count DESC`,
      );
      console.log('\n--- distinct status values ---');
      for (const row of statuses.rows) {
        console.log(`${JSON.stringify(row.status)}: ${row.count} rows`);
      }
    } else {
      console.log('\nNo column literally named "status" — inspect the column list above for the real name.');
    }

    const totalRes = await pool.query('SELECT count(*)::int AS count FROM maestro_clientes');
    console.log(`\nTotal rows: ${totalRes.rows[0].count}`);
  } catch (error) {
    // Deliberately generic — never print `error` itself, since some pg
    // connection-failure paths include the connection string.
    console.error('Introspection failed. Check CRM_DATABASE_URL and network access, but the raw error is not printed here for safety.');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
