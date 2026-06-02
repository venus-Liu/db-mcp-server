/**
 * 执行工具模块
 * 提供执行 DML 语句（INSERT/UPDATE/DELETE）的功能
 */

import { z } from 'zod';
import oracledb from 'oracledb';
import { getConnection } from '../db.js';
import { ExecuteResult, SqlParameter } from '../types.js';

/**
 * 执行工具参数定义
 */
export const ExecuteArgsSchema = z.object({
  sql: z.string().describe('要执行的 SQL 语句（INSERT/UPDATE/DELETE）'),
  params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().describe('SQL 参数数组'),
  autoCommit: z.boolean().optional().describe('是否自动提交，默认为 true'),
});

export type ExecuteArgs = z.infer<typeof ExecuteArgsSchema>;

/**
 * 执行工具定义
 */
export const executeTool = {
  name: 'oracle_execute',
  description: '执行 DML 语句（INSERT、UPDATE、DELETE）。支持参数绑定和自动提交控制。',
  inputSchema: {
    type: 'object' as const,
    properties: {
      sql: {
        type: 'string',
        description: '要执行的 SQL 语句（INSERT/UPDATE/DELETE）',
      },
      params: {
        type: 'array',
        items: {
          type: ['string', 'number', 'boolean', 'null'],
        },
        description: 'SQL 参数数组（可选）',
      },
      autoCommit: {
        type: 'boolean',
        description: '是否自动提交，默认为 true（可选）',
      },
    },
    required: ['sql'],
  },
};

/**
 * 执行 DML 语句
 * @param args 执行参数
 * @returns 执行结果
 */
export async function executeDML(args: ExecuteArgs): Promise<ExecuteResult> {
  const { sql, params = [], autoCommit = true } = args;
  let connection: oracledb.Connection | undefined;

  try {
    connection = await getConnection();
    
    const result = await connection.execute(
      sql,
      params as SqlParameter[],
      { autoCommit }
    );

    return {
      rowsAffected: result.rowsAffected || 0,
      lastRowid: result.lastRowid,
    };
  } catch (error) {
    console.error('[Oracle Execute] 执行失败:', error);
    throw new Error(`SQL 执行失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error('[Oracle Execute] 关闭连接失败:', closeError);
      }
    }
  }
}
