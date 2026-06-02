/**
 * 工具导出模块
 * 统一导出所有工具定义和实现
 */

// 查询工具
export { queryTool, executeQuery, QueryArgsSchema } from './query.js';
export type { QueryArgs } from './query.js';

// 执行工具
export { executeTool, executeDML, ExecuteArgsSchema } from './execute.js';
export type { ExecuteArgs } from './execute.js';

// 存储过程工具
export { procedureTool, callProcedure, ProcedureArgsSchema } from './procedure.js';
export type { ProcedureArgs } from './procedure.js';

// 事务工具
export {
  transactionTools,
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  executeInTransaction,
  getActiveTransactions,
  cleanupTransactions,
  BeginTransactionArgsSchema,
  CommitTransactionArgsSchema,
  RollbackTransactionArgsSchema,
  TransactionExecuteArgsSchema,
} from './transaction.js';
export type {
  BeginTransactionArgs,
  CommitTransactionArgs,
  RollbackTransactionArgs,
  TransactionExecuteArgs,
} from './transaction.js';

// 批量操作工具
export {
  batchTools,
  batchExecute,
  batchInsert,
  BatchExecuteArgsSchema,
  BatchInsertArgsSchema,
} from './batch.js';
export type { BatchExecuteArgs, BatchInsertArgs } from './batch.js';

// 数据库结构工具
export {
  schemaTools,
  listTables,
  getTableSchema,
  ListTablesArgsSchema,
  GetTableSchemaArgsSchema,
} from './schema.js';
export type { ListTablesArgs, GetTableSchemaArgs } from './schema.js';
