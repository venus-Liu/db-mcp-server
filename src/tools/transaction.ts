/**
 * 事务管理工具模块
 * 提供事务的开始、提交和回滚功能
 */

import { z } from 'zod';
import oracledb from 'oracledb';
import { getConnection } from '../db.js';
import { Transaction, SqlParameter } from '../types.js';

// 存储活跃事务
const activeTransactions = new Map<string, Transaction>();

/**
 * 开始事务参数定义
 */
export const BeginTransactionArgsSchema = z.object({
  transactionId: z.string().optional().describe('事务ID，如果不提供则自动生成'),
});

export type BeginTransactionArgs = z.infer<typeof BeginTransactionArgsSchema>;

/**
 * 提交事务参数定义
 */
export const CommitTransactionArgsSchema = z.object({
  transactionId: z.string().describe('要提交的事务ID'),
});

export type CommitTransactionArgs = z.infer<typeof CommitTransactionArgsSchema>;

/**
 * 回滚事务参数定义
 */
export const RollbackTransactionArgsSchema = z.object({
  transactionId: z.string().describe('要回滚的事务ID'),
});

export type RollbackTransactionArgs = z.infer<typeof RollbackTransactionArgsSchema>;

/**
 * 事务内执行参数定义
 */
export const TransactionExecuteArgsSchema = z.object({
  transactionId: z.string().describe('事务ID'),
  sql: z.string().describe('要执行的 SQL 语句'),
  params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().describe('SQL 参数数组'),
});

export type TransactionExecuteArgs = z.infer<typeof TransactionExecuteArgsSchema>;

/**
 * 事务管理工具定义
 */
export const transactionTools = {
  begin: {
    name: 'oracle_begin_transaction',
    description: '开始一个新的事务，返回事务ID用于后续操作',
    inputSchema: {
      type: 'object' as const,
      properties: {
        transactionId: {
          type: 'string',
          description: '事务ID，如果不提供则自动生成（可选）',
        },
      },
      required: [],
    },
  },
  commit: {
    name: 'oracle_commit_transaction',
    description: '提交指定的事务',
    inputSchema: {
      type: 'object' as const,
      properties: {
        transactionId: {
          type: 'string',
          description: '要提交的事务ID',
        },
      },
      required: ['transactionId'],
    },
  },
  rollback: {
    name: 'oracle_rollback_transaction',
    description: '回滚指定的事务',
    inputSchema: {
      type: 'object' as const,
      properties: {
        transactionId: {
          type: 'string',
          description: '要回滚的事务ID',
        },
      },
      required: ['transactionId'],
    },
  },
  execute: {
    name: 'oracle_transaction_execute',
    description: '在指定事务中执行 SQL 语句',
    inputSchema: {
      type: 'object' as const,
      properties: {
        transactionId: {
          type: 'string',
          description: '事务ID',
        },
        sql: {
          type: 'string',
          description: '要执行的 SQL 语句',
        },
        params: {
          type: 'array',
          items: {
            type: ['string', 'number', 'boolean', 'null'],
          },
          description: 'SQL 参数数组（可选）',
        },
      },
      required: ['transactionId', 'sql'],
    },
  },
};

/**
 * 开始新事务
 * @param args 开始事务参数
 * @returns 事务ID
 */
export async function beginTransaction(args: BeginTransactionArgs): Promise<{ transactionId: string }> {
  const transactionId = args.transactionId || `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  if (activeTransactions.has(transactionId)) {
    throw new Error(`事务ID "${transactionId}" 已存在`);
  }

  const connection = await getConnection();

  const transaction: Transaction = {
    id: transactionId,
    connection,
    startTime: new Date(),
  };

  activeTransactions.set(transactionId, transaction);
  console.error(`[Oracle Transaction] 事务开始: ${transactionId}`);

  return { transactionId };
}

/**
 * 提交事务
 * @param args 提交事务参数
 */
export async function commitTransaction(args: CommitTransactionArgs): Promise<{ success: boolean; rowsAffected: number }> {
  const { transactionId } = args;
  const transaction = activeTransactions.get(transactionId);

  if (!transaction) {
    throw new Error(`事务ID "${transactionId}" 不存在或已关闭`);
  }

  try {
    // 获取事务中执行的行数
    const rowsAffected = 0; // Oracle 不直接提供这个信息
    
    await transaction.connection.commit();
    console.error(`[Oracle Transaction] 事务提交: ${transactionId}`);

    return { success: true, rowsAffected };
  } catch (error) {
    console.error(`[Oracle Transaction] 提交失败: ${transactionId}`, error);
    throw new Error(`事务提交失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // 关闭连接并从活跃事务中移除
    try {
      await transaction.connection.close();
    } catch (closeError) {
      console.error('[Oracle Transaction] 关闭连接失败:', closeError);
    }
    activeTransactions.delete(transactionId);
  }
}

/**
 * 回滚事务
 * @param args 回滚事务参数
 */
export async function rollbackTransaction(args: RollbackTransactionArgs): Promise<{ success: boolean }> {
  const { transactionId } = args;
  const transaction = activeTransactions.get(transactionId);

  if (!transaction) {
    throw new Error(`事务ID "${transactionId}" 不存在或已关闭`);
  }

  try {
    await transaction.connection.rollback();
    console.error(`[Oracle Transaction] 事务回滚: ${transactionId}`);

    return { success: true };
  } catch (error) {
    console.error(`[Oracle Transaction] 回滚失败: ${transactionId}`, error);
    throw new Error(`事务回滚失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // 关闭连接并从活跃事务中移除
    try {
      await transaction.connection.close();
    } catch (closeError) {
      console.error('[Oracle Transaction] 关闭连接失败:', closeError);
    }
    activeTransactions.delete(transactionId);
  }
}

/**
 * 在事务中执行 SQL
 * @param args 事务执行参数
 * @returns 执行结果
 */
export async function executeInTransaction(args: TransactionExecuteArgs): Promise<{ rowsAffected: number; lastRowid?: string }> {
  const { transactionId, sql, params = [] } = args;
  const transaction = activeTransactions.get(transactionId);

  if (!transaction) {
    throw new Error(`事务ID "${transactionId}" 不存在或已关闭`);
  }

  try {
    const result = await transaction.connection.execute(
      sql,
      params as SqlParameter[]
    );

    return {
      rowsAffected: result.rowsAffected || 0,
      lastRowid: result.lastRowid,
    };
  } catch (error) {
    console.error(`[Oracle Transaction] 执行失败: ${transactionId}`, error);
    throw new Error(`事务内执行失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 获取活跃事务列表
 * @returns 活跃事务信息
 */
export function getActiveTransactions(): Array<{ id: string; startTime: Date }> {
  return Array.from(activeTransactions.values()).map(tx => ({
    id: tx.id,
    startTime: tx.startTime,
  }));
}

/**
 * 清理所有活跃事务（用于服务器关闭时）
 */
export async function cleanupTransactions(): Promise<void> {
  for (const [id, transaction] of activeTransactions) {
    try {
      await transaction.connection.rollback();
      await transaction.connection.close();
      console.error(`[Oracle Transaction] 清理事务: ${id}`);
    } catch (error) {
      console.error(`[Oracle Transaction] 清理事务失败: ${id}`, error);
    }
  }
  activeTransactions.clear();
}
