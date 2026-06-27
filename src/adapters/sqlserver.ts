/**
 * SQL Server 数据库适配器
 */

import mssql from 'mssql';
import type { DatabaseAdapter, SqlParameter, QueryResult, ExecuteResult, ProcedureResult, BatchResult, TableSchema, TableInfo } from './types.js';

export class SqlServerAdapter implements DatabaseAdapter {
  readonly type = 'sqlserver';
  private pool: mssql.ConnectionPool | null = null;

  async initialize(config: Record<string, string>): Promise<void> {
    this.pool = await mssql.connect({
      server: config.host || 'localhost',
      port: parseInt(config.port || '1433', 10),
      user: config.user,
      password: config.password,
      database: config.database,
      options: {
        encrypt: config.encrypt !== 'false',
        trustServerCertificate: true,
      },
      pool: { max: 10, min: 2 },
    });
    console.error('[SQL Server] 连接池创建成功');
  }

  async getConnection(): Promise<unknown> {
    if (!this.pool) throw new Error('SQL Server 连接池未初始化');
    return this.pool;
  }

  async close(): Promise<void> {
    if (this.pool) { await this.pool.close(); this.pool = null; }
  }

  async query(sql: string, params?: SqlParameter[], maxRows?: number): Promise<QueryResult> {
    if (!this.pool) throw new Error('SQL Server 连接池未初始化');
    const topClause = maxRows && !sql.toUpperCase().includes('TOP ') && !sql.toUpperCase().includes('LIMIT')
      ? sql.trim().toUpperCase().startsWith('SELECT') ? sql.trim().replace(/^SELECT/i, `SELECT TOP ${maxRows}`) : sql
      : sql;
    const request = this.pool.request();
    (params || []).forEach((p, i) => request.input(`p${i + 1}`, p));
    const result = await request.query(topClause.replace(/:(\d+)/g, '@p$1'));
    const recordset = result.recordset || [];
    return {
      rows: recordset as Record<string, unknown>[],
      metaData: recordset.columns ? Object.keys(recordset.columns).map(k => ({ name: recordset.columns[k].name })) :
        recordset.length > 0 ? Object.keys(recordset[0]).map(k => ({ name: k })) : [],
    };
  }

  async execute(sql: string, params?: SqlParameter[], autoCommit?: boolean): Promise<ExecuteResult> {
    if (!this.pool) throw new Error('SQL Server 连接池未初始化');
    const request = this.pool.request();
    (params || []).forEach((p, i) => request.input(`p${i + 1}`, p));
    const result = await request.query(sql.replace(/:(\d+)/g, '@p$1'));
    return { rowsAffected: result.rowsAffected?.[0] || 0 };
  }

  async callProcedure(name: string, params?: Array<{ name: string; direction: string; type?: string; value?: SqlParameter }>): Promise<ProcedureResult> {
    if (!this.pool) throw new Error('SQL Server 连接池未初始化');
    const request = this.pool.request();
    (params || []).forEach(p => {
      if (p.direction === 'IN' || p.direction === 'IN OUT') {
        request.input(p.name, p.value);
      } else {
        request.output(p.name, mssql.NVarChar, null);
      }
    });
    const result = await request.execute(name);
    const outputParams: Record<string, unknown> = {};
    if (result.output) {
      for (const [k, v] of Object.entries(result.output)) {
        outputParams[k] = v;
      }
    }
    return { outputParams, resultSet: (result.recordset?.[0] || []) as Record<string, unknown>[] };
  }

  async batchExecute(sql: string, paramsList: SqlParameter[][], autoCommit?: boolean): Promise<BatchResult> {
    const result: BatchResult = { totalRows: paramsList.length, successCount: 0, errorCount: 0, errors: [] };
    if (!this.pool) throw new Error('SQL Server 连接池未初始化');
    for (let i = 0; i < paramsList.length; i++) {
      try {
        const request = this.pool.request();
        paramsList[i].forEach((p, j) => request.input(`p${j + 1}`, p));
        await request.query(sql.replace(/:(\d+)/g, '@p$1'));
        result.successCount++;
      } catch (e) {
        result.errorCount++;
        result.errors.push({ index: i, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return result;
  }

  async listTables(schema?: string, pattern?: string): Promise<{ tables: TableInfo[] }> {
    if (!this.pool) throw new Error('SQL Server 连接池未初始化');
    const request = this.pool.request();
    let sql = `SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'`;
    if (schema) { request.input('schema', schema); sql += ' AND TABLE_SCHEMA = @schema'; }
    if (pattern) { request.input('pattern', pattern); sql += ' AND TABLE_NAME LIKE @pattern'; }
    sql += ' ORDER BY TABLE_NAME';
    const result = await request.query(sql);
    return { tables: (result.recordset as any[]).map(r => ({ tableName: r.TABLE_NAME, comments: undefined })) };
  }

  async getTableSchema(tableName: string, schema?: string): Promise<TableSchema> {
    if (!this.pool) throw new Error('SQL Server 连接池未初始化');
    const s = schema || 'dbo';

    const colResult = await this.pool.request()
      .input('schema', s).input('table', tableName)
      .query(`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE,
              IS_NULLABLE, COLUMN_DEFAULT
              FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table ORDER BY ORDINAL_POSITION`);

    const conResult = await this.pool.request()
      .input('schema', s).input('table', tableName)
      .query(`SELECT c.CONSTRAINT_NAME, c.CONSTRAINT_TYPE, k.COLUMN_NAME
              FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS c
              LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k ON c.CONSTRAINT_NAME = k.CONSTRAINT_NAME
              WHERE c.TABLE_SCHEMA = @schema AND c.TABLE_NAME = @table`);

    const idxResult = await this.pool.request()
      .input('schema', s).input('table', tableName)
      .query(`SELECT i.name AS INDEX_NAME, i.is_unique, COL_NAME(c.object_id, c.column_id) AS COLUMN_NAME
              FROM sys.indexes i JOIN sys.tables t ON i.object_id = t.object_id
              JOIN sys.index_columns c ON i.object_id = c.object_id AND i.index_id = c.index_id
              JOIN sys.schemas s ON t.schema_id = s.schema_id
              WHERE s.name = @schema AND t.name = @table ORDER BY i.name, c.key_ordinal`);

    const columns = (colResult.recordset as any[]).map(c => ({
      columnName: c.COLUMN_NAME, dataType: c.DATA_TYPE,
      dataLength: c.CHARACTER_MAXIMUM_LENGTH || undefined,
      dataPrecision: c.NUMERIC_PRECISION || undefined, dataScale: c.NUMERIC_SCALE || undefined,
      nullable: c.IS_NULLABLE === 'YES', dataDefault: c.COLUMN_DEFAULT || undefined,
    }));

    const constraints = (conResult.recordset as any[]).map(c => ({
      constraintName: c.CONSTRAINT_NAME, constraintType: c.CONSTRAINT_TYPE,
      columnName: c.COLUMN_NAME || undefined,
    }));

    const indexMap = new Map<string, { indexName: string; uniqueness: string; columns: string[] }>();
    (idxResult.recordset as any[]).forEach(r => {
      if (!indexMap.has(r.INDEX_NAME)) indexMap.set(r.INDEX_NAME, { indexName: r.INDEX_NAME, uniqueness: r.is_unique ? 'UNIQUE' : 'NONUNIQUE', columns: [] });
      indexMap.get(r.INDEX_NAME)!.columns.push(r.COLUMN_NAME);
    });

    return { tableName, columns, constraints, indexes: Array.from(indexMap.values()) };
  }

  async getTransactionConnection(): Promise<unknown> {
    // SQL Server 使用 pool 的 transaction
    if (!this.pool) throw new Error('SQL Server 连接池未初始化');
    const transaction = this.pool.transaction();
    await transaction.begin();
    return transaction;
  }

  async executeInTransaction(connection: unknown, sql: string, params?: SqlParameter[]): Promise<ExecuteResult> {
    const txn = connection as mssql.Transaction;
    const request = new mssql.Request(txn);
    (params || []).forEach((p, i) => request.input(`p${i + 1}`, p));
    const result = await request.query(sql.replace(/:(\d+)/g, '@p$1'));
    return { rowsAffected: result.rowsAffected?.[0] || 0 };
  }

  async commitTransaction(connection: unknown): Promise<void> {
    await (connection as mssql.Transaction).commit();
  }

  async rollbackTransaction(connection: unknown): Promise<void> {
    await (connection as mssql.Transaction).rollback();
  }

  async closeTransactionConnection(_connection: unknown): Promise<void> {
    // SQL Server transaction 不需要单独关闭
  }

  escapeIdentifier(name: string): string {
    return `[${name}]`;
  }
}
