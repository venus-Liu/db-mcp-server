/**
 * Oracle 数据库适配器
 * 将现有 Oracle 逻辑封装为统一适配器接口
 */

import oracledb from 'oracledb';
import type { DatabaseAdapter, SqlParameter, QueryResult, ExecuteResult, ProcedureResult, BatchResult, TableSchema, TableInfo, ColumnInfo, ConstraintInfo, IndexInfo } from './types.js';

export class OracleAdapter implements DatabaseAdapter {
  readonly type = 'oracle';
  private pool: oracledb.Pool | null = null;

  async initialize(config: Record<string, string>): Promise<void> {
    const clientPath = config.clientPath;
    if (clientPath) {
      oracledb.initOracleClient({ libDir: clientPath });
    } else {
      oracledb.initOracleClient();
    }

    this.pool = await oracledb.createPool({
      user: config.user,
      password: config.password,
      connectString: config.connectString,
      poolMin: parseInt(config.poolMin || '2', 10),
      poolMax: parseInt(config.poolMax || '10', 10),
      poolIncrement: parseInt(config.poolIncrement || '1', 10),
    });
    console.error('[Oracle] 连接池创建成功');
  }

  async getConnection(): Promise<unknown> {
    if (!this.pool) throw new Error('Oracle 连接池未初始化');
    return await this.pool.getConnection();
  }

  async close(): Promise<void> {
    if (this.pool) { await this.pool.close(0); this.pool = null; }
  }

  async query(sql: string, params?: SqlParameter[], maxRows?: number): Promise<QueryResult> {
    const conn = await this.getConnection() as oracledb.Connection;
    try {
      const result = await conn.execute(sql, params || [], { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows });
      return {
        rows: (result.rows as Record<string, unknown>[]) || [],
        metaData: (result.metaData as Array<{ name: string }>) || [],
        rowsAffected: result.rowsAffected,
      };
    } finally {
      await conn.close();
    }
  }

  async execute(sql: string, params?: SqlParameter[], autoCommit?: boolean): Promise<ExecuteResult> {
    const conn = await this.getConnection() as oracledb.Connection;
    try {
      const result = await conn.execute(sql, params || [], { autoCommit });
      return { rowsAffected: result.rowsAffected || 0, lastRowid: result.lastRowid };
    } finally {
      await conn.close();
    }
  }

  async callProcedure(name: string, params?: Array<{ name: string; direction: string; type?: string; value?: SqlParameter }>, hasCursor?: boolean): Promise<ProcedureResult> {
    const conn = await this.getConnection() as oracledb.Connection;
    try {
      const binds: Record<string, oracledb.BindParameter> = {};
      const outParams: string[] = [];

      for (const param of (params || [])) {
        const bindDef: oracledb.BindParameter = { dir: oracledb.BIND_IN };
        if (param.direction === 'IN') {
          bindDef.val = param.value; bindDef.type = this.getOracleType(param.type);
        } else if (param.direction === 'OUT') {
          bindDef.dir = oracledb.BIND_OUT; bindDef.type = this.getOracleType(param.type); outParams.push(param.name);
        } else {
          bindDef.dir = oracledb.BIND_INOUT; bindDef.val = param.value; bindDef.type = this.getOracleType(param.type); outParams.push(param.name);
        }
        binds[param.name] = bindDef;
      }

      if (hasCursor) { binds['cursor'] = { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_CURSOR }; outParams.push('cursor'); }

      const paramNames = Object.keys(binds).join(', :');
      const result = await conn.execute(`BEGIN ${name}(:${paramNames}); END;`, binds);

      const outputParams: Record<string, unknown> = {};
      let resultSet: Record<string, unknown>[] | undefined;
      if (result.outBinds) {
        for (const pName of outParams) {
          const value = (result.outBinds as Record<string, unknown>)[pName];
          if (pName === 'cursor' && value && typeof value === 'object' && 'getRows' in value) {
            const cursor = value as oracledb.ResultSet<unknown>;
            try { resultSet = await cursor.getRows() as Record<string, unknown>[]; } finally { await cursor.close(); }
          } else { outputParams[pName] = value; }
        }
      }
      return { outputParams, resultSet };
    } finally {
      await conn.close();
    }
  }

  async batchExecute(sql: string, paramsList: SqlParameter[][], autoCommit?: boolean): Promise<BatchResult> {
    const result: BatchResult = { totalRows: paramsList.length, successCount: 0, errorCount: 0, errors: [] };
    const conn = await this.getConnection() as oracledb.Connection;
    try {
      for (let i = 0; i < paramsList.length; i++) {
        try { await conn.execute(sql, paramsList[i], { autoCommit }); result.successCount++; }
        catch (e) { result.errorCount++; result.errors.push({ index: i, error: e instanceof Error ? e.message : String(e) }); }
      }
    } finally { await conn.close(); }
    return result;
  }

  async listTables(schema?: string, pattern?: string): Promise<{ tables: TableInfo[] }> {
    const conn = await this.getConnection() as oracledb.Connection;
    try {
      let sql = 'SELECT t.table_name, c.comments FROM user_tables t LEFT JOIN user_tab_comments c ON t.table_name = c.table_name WHERE 1=1';
      const params: string[] = [];
      if (schema) {
        sql = sql.replace(/user_tables/g, 'all_tables').replace(/user_tab_comments/g, 'all_tab_comments');
        sql += ' AND owner = :1'; params.push(schema.toUpperCase());
      }
      if (pattern) { sql += ` AND t.table_name LIKE :${params.length + 1}`; params.push(pattern.toUpperCase()); }
      sql += ' ORDER BY t.table_name';
      const result = await conn.execute(sql, params, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return { tables: (result.rows as any[]).map(r => ({ tableName: r.TABLE_NAME, comments: r.COMMENTS || undefined })) };
    } finally { await conn.close(); }
  }

  async getTableSchema(tableName: string, schema?: string): Promise<TableSchema> {
    const conn = await this.getConnection() as oracledb.Connection;
    try {
      const owner = schema ? schema.toUpperCase() : null;
      const table = tableName.toUpperCase();

      const colsSql = owner
        ? `SELECT c.column_name, c.data_type, c.data_length, c.data_precision, c.data_scale, c.nullable, c.data_default, cc.comments FROM all_tab_columns c LEFT JOIN all_col_comments cc ON c.owner = cc.owner AND c.table_name = cc.table_name AND c.column_name = cc.column_name WHERE c.owner = :1 AND c.table_name = :2 ORDER BY c.column_id`
        : `SELECT c.column_name, c.data_type, c.data_length, c.data_precision, c.data_scale, c.nullable, c.data_default, cc.comments FROM user_tab_columns c LEFT JOIN user_col_comments cc ON c.table_name = cc.table_name AND c.column_name = cc.column_name WHERE c.table_name = :1 ORDER BY c.column_id`;

      const columnsResult = await conn.execute(colsSql, owner ? [owner, table] : [table], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const columns: ColumnInfo[] = (columnsResult.rows as any[]).map(r => ({
        columnName: r.COLUMN_NAME, dataType: r.DATA_TYPE, dataLength: r.DATA_LENGTH,
        dataPrecision: r.DATA_PRECISION || undefined, dataScale: r.DATA_SCALE || undefined,
        nullable: r.NULLABLE === 'Y', dataDefault: r.DATA_DEFAULT || undefined, comments: r.COMMENTS || undefined,
      }));

      const conSql = owner
        ? `SELECT c.constraint_name, c.constraint_type, cc.column_name, c.r_table_name FROM all_constraints c LEFT JOIN all_cons_columns cc ON c.owner = cc.owner AND c.constraint_name = cc.constraint_name WHERE c.owner = :1 AND c.table_name = :2 ORDER BY c.constraint_name, cc.position`
        : `SELECT c.constraint_name, c.constraint_type, cc.column_name, c.r_table_name FROM user_constraints c LEFT JOIN user_cons_columns cc ON c.constraint_name = cc.constraint_name WHERE c.table_name = :1 ORDER BY c.constraint_name, cc.position`;

      const conResult = await conn.execute(conSql, owner ? [owner, table] : [table], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const constraints: ConstraintInfo[] = (conResult.rows as any[]).map(r => ({
        constraintName: r.CONSTRAINT_NAME, constraintType: r.CONSTRAINT_TYPE,
        columnName: r.COLUMN_NAME || undefined, rTableName: r.R_TABLE_NAME || undefined,
      }));

      const idxSql = owner
        ? `SELECT i.index_name, i.uniqueness, ic.column_name FROM all_indexes i JOIN all_ind_columns ic ON i.owner = ic.index_owner AND i.index_name = ic.index_name WHERE i.table_owner = :1 AND i.table_name = :2 ORDER BY i.index_name, ic.column_position`
        : `SELECT i.index_name, i.uniqueness, ic.column_name FROM user_indexes i JOIN user_ind_columns ic ON i.index_name = ic.index_name WHERE i.table_name = :1 ORDER BY i.index_name, ic.column_position`;

      const idxResult = await conn.execute(idxSql, owner ? [owner, table] : [table], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const indexMap = new Map<string, IndexInfo>();
      (idxResult.rows as any[]).forEach(r => {
        if (!indexMap.has(r.INDEX_NAME)) indexMap.set(r.INDEX_NAME, { indexName: r.INDEX_NAME, uniqueness: r.UNIQUENESS, columns: [] });
        indexMap.get(r.INDEX_NAME)!.columns.push(r.COLUMN_NAME);
      });

      return { tableName: table, columns, constraints, indexes: Array.from(indexMap.values()) };
    } finally { await conn.close(); }
  }

  async getTransactionConnection(): Promise<unknown> {
    const conn = await this.getConnection() as oracledb.Connection;
    return conn;
  }

  async executeInTransaction(connection: unknown, sql: string, params?: SqlParameter[]): Promise<ExecuteResult> {
    const result = await (connection as oracledb.Connection).execute(sql, params || [], { autoCommit: false });
    return { rowsAffected: result.rowsAffected || 0, lastRowid: result.lastRowid };
  }

  async commitTransaction(connection: unknown): Promise<void> {
    await (connection as oracledb.Connection).commit();
    await (connection as oracledb.Connection).close();
  }

  async rollbackTransaction(connection: unknown): Promise<void> {
    await (connection as oracledb.Connection).rollback();
    await (connection as oracledb.Connection).close();
  }

  async closeTransactionConnection(connection: unknown): Promise<void> {
    await (connection as oracledb.Connection).close();
  }

  escapeIdentifier(name: string): string {
    return `"${name}"`;
  }

  private getOracleType(type?: string): oracledb.DbType {
    if (!type) return oracledb.DB_TYPE_VARCHAR;
    switch (type.toUpperCase()) {
      case 'NUMBER': return oracledb.DB_TYPE_NUMBER;
      case 'DATE': case 'TIMESTAMP': return oracledb.DB_TYPE_TIMESTAMP;
      case 'CURSOR': return oracledb.DB_TYPE_CURSOR;
      case 'CLOB': return oracledb.DB_TYPE_CLOB;
      case 'BLOB': return oracledb.DB_TYPE_BLOB;
      default: return oracledb.DB_TYPE_VARCHAR;
    }
  }
}
