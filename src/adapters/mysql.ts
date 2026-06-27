/**
 * MySQL 数据库适配器
 */

import mysql from 'mysql2/promise';
import type { DatabaseAdapter, SqlParameter, QueryResult, ExecuteResult, ProcedureResult, BatchResult, TableSchema, TableInfo } from './types.js';

export class MySQLAdapter implements DatabaseAdapter {
  readonly type = 'mysql';
  private pool: mysql.Pool | null = null;

  async initialize(config: Record<string, string>): Promise<void> {
    this.pool = mysql.createPool({
      host: config.host || 'localhost',
      port: parseInt(config.port || '3306', 10),
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4',
    });
    console.error('[MySQL] 连接池创建成功');
  }

  async getConnection(): Promise<unknown> {
    if (!this.pool) throw new Error('MySQL 连接池未初始化');
    return await this.pool.getConnection();
  }

  async close(): Promise<void> {
    if (this.pool) { await this.pool.end(); this.pool = null; }
  }

  async query(sql: string, params?: SqlParameter[], maxRows?: number): Promise<QueryResult> {
    const conn = await this.getConnection() as mysql.PoolConnection;
    try {
      const limitClause = maxRows && !sql.toUpperCase().includes('LIMIT') ? ` LIMIT ${maxRows}` : '';
      const [rows, fields] = await conn.query(sql + limitClause, params);
      return {
        rows: rows as Record<string, unknown>[],
        metaData: (fields as mysql.FieldPacket[]).map(f => ({ name: f.name })),
      };
    } finally {
      conn.release();
    }
  }

  async execute(sql: string, params?: SqlParameter[], autoCommit?: boolean): Promise<ExecuteResult> {
    const conn = await this.getConnection() as mysql.PoolConnection;
    try {
      const [result] = await conn.query(sql, params);
      const r = result as mysql.ResultSetHeader;
      return { rowsAffected: r.affectedRows, lastRowid: r.insertId ? String(r.insertId) : undefined };
    } finally {
      conn.release();
    }
  }

  async callProcedure(name: string, params?: Array<{ name: string; direction: string; type?: string; value?: SqlParameter }>): Promise<ProcedureResult> {
    const conn = await this.getConnection() as mysql.PoolConnection;
    try {
      // MySQL 存储过程调用: CALL proc_name(?, ?, ...)
      const inParams = (params || []).filter(p => p.direction === 'IN');
      const placeholders = inParams.map(() => '?').join(', ');
      const values = inParams.map(p => p.value);
      const [rows] = await conn.query(`CALL ${name}(${placeholders})`, values);
      const resultSets = Array.isArray(rows) ? rows : [rows];
      return {
        outputParams: {},
        resultSet: resultSets[0] as Record<string, unknown>[] || [],
      };
    } finally {
      conn.release();
    }
  }

  async batchExecute(sql: string, paramsList: SqlParameter[][], autoCommit?: boolean): Promise<BatchResult> {
    const result: BatchResult = { totalRows: paramsList.length, successCount: 0, errorCount: 0, errors: [] };
    const conn = await this.getConnection() as mysql.PoolConnection;
    try {
      for (let i = 0; i < paramsList.length; i++) {
        try {
          const [r] = await conn.query(sql, paramsList[i]);
          result.successCount++;
        } catch (e) {
          result.errorCount++;
          result.errors.push({ index: i, error: e instanceof Error ? e.message : String(e) });
        }
      }
    } finally {
      conn.release();
    }
    return result;
  }

  async listTables(schema?: string, pattern?: string): Promise<{ tables: TableInfo[] }> {
    const conn = await this.getConnection() as mysql.PoolConnection;
    try {
      let sql = 'SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()';
      if (schema) sql += ` AND TABLE_SCHEMA = ?`;
      if (pattern) sql += ' AND TABLE_NAME LIKE ?';
      sql += ' ORDER BY TABLE_NAME';
      const params: string[] = [];
      if (schema) params.push(schema);
      if (pattern) params.push(pattern);
      const [rows] = await conn.query(sql, params);
      const tables = (rows as any[]).map(r => ({ tableName: r.TABLE_NAME, comments: r.TABLE_COMMENT || undefined }));
      return { tables };
    } finally {
      conn.release();
    }
  }

  async getTableSchema(tableName: string, schema?: string): Promise<TableSchema> {
    const conn = await this.getConnection() as mysql.PoolConnection;
    try {
      const db = schema || (await conn.query('SELECT DATABASE() as db') as any[])[0][0].db;

      // 列信息
      const [cols] = await conn.query(
        `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE,
                IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [db, tableName]
      );
      const columns = (cols as any[]).map(c => ({
        columnName: c.COLUMN_NAME, dataType: c.DATA_TYPE,
        dataLength: c.CHARACTER_MAXIMUM_LENGTH || undefined,
        dataPrecision: c.NUMERIC_PRECISION || undefined, dataScale: c.NUMERIC_SCALE || undefined,
        nullable: c.IS_NULLABLE === 'YES', dataDefault: c.COLUMN_DEFAULT || undefined,
        comments: c.COLUMN_COMMENT || undefined,
      }));

      // 约束信息
      const [constraints] = await conn.query(
        `SELECT c.CONSTRAINT_NAME, c.CONSTRAINT_TYPE, k.COLUMN_NAME, c.CHECK_CLAUSE,
                k.REFERENCED_TABLE_NAME
         FROM information_schema.TABLE_CONSTRAINTS c
         LEFT JOIN information_schema.KEY_COLUMN_USAGE k ON c.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND c.TABLE_SCHEMA = k.TABLE_SCHEMA
         WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ? ORDER BY c.CONSTRAINT_NAME`,
        [db, tableName]
      );
      const constraintList = (constraints as any[]).map(c => ({
        constraintName: c.CONSTRAINT_NAME, constraintType: c.CONSTRAINT_TYPE,
        columnName: c.COLUMN_NAME || undefined, searchCondition: c.CHECK_CLAUSE || undefined,
        rTableName: c.REFERENCED_TABLE_NAME || undefined,
      }));

      // 索引信息
      const [indexes] = await conn.query(
        `SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME != 'PRIMARY'
         ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        [db, tableName]
      );
      const indexMap = new Map<string, { indexName: string; uniqueness: string; columns: string[] }>();
      (indexes as any[]).forEach(r => {
        if (!indexMap.has(r.INDEX_NAME)) indexMap.set(r.INDEX_NAME, { indexName: r.INDEX_NAME, uniqueness: r.NON_UNIQUE ? 'NONUNIQUE' : 'UNIQUE', columns: [] });
        indexMap.get(r.INDEX_NAME)!.columns.push(r.COLUMN_NAME);
      });

      return { tableName, columns, constraints: constraintList, indexes: Array.from(indexMap.values()) };
    } finally {
      conn.release();
    }
  }

  async getTransactionConnection(): Promise<unknown> {
    if (!this.pool) throw new Error('MySQL 连接池未初始化');
    const conn = await this.pool.getConnection();
    await conn.beginTransaction();
    return conn;
  }

  async executeInTransaction(connection: unknown, sql: string, params?: SqlParameter[]): Promise<ExecuteResult> {
    const conn = connection as mysql.PoolConnection;
    const [result] = await conn.query(sql, params);
    const r = result as mysql.ResultSetHeader;
    return { rowsAffected: r.affectedRows, lastRowid: r.insertId ? String(r.insertId) : undefined };
  }

  async commitTransaction(connection: unknown): Promise<void> {
    await (connection as mysql.PoolConnection).commit();
    (connection as mysql.PoolConnection).release();
  }

  async rollbackTransaction(connection: unknown): Promise<void> {
    await (connection as mysql.PoolConnection).rollback();
    (connection as mysql.PoolConnection).release();
  }

  async closeTransactionConnection(connection: unknown): Promise<void> {
    (connection as mysql.PoolConnection).release();
  }

  escapeIdentifier(name: string): string {
    return `\`${name}\``;
  }
}
