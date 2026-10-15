let DatabaseSync;

try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch (error) {
  if (error?.code !== 'ERR_UNKNOWN_BUILTIN_MODULE') throw error;
}

export const hasNodeSqlite = Boolean(DatabaseSync);

function applySchema(database, schema) {
  for (const statement of String(schema).split(';').map((part) => part.trim()).filter(Boolean)) {
    database.exec(statement);
  }
}

export function createMemoryD1(schema = '') {
  if (!DatabaseSync) throw new Error('The in-memory D1 test adapter requires node:sqlite (Node.js 22.5 or newer)');
  const database = new DatabaseSync(':memory:');
  if (schema) applySchema(database, schema);
  let batchTail = Promise.resolve();
  return {
    exec(sql) {
      applySchema(database, sql);
      return Promise.resolve({ count: 0, duration: 0 });
    },
    prepare(sql) {
      let values = [];
      const api = {
        bind(...next) {
          values = next;
          return api;
        },
        async first(column) {
          const row = database.prepare(sql).get(...values) ?? null;
          return column && row ? row[column] : row;
        },
        async all() {
          const results = database.prepare(sql).all(...values);
          return { results, success: true, meta: { rows_read: results.length, rows_written: 0 } };
        },
        async run() {
          const result = database.prepare(sql).run(...values);
          return {
            success: true,
            meta: {
              changes: result.changes,
              last_row_id: result.lastInsertRowid,
              rows_read: 0,
              rows_written: result.changes,
            },
          };
        },
      };
      return api;
    },
    async batch(statements) {
      const previous = batchTail;
      let release;
      batchTail = new Promise((resolve) => { release = resolve; });
      await previous;
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      } finally {
        release();
      }
    },
    database,
    explain(sql) {
      return database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
    },
  };
}
