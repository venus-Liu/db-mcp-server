/**
 * PostgreSQL 数据库适配器
 */

import pg from 'pg';
const { Pool } = pg;
import type { DatabaseAdapter, SqlParameter, QueryResult, ExecuteResult, ProcedureResult, BatchResult, TableSchema, TableInfo } from './types.js';

export class PostgreSQLAdapter implements DatabaseAdapter {
  readonly type = 'postgresql';
  private pool: pg.Pool | null = null;

  async initialize(config: Record<string, string>): Promise<void> {
    this.pool = new Pool({
      host: config.host || 'localhost',
      port: parseInt(config.port || '5432', 10),
      user: config.user,
      password: config.password,
      database: config.database,
      max: 10,
    });
    console.error('[PostgreSQL] 连接池创建成功');
  }

  async getConnection(): Promise<unknown> {
    if (!this.pool) throw new Error('PostgreSQL 连接池未初始化');
    return await this.pool.connect();
  }

  async close(): Promise<void> {
    if (this.pool) { await this.pool.end(); this.pool = null; }
  }

  async query(sql: string, params?: SqlParameter[], maxRows?: number): Promise<QueryResult> {
    const client = await this.pool!.connect();
    try {
      const limitClause = maxRows && !sql.toUpperCase().includes('LIMIT') ? ` LIMIT ${maxRows}` : '';
      const result = await client.query(sql + limitClause, params);
      return {
        rows: result.rows,
        metaData: result.fields.map((f: { name: string }) => ({ name: f.name })),
      };
    } finally {
      client.release();
    }
  }

  async execute(sql: string, params?: SqlParameter[], autoCommit?: boolean): Promise<ExecuteResult> {
    const client = await this.pool!.connect();
    try {
      if (!autoCommit) await client.query('BEGIN');
      const result = await client.query(sql, params);
      if (!autoCommit) await client.query('COMMIT');
      return { rowsAffected: result.rowCount || 0 };
    } catch (e) {
      if (!autoCommit) await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async callProcedure(name: string, params?: Array<{ name: string; direction: string; type?: string; value?: SqlParameter }>): Promise<ProcedureResult> {
    // PostgreSQL 使用 SELECT func_name() 或 CALL proc_name()
    const inParams = (params || []).filter(p => p.direction === 'IN');
    const values = inParams.map((_, i) => `$${i + 1}`).join(', ');
    const vals = inParams.map(p => p.value).filter((v): v is SqlParameter => v !== undefined);
    const result = await this.query(`SELECT * FROM ${name}(${values})`, vals);
    return { outputParams: {}, resultSet: result.rows };
  }

  async batchExecute(sql: string, paramsList: SqlParameter[][], autoCommit?: boolean): Promise<BatchResult> {
    const result: BatchResult = { totalRows: paramsList.length, successCount: 0, errorCount: 0, errors: [] };
    const client = await this.pool!.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < paramsList.length; i++) {
        try {
          await client.query(sql, paramsList[i]);
          result.successCount++;
        } catch (e) {
          result.errorCount++;
          result.errors.push({ index: i, error: e instanceof Error ? e.message : String(e) });
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    return result;
  }

  async listTables(schema?: string, pattern?: string): Promise<{ tables: TableInfo[] }> {
    const s = schema || 'public';
    let sql = `SELECT table_name, obj_description((quote_ident(table_schema) || '.' || quote_ident(table_name))::regclass, 'pg_class') as comments
               FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'`;
    const params: string[] = [s];
    if (pattern) { sql += ' AND table_name LIKE $2'; params.push(pattern); }
    sql += ' ORDER BY table_name';
    const result = await this.query(sql, params);
    return { tables: (result.rows as any[]).map(r => ({ tableName: r.table_name, comments: r.comments || undefined })) };
  }

  async getTableSchema(tableName: string, schema?: string): Promise<TableSchema> {
    const s = schema || 'public';

    // 列信息
    const colResult = await this.query(
      `SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale,
              is_nullable, column_default, col_description((quote_ident($1) || '.' || quote_ident($2))::regclass, ordinal_position) as comments
       FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
      [s, tableName]
    );

    // 约束信息
    const conResult = await this.query(
      `SELECT c.constraint_name, c.constraint_type, k.column_name, c.check_clause
       FROM information_schema.table_constraints c
       JOIN information_schema.key_column_usage k ON c.constraint_name = k.constraint_name AND c.table_schema = k.table_schema
       WHERE c.table_schema = $1 AND c.table_name = $2
       UNION
       SELECT tc.constraint_name, tc.constraint_type, NULL, NULL
       FROM information_schema.table_constraints tc
       WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'CHECK'`,
      [s, tableName]
    );

    // 索引信息
    const idxResult = await this.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`,
      [s, tableName]
    );

    const columns = (colResult.rows as any[]).map(c => ({
      columnName: c.column_name, dataType: c.data_type,
      dataLength: c.character_maximum_length || undefined,
      dataPrecision: c.numeric_precision || undefined, dataScale: c.numeric_scale || undefined,
      nullable: c.is_nullable === 'YES', dataDefault: c.column_default || undefined,
      comments: c.comments || undefined,
    }));

    const constraints = (conResult.rows as any[]).map(c => ({
      constraintName: c.constraint_name, constraintType: c.constraint_type,
      columnName: c.column_name || undefined, searchCondition: c.check_clause || undefined,
    }));

    const indexes = (idxResult.rows as any[]).map(i => ({
      indexName: i.indexname, uniqueness: i.indexdef.includes('UNIQUE') ? 'UNIQUE' : 'NONUNIQUE', columns: [],
    }));

    return { tableName, columns, constraints, indexes };
  }

  async getTransactionConnection(): Promise<unknown> {
    const client = await this.pool!.connect();
    await client.query('BEGIN');
    return client;
  }

  async executeInTransaction(connection: unknown, sql: string, params?: SqlParameter[]): Promise<ExecuteResult> {
    const result = await (connection as pg.PoolClient).query(sql, params);
    return { rowsAffected: result.rowCount || 0 };
  }

  async commitTransaction(connection: unknown): Promise<void> {
    await (connection as pg.PoolClient).query('COMMIT');
    (connection as pg.PoolClient).release();
  }

  async rollbackTransaction(connection: unknown): Promise<void> {
    await (connection as pg.PoolClient).query('ROLLBACK');
    (connection as pg.PoolClient).release();
  }

  async closeTransactionConnection(connection: unknown): Promise<void> {
    (connection as pg.PoolClient).release();
  }

  escapeIdentifier(name: string): string {
    return `"${name}"`;
  }
}
