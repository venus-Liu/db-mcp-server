/**
 * 数据库适配器抽象接口
 * 定义所有数据库驱动必须实现的统一接口
 */

export type SqlParameter = string | number | Date | boolean | null | Buffer;

export interface QueryResult {
  rows: Record<string, unknown>[];
  metaData: Array<{ name: string }>;
  rowsAffected?: number;
}

export interface ExecuteResult {
  rowsAffected: number;
  lastRowid?: string;
}

export interface ProcedureResult {
  outputParams: Record<string, unknown>;
  resultSet?: Record<string, unknown>[];
}

export interface BatchResult {
  totalRows: number;
  successCount: number;
  errorCount: number;
  errors: Array<{ index: number; error: string }>;
}

export interface TableInfo {
  tableName: string;
  comments?: string;
}

export interface ColumnInfo {
  columnName: string;
  dataType: string;
  dataLength?: number;
  dataPrecision?: number;
  dataScale?: number;
  nullable: boolean;
  dataDefault?: string;
  comments?: string;
}

export interface ConstraintInfo {
  constraintName: string;
  constraintType: string;  // P=主键, R=外键, U=唯一, C=检查
  columnName?: string;
  searchCondition?: string;
  rTableName?: string;
}

export interface IndexInfo {
  indexName: string;
  uniqueness: string;
  columns: string[];
}

export interface TableSchema {
  tableName: string;
  columns: ColumnInfo[];
  constraints: ConstraintInfo[];
  indexes: IndexInfo[];
}

/**
 * 数据库适配器接口
 * 每种数据库驱动需要实现此接口
 */
export interface DatabaseAdapter {
  /** 数据库类型标识 */
  readonly type: string;

  /** 初始化连接 */
  initialize(config: Record<string, string>): Promise<void>;

  /** 获取原生连接 */
  getConnection(): Promise<unknown>;

  /** 关闭连接 */
  close(): Promise<void>;

  /** 执行查询 */
  query(sql: string, params?: SqlParameter[], maxRows?: number): Promise<QueryResult>;

  /** 执行 DML */
  execute(sql: string, params?: SqlParameter[], autoCommit?: boolean): Promise<ExecuteResult>;

  /** 调用存储过程 */
  callProcedure(name: string, params?: Array<{ name: string; direction: string; type?: string; value?: SqlParameter }>, hasCursor?: boolean): Promise<ProcedureResult>;

  /** 批量执行 */
  batchExecute(sql: string, paramsList: SqlParameter[][], autoCommit?: boolean): Promise<BatchResult>;

  /** 获取表列表 */
  listTables(schema?: string, pattern?: string): Promise<{ tables: TableInfo[] }>;

  /** 获取表结构 */
  getTableSchema(tableName: string, schema?: string): Promise<TableSchema>;

  /** 获取事务连接（用于事务管理） */
  getTransactionConnection(): Promise<unknown>;

  /** 事务中执行 */
  executeInTransaction(connection: unknown, sql: string, params?: SqlParameter[]): Promise<ExecuteResult>;

  /** 提交事务 */
  commitTransaction(connection: unknown): Promise<void>;

  /** 回滚事务 */
  rollbackTransaction(connection: unknown): Promise<void>;

  /** 关闭事务连接 */
  closeTransactionConnection(connection: unknown): Promise<void>;

  /** 转义标识符（表名、列名） */
  escapeIdentifier(name: string): string;
}
