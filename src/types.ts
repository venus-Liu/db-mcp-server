/**
 * 类型定义模块
 * 定义所有工具使用的类型和接口
 */

/**
 * SQL 查询参数类型
 */
export type SqlParameter = string | number | Date | boolean | null | Buffer;

/**
 * 查询结果接口
 */
export interface QueryResult {
  rows: Record<string, unknown>[];
  metaData: Array<{ name: string }>;
  rowsAffected?: number;
}

/**
 * 执行结果接口
 */
export interface ExecuteResult {
  rowsAffected: number;
  lastRowid?: string;
}

/**
 * 存储过程参数方向
 */
export type BindDirection = 'IN' | 'OUT' | 'IN OUT';

/**
 * 存储过程参数
 */
export interface ProcedureParameter {
  name: string;
  direction: BindDirection;
  type?: string;
  value?: SqlParameter;
}

/**
 * 存储过程调用结果
 */
export interface ProcedureResult {
  outputParams: Record<string, unknown>;
  resultSet?: Record<string, unknown>[];
}

/**
 * 事务状态
 */
export interface Transaction {
  id: string;
  connection: import('oracledb').Connection;
  startTime: Date;
}

/**
 * 批量操作配置
 */
export interface BatchOptions {
  batchSize?: number;
  autoCommit?: boolean;
}

/**
 * 批量操作结果
 */
export interface BatchResult {
  totalRows: number;
  successCount: number;
  errorCount: number;
  errors: Array<{ index: number; error: string }>;
}
