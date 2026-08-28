import { DatabaseSync } from 'node:sqlite';
import type { AuditStore } from '../../core/src/index.js';

export class SqliteAuditStore implements AuditStore {
  private db: DatabaseSync;
  constructor(path = 'openclasp.db') {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS audit_records (
        kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );
    `);
  }
  append(kind: string, id: string, value: unknown): void {
    const encoded = JSON.stringify(value);
    const row = this.db
      .prepare('SELECT value FROM audit_records WHERE kind=? AND id=?')
      .get(kind, id) as { value: string } | undefined;
    if (row && row.value !== encoded) throw new Error(`Conflicting duplicate ${kind}:${id}`);
    if (!row)
      this.db
        .prepare('INSERT INTO audit_records(kind,id,value,created_at) VALUES(?,?,?,?)')
        .run(kind, id, encoded, new Date().toISOString());
  }
  list(kind: string): unknown[] {
    return (
      this.db
        .prepare('SELECT value FROM audit_records WHERE kind=? ORDER BY created_at')
        .all(kind) as { value: string }[]
    ).map((row) => JSON.parse(row.value));
  }
  close(): void {
    this.db.close();
  }
}
