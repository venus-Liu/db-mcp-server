/**
 * SQLite 数据库适配器
 */

import Database from 'better-sqlite3';
import type { DatabaseAdapter, SqlParameter, QueryResult, ExecuteResult, ProcedureResult, BatchResult, TableSchema, TableInfo } from './types.js';

export class SQLiteAdapter implements DatabaseAdapter {
  readonly type = 'sqlite';
  private db: Database.Database | null = null;

  async initialize(config: Record<string, string>): Promise<void> {
    const dbPath = config.database || ':memory:';
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    console.error(`[SQLite] 数据库已打开: ${dbPath}`);
  }

  async getConnection(): Promise<unknown> {
    if (!this.db) throw new Error('SQLite 数据库未初始化');
    return this.db;
  }

  async close(): Promise<void> {
    if (this.db) { this.db.close(); this.db = null; }
  }

  async query(sql: string, params?: SqlParameter[], maxRows?: number): Promise<QueryResult> {
    if (!this.db) throw new Error('SQLite 数据库未初始化');
    const limitClause = maxRows && !sql.toUpperCase().includes('LIMIT') ? ` LIMIT ${maxRows}` : '';
    const stmt = this.db.prepare(sql + limitClause);
    const rows = stmt.all(...(params || [])) as Record<string, unknown>[];
    const columns = rows.length > 0 ? Object.keys(rows[0]) : (stmt.columns()?.map((c: { name: string }) => c.name) || []);
    return {
      rows,
      metaData: columns.map((name: string) => ({ name })),
    };
  }

  async execute(sql: string, params?: SqlParameter[], autoCommit?: boolean): Promise<ExecuteResult> {
    if (!this.db) throw new Error('SQLite 数据库未初始化');
    const stmt = this.db.prepare(sql);
    const info = stmt.run(...(params || []));
    return { rowsAffected: info.changes, lastRowid: info.lastInsertRowid ? String(info.lastInsertRowid) : undefined };
  }

  async callProcedure(_name: string, _params?: Array<{ name: string; direction: string; type?: string; value?: SqlParameter }>): Promise<ProcedureResult> {
    return { outputParams: {}, resultSet: [] };
    // SQLite 不原生支持存储过程
  }

  async batchExecute(sql: string, paramsList: SqlParameter[][], autoCommit?: boolean): Promise<BatchResult> {
    const result: BatchResult = { totalRows: paramsList.length, successCount: 0, errorCount: 0, errors: [] };
    if (!this.db) throw new Error('SQLite 数据库未初始化');
    const transaction = this.db.transaction(() => {
      for (let i = 0; i < paramsList.length; i++) {
        try {
          this.db!.prepare(sql).run(...paramsList[i]);
          result.successCount++;
        } catch (e) {
          result.errorCount++;
          result.errors.push({ index: i, error: e instanceof Error ? e.message : String(e) });
        }
      }
    });
    transaction();
    return result;
  }

  async listTables(_schema?: string, pattern?: string): Promise<{ tables: TableInfo[] }> {
    if (!this.db) throw new Error('SQLite 数据库未初始化');
    let sql = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";
    if (pattern) { sql += ' AND name LIKE ?'; }
    sql += ' ORDER BY name';
    const stmt = this.db.prepare(sql);
    const rows = pattern ? stmt.all(pattern) as any[] : stmt.all() as any[];
    return { tables: rows.map(r => ({ tableName: r.name })) };
  }

  async getTableSchema(tableName: string, _schema?: string): Promise<TableSchema> {
    if (!this.db) throw new Error('SQLite 数据库未初始化');

    // 列信息
    const colRows = this.db.pragma(`table_info("${tableName}")`) as any[];
    const columns = colRows.map(c => ({
      columnName: c.name, dataType: c.type,
      nullable: c.notnull === 0, dataDefault: c.dflt_value || undefined,
    }));

    // 约束信息
    const fkRows = this.db.pragma(`foreign_key_list("${tableName}")`) as any[];
    const constraints = fkRows.map(fk => ({
      constraintName: `fk_${fk.table}_${fk.from}`,
      constraintType: 'R' as string,
      columnName: fk.from,
      rTableName: fk.table,
    }));

    // 索引信息
    const idxRows = this.db.pragma(`index_list("${tableName}")`) as any[];
    const indexes = idxRows.map(idx => {
      const colRows = this.db!.pragma(`index_info("${idx.name}")`) as any[];
      return {
        indexName: idx.name,
        uniqueness: idx.unique ? 'UNIQUE' : 'NONUNIQUE',
        columns: colRows.map(c => c.name),
      };
    });

    return { tableName, columns, constraints, indexes };
  }

  async getTransactionConnection(): Promise<unknown> {
    // SQLite 是单连接，事务通过 SQL 控制
    if (!this.db) throw new Error('SQLite 数据库未初始化');
    this.db.exec('BEGIN');
    return this.db;
  }

  async executeInTransaction(connection: unknown, sql: string, params?: SqlParameter[]): Promise<ExecuteResult> {
    const db = connection as Database.Database;
    const stmt = db.prepare(sql);
    const info = stmt.run(...(params || []));
    return { rowsAffected: info.changes, lastRowid: info.lastInsertRowid ? String(info.lastInsertRowid) : undefined };
  }

  async commitTransaction(connection: unknown): Promise<void> {
    (connection as Database.Database).exec('COMMIT');
  }

  async rollbackTransaction(connection: unknown): Promise<void> {
    (connection as Database.Database).exec('ROLLBACK');
  }

  async closeTransactionConnection(_connection: unknown): Promise<void> {
    // SQLite 共享同一连接
  }

  escapeIdentifier(name: string): string {
    return `"${name}"`;
  }
}
