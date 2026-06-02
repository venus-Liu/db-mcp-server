/**
 * 批量操作工具模块
 * 提供批量插入、更新和删除功能
 */

import { z } from 'zod';
import oracledb from 'oracledb';
import { getConnection } from '../db.js';
import { BatchResult, SqlParameter } from '../types.js';

/**
 * 批量操作参数定义
 */
export const BatchExecuteArgsSchema = z.object({
  sql: z.string().describe('要执行的 SQL 语句模板'),
  paramsList: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).describe('参数数组列表，每个元素是一组参数'),
  batchSize: z.number().optional().describe('每批处理的记录数，默认 1000'),
  autoCommit: z.boolean().optional().describe('是否自动提交，默认为 true'),
});

export type BatchExecuteArgs = z.infer<typeof BatchExecuteArgsSchema>;

/**
 * 批量插入参数定义
 */
export const BatchInsertArgsSchema = z.object({
  table: z.string().describe('目标表名'),
  columns: z.array(z.string()).describe('列名数组'),
  values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).describe('值数组，每行是一个数组'),
  batchSize: z.number().optional().describe('每批处理的记录数，默认 1000'),
  autoCommit: z.boolean().optional().describe('是否自动提交，默认为 true'),
});

export type BatchInsertArgs = z.infer<typeof BatchInsertArgsSchema>;

/**
 * 批量操作工具定义
 */
export const batchTools = {
  execute: {
    name: 'oracle_batch_execute',
    description: '批量执行 SQL 语句。适用于批量 INSERT、UPDATE、DELETE 操作。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sql: {
          type: 'string',
          description: '要执行的 SQL 语句模板',
        },
        paramsList: {
          type: 'array',
          items: {
            type: 'array',
            items: {
              type: ['string', 'number', 'boolean', 'null'],
            },
          },
          description: '参数数组列表，每个元素是一组参数',
        },
        batchSize: {
          type: 'number',
          description: '每批处理的记录数，默认 1000（可选）',
        },
        autoCommit: {
          type: 'boolean',
          description: '是否自动提交，默认为 true（可选）',
        },
      },
      required: ['sql', 'paramsList'],
    },
  },
  insert: {
    name: 'oracle_batch_insert',
    description: '批量插入数据到指定表。自动生成 INSERT 语句。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        table: {
          type: 'string',
          description: '目标表名',
        },
        columns: {
          type: 'array',
          items: { type: 'string' },
          description: '列名数组',
        },
        values: {
          type: 'array',
          items: {
            type: 'array',
            items: {
              type: ['string', 'number', 'boolean', 'null'],
            },
          },
          description: '值数组，每行是一个数组',
        },
        batchSize: {
          type: 'number',
          description: '每批处理的记录数，默认 1000（可选）',
        },
        autoCommit: {
          type: 'boolean',
          description: '是否自动提交，默认为 true（可选）',
        },
      },
      required: ['table', 'columns', 'values'],
    },
  },
};

/**
 * 批量执行 SQL
 * @param args 批量执行参数
 * @returns 批量执行结果
 */
export async function batchExecute(args: BatchExecuteArgs): Promise<BatchResult> {
  const { sql, paramsList, batchSize = 1000, autoCommit = true } = args;
  let connection: oracledb.Connection | undefined;

  const result: BatchResult = {
    totalRows: paramsList.length,
    successCount: 0,
    errorCount: 0,
    errors: [],
  };

  try {
    connection = await getConnection();
    connection.autoCommit = autoCommit;

    // 分批处理
    for (let i = 0; i < paramsList.length; i += batchSize) {
      const batch = paramsList.slice(i, i + batchSize);
      
      try {
        const batchResult = await connection.executeMany(
          sql,
          batch as SqlParameter[][],
          {
            autoCommit: false, // 每批不自动提交，最后统一提交
          }
        );
        
        result.successCount += batchResult.rowsAffected || batch.length;
      } catch (batchError) {
        // 如果批量执行失败，尝试逐条执行以识别具体错误
        for (let j = 0; j < batch.length; j++) {
          try {
            await connection.execute(sql, batch[j] as SqlParameter[]);
            result.successCount++;
          } catch (itemError) {
            result.errorCount++;
            result.errors.push({
              index: i + j,
              error: itemError instanceof Error ? itemError.message : String(itemError),
            });
          }
        }
      }
    }

    // 如果没有自动提交，手动提交
    if (!autoCommit) {
      await connection.commit();
    }

    return result;
  } catch (error) {
    console.error('[Oracle Batch] 批量执行失败:', error);
    throw new Error(`批量执行失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error('[Oracle Batch] 关闭连接失败:', closeError);
      }
    }
  }
}

/**
 * 批量插入数据
 * @param args 批量插入参数
 * @returns 批量插入结果
 */
export async function batchInsert(args: BatchInsertArgs): Promise<BatchResult> {
  const { table, columns, values, batchSize = 1000, autoCommit = true } = args;

  // 构建 INSERT 语句
  const columnNames = columns.join(', ');
  const placeholders = columns.map((_, i) => `:${i + 1}`).join(', ');
  const sql = `INSERT INTO ${table} (${columnNames}) VALUES (${placeholders})`;

  return batchExecute({
    sql,
    paramsList: values,
    batchSize,
    autoCommit,
  });
}
