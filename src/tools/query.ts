/**
 * 查询工具模块
 * 提供执行 SQL 查询的功能
 */

import { z } from 'zod';
import oracledb from 'oracledb';
import { getConnection } from '../db.js';
import { QueryResult, SqlParameter } from '../types.js';

/**
 * 查询工具参数定义
 */
export const QueryArgsSchema = z.object({
  sql: z.string().describe('要执行的 SQL 查询语句'),
  params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().describe('查询参数数组'),
  maxRows: z.number().optional().describe('最大返回行数，默认 1000'),
});

export type QueryArgs = z.infer<typeof QueryArgsSchema>;

/**
 * 查询工具定义
 */
export const queryTool = {
  name: 'oracle_query',
  description: '执行 SQL 查询语句并返回结果。支持 SELECT 语句和带返回结果的存储过程。',
  inputSchema: {
    type: 'object' as const,
    properties: {
      sql: {
        type: 'string',
        description: '要执行的 SQL 查询语句',
      },
      params: {
        type: 'array',
        items: {
          type: ['string', 'number', 'boolean', 'null'],
        },
        description: '查询参数数组（可选）',
      },
      maxRows: {
        type: 'number',
        description: '最大返回行数，默认 1000（可选）',
      },
    },
    required: ['sql'],
  },
};

/**
 * 执行查询
 * @param args 查询参数
 * @returns 查询结果
 */
export async function executeQuery(args: QueryArgs): Promise<QueryResult> {
  const { sql, params = [], maxRows = 1000 } = args;
  let connection: oracledb.Connection | undefined;

  try {
    connection = await getConnection();
    
    const result = await connection.execute(
      sql,
      params as SqlParameter[],
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        maxRows,
      }
    );

    return {
      rows: (result.rows as Record<string, unknown>[]) || [],
      metaData: (result.metaData as Array<{ name: string }>) || [],
      rowsAffected: result.rowsAffected,
    };
  } catch (error) {
    console.error('[Oracle Query] 查询失败:', error);
    throw new Error(`查询执行失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error('[Oracle Query] 关闭连接失败:', closeError);
      }
    }
  }
}
