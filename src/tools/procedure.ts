/**
 * 存储过程调用工具模块
 * 提供调用 Oracle 存储过程和函数的功能
 */

import { z } from 'zod';
import oracledb from 'oracledb';
import { getConnection } from '../db.js';
import { ProcedureResult, SqlParameter } from '../types.js';

/**
 * 存储过程参数定义
 */
const ProcedureParamSchema = z.object({
  name: z.string().describe('参数名称'),
  direction: z.enum(['IN', 'OUT', 'IN OUT']).describe('参数方向'),
  type: z.string().optional().describe('参数类型（如 VARCHAR2, NUMBER, CURSOR）'),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional().describe('输入参数值'),
});

/**
 * 存储过程调用参数定义
 */
export const ProcedureArgsSchema = z.object({
  name: z.string().describe('存储过程或函数名称'),
  params: z.array(ProcedureParamSchema).optional().describe('存储过程参数数组'),
  hasCursor: z.boolean().optional().describe('是否包含游标返回结果'),
});

export type ProcedureArgs = z.infer<typeof ProcedureArgsSchema>;

/**
 * 存储过程调用工具定义
 */
export const procedureTool = {
  name: 'oracle_procedure',
  description: '调用 Oracle 存储过程或函数。支持输入参数、输出参数和游标返回结果。',
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string',
        description: '存储过程或函数名称',
      },
      params: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '参数名称' },
            direction: { type: 'string', enum: ['IN', 'OUT', 'IN OUT'], description: '参数方向' },
            type: { type: 'string', description: '参数类型（可选）' },
            value: { type: ['string', 'number', 'boolean', 'null'], description: '输入参数值（可选）' },
          },
          required: ['name', 'direction'],
        },
        description: '存储过程参数数组（可选）',
      },
      hasCursor: {
        type: 'boolean',
        description: '是否包含游标返回结果（可选）',
      },
    },
    required: ['name'],
  },
};

/**
 * 将字符串类型转换为 Oracle 数据类型
 * @param type 类型字符串
 * @returns Oracle 数据类型常量
 */
function getOracleType(type?: string): oracledb.DbType {
  if (!type) return oracledb.DB_TYPE_VARCHAR;
  
  const upperType = type.toUpperCase();
  switch (upperType) {
    case 'NUMBER':
    case 'NUMERIC':
    case 'INTEGER':
    case 'INT':
      return oracledb.DB_TYPE_NUMBER;
    case 'DATE':
    case 'TIMESTAMP':
      return oracledb.DB_TYPE_TIMESTAMP;
    case 'CURSOR':
    case 'REF CURSOR':
      return oracledb.DB_TYPE_CURSOR;
    case 'CLOB':
      return oracledb.DB_TYPE_CLOB;
    case 'BLOB':
      return oracledb.DB_TYPE_BLOB;
    case 'BUFFER':
      return oracledb.DB_TYPE_RAW;
    default:
      return oracledb.DB_TYPE_VARCHAR;
  }
}

/**
 * 调用存储过程
 * @param args 存储过程调用参数
 * @returns 调用结果
 */
export async function callProcedure(args: ProcedureArgs): Promise<ProcedureResult> {
  const { name, params = [], hasCursor = false } = args;
  let connection: oracledb.Connection | undefined;

  try {
    connection = await getConnection();
    
    // 构建绑定参数
    const binds: Record<string, oracledb.BindParameter> = {};
    const outParams: string[] = [];
    
    for (const param of params) {
      const bindDef: oracledb.BindParameter = {
        dir: oracledb.BIND_IN,
      };
      
      switch (param.direction) {
        case 'IN':
          bindDef.dir = oracledb.BIND_IN;
          bindDef.val = param.value as SqlParameter;
          bindDef.type = getOracleType(param.type);
          break;
        case 'OUT':
          bindDef.dir = oracledb.BIND_OUT;
          bindDef.type = getOracleType(param.type);
          outParams.push(param.name);
          break;
        case 'IN OUT':
          bindDef.dir = oracledb.BIND_INOUT;
          bindDef.val = param.value as SqlParameter;
          bindDef.type = getOracleType(param.type);
          outParams.push(param.name);
          break;
      }
      
      binds[param.name] = bindDef;
    }

    // 如果有游标返回，添加一个游标输出参数
    if (hasCursor) {
      binds['cursor'] = { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_CURSOR };
      outParams.push('cursor');
    }

    // 构建调用语句
    const paramNames = Object.keys(binds).join(', :');
    const callSql = `BEGIN ${name}(:${paramNames}); END;`;

    const result = await connection.execute(callSql, binds);

    // 提取输出参数
    const outputParams: Record<string, unknown> = {};
    let resultSet: Record<string, unknown>[] | undefined;

    if (result.outBinds) {
      const outBinds = result.outBinds as Record<string, unknown>;
      
      for (const paramName of outParams) {
        const value = outBinds[paramName];
        
        // 如果是游标，读取结果集
        if (paramName === 'cursor' && value && typeof value === 'object' && 'getRows' in value) {
          const cursor = value as oracledb.ResultSet<unknown>;
          try {
            const rows = await cursor.getRows();
            resultSet = rows as Record<string, unknown>[];
          } finally {
            await cursor.close();
          }
        } else {
          outputParams[paramName] = value;
        }
      }
    }

    return {
      outputParams,
      resultSet,
    };
  } catch (error) {
    console.error('[Oracle Procedure] 调用失败:', error);
    throw new Error(`存储过程调用失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error('[Oracle Procedure] 关闭连接失败:', closeError);
      }
    }
  }
}
