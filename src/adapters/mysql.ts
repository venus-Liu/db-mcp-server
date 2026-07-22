/**
 * MySQL 数据库适配器
 */

import mysql from 'mysql2/promise';
import type { DatabaseAdapter, SqlParameter, QueryResult, ExecuteResult, ProcedureResult, BatchResult, TableSchema, TableInfo } from './types.js';

export class MySQLAdapter implements DatabaseAdapter {
  readonly type = 'mysql';
  private pool: mysql.Pool | null = null;

  async initialize(config: Record<string, string>): Promise<void> {
    const poolConfig: mysql.PoolOptions = {
      host: config.host || 'localhost',
      port: parseInt(config.port || '3306', 10),
      user: config.user,
      password: config.password,
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4',
    };
    if (config.database) poolConfig.database = config.database;
    this.pool = mysql.createPool(poolConfig);
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
      const fullTable = schema ? `\`${schema}\`.\`${tableName}\`` : `\`${tableName}\``;

      // 列信息（SHOW COLUMNS 兼容所有 MySQL 版本）
      const [cols] = await conn.query(`SHOW COLUMNS FROM ${fullTable}`);
      const columns = (cols as any[]).map(c => ({
        columnName: c.Field,
        dataType: c.Type,
        nullable: c.Null === 'YES',
        dataDefault: c.Default ?? undefined,
        comments: c.Comment || undefined,
      }));

      // 约束信息（用 SHOW CREATE TABLE 解析，兼容所有版本）
      const [createResult] = await conn.query(`SHOW CREATE TABLE ${fullTable}`);
      const createSql = (createResult as any[])[0]['Create Table'] || '';
      const constraints: { constraintName: string; constraintType: string; columnName?: string; rTableName?: string }[] = [];
      // 解析主键
      const pkMatch = createSql.match(/PRIMARY KEY\s*\(([^)]+)\)/i);
      if (pkMatch) {
        const pkCols = pkMatch[1].split(',').map((s: string) => s.trim().replace(/`/g, ''));
        for (const col of pkCols) {
          constraints.push({ constraintName: 'PRIMARY', constraintType: 'PRIMARY KEY', columnName: col });
        }
      }
      // 解析外键
      const fkRegex = /CONSTRAINT\s+`([^`]+)`\s+FOREIGN KEY\s*\(([^)]+)\)\s+REFERENCES\s+`([^`]+)`/gi;
      let fkMatch;
      while ((fkMatch = fkRegex.exec(createSql)) !== null) {
        const fkCols = fkMatch[2].split(',').map(s => s.trim().replace(/`/g, ''));
        for (const col of fkCols) {
          constraints.push({ constraintName: fkMatch[1], constraintType: 'FOREIGN KEY', columnName: col, rTableName: fkMatch[3] });
        }
      }
      // 解析唯一键
      const ukRegex = /UNIQUE KEY\s+`([^`]+)`\s*\(([^)]+)\)/gi;
      let ukMatch;
      while ((ukMatch = ukRegex.exec(createSql)) !== null) {
        const ukCols = ukMatch[2].split(',').map(s => s.trim().replace(/`/g, ''));
        for (const col of ukCols) {
          constraints.push({ constraintName: ukMatch[1], constraintType: 'UNIQUE', columnName: col });
        }
      }

      // 索引信息（SHOW INDEX 兼容所有版本）
      const [idxRows] = await conn.query(`SHOW INDEX FROM ${fullTable}`);
      const indexMap = new Map<string, { indexName: string; uniqueness: string; columns: string[] }>();
      (idxRows as any[]).forEach(r => {
        const idxName = r.Key_name;
        if (idxName === 'PRIMARY') return;
        if (!indexMap.has(idxName)) {
          indexMap.set(idxName, { indexName: idxName, uniqueness: r.Non_unique ? 'NONUNIQUE' : 'UNIQUE', columns: [] });
        }
        indexMap.get(idxName)!.columns.push(r.Column_name);
      });

      return { tableName, columns, constraints, indexes: Array.from(indexMap.values()) };
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
