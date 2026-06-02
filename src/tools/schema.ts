/**
 * 数据库结构查询工具模块
 * 提供查询表结构、索引、约束等元数据的功能
 */

import { z } from 'zod';
import oracledb from 'oracledb';
import { getConnection } from '../db.js';

/**
 * 获取表列表参数定义
 */
export const ListTablesArgsSchema = z.object({
  schema: z.string().optional().describe('模式名，默认为当前用户'),
  tableNamePattern: z.string().optional().describe('表名匹配模式，支持 % 通配符'),
});

export type ListTablesArgs = z.infer<typeof ListTablesArgsSchema>;

/**
 * 获取表结构参数定义
 */
export const GetTableSchemaArgsSchema = z.object({
  tableName: z.string().describe('表名'),
  schema: z.string().optional().describe('模式名，默认为当前用户'),
});

export type GetTableSchemaArgs = z.infer<typeof GetTableSchemaArgsSchema>;

/**
 * 数据库结构工具定义
 */
export const schemaTools = {
  listTables: {
    name: 'oracle_list_tables',
    description: '获取数据库中的表列表，支持按模式名和表名模式过滤',
    inputSchema: {
      type: 'object' as const,
      properties: {
        schema: {
          type: 'string',
          description: '模式名，默认为当前用户（可选）',
        },
        tableNamePattern: {
          type: 'string',
          description: '表名匹配模式，支持 % 通配符（可选）',
        },
      },
      required: [],
    },
  },
  getTableSchema: {
    name: 'oracle_get_table_schema',
    description: '获取指定表的详细结构信息，包括列、主键、索引、约束等',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tableName: {
          type: 'string',
          description: '表名',
        },
        schema: {
          type: 'string',
          description: '模式名，默认为当前用户（可选）',
        },
      },
      required: ['tableName'],
    },
  },
};

/**
 * 获取表列表
 * @param args 查询参数
 * @returns 表列表
 */
export async function listTables(args: ListTablesArgs): Promise<{ tables: Array<{ tableName: string; comments?: string }> }> {
  const { schema, tableNamePattern } = args;
  let connection: oracledb.Connection | undefined;

  try {
    connection = await getConnection();

    let sql = `
      SELECT t.table_name, c.comments
      FROM user_tables t
      LEFT JOIN user_tab_comments c ON t.table_name = c.table_name
      WHERE 1=1
    `;
    const params: (string | null)[] = [];

    if (schema) {
      sql = sql.replace(/user_tables/g, 'all_tables').replace(/user_tab_comments/g, 'all_tab_comments');
      sql += ` AND owner = :1`;
      params.push(schema.toUpperCase());
    }

    if (tableNamePattern) {
      sql += ` AND t.table_name LIKE :${params.length + 1}`;
      params.push(tableNamePattern.toUpperCase());
    }

    sql += ` ORDER BY t.table_name`;

    const result = await connection.execute(sql, params, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    const tables = (result.rows as Array<{ TABLE_NAME: string; COMMENTS: string | null }>).map(row => ({
      tableName: row.TABLE_NAME,
      comments: row.COMMENTS || undefined,
    }));

    return { tables };
  } catch (error) {
    console.error('[Oracle Schema] 获取表列表失败:', error);
    throw new Error(`获取表列表失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error('[Oracle Schema] 关闭连接失败:', closeError);
      }
    }
  }
}

/**
 * 列信息接口
 */
interface ColumnInfo {
  columnName: string;
  dataType: string;
  dataLength?: number;
  dataPrecision?: number;
  dataScale?: number;
  nullable: boolean;
  dataDefault?: string;
  comments?: string;
}

/**
 * 约束信息接口
 */
interface ConstraintInfo {
  constraintName: string;
  constraintType: string;
  columnName?: string;
  searchCondition?: string;
  rTableName?: string;
  rColumnName?: string;
}

/**
 * 索引信息接口
 */
interface IndexInfo {
  indexName: string;
  indexType: string;
  uniqueness: string;
  columns: string[];
}

/**
 * 获取表结构
 * @param args 查询参数
 * @returns 表结构信息
 */
export async function getTableSchema(args: GetTableSchemaArgs): Promise<{
  tableName: string;
  columns: ColumnInfo[];
  constraints: ConstraintInfo[];
  indexes: IndexInfo[];
}> {
  const { tableName, schema } = args;
  let connection: oracledb.Connection | undefined;

  try {
    connection = await getConnection();
    const owner = schema ? schema.toUpperCase() : null;
    const table = tableName.toUpperCase();

    // 获取列信息
    const columnsSql = owner
      ? `SELECT c.column_name, c.data_type, c.data_length, c.data_precision, c.data_scale,
                c.nullable, c.data_default, cc.comments
         FROM all_tab_columns c
         LEFT JOIN all_col_comments cc ON c.owner = cc.owner AND c.table_name = cc.table_name AND c.column_name = cc.column_name
         WHERE c.owner = :1 AND c.table_name = :2
         ORDER BY c.column_id`
      : `SELECT c.column_name, c.data_type, c.data_length, c.data_precision, c.data_scale,
                c.nullable, c.data_default, cc.comments
         FROM user_tab_columns c
         LEFT JOIN user_col_comments cc ON c.table_name = cc.table_name AND c.column_name = cc.column_name
         WHERE c.table_name = :1
         ORDER BY c.column_id`;

    const columnsParams = owner ? [owner, table] : [table];
    const columnsResult = await connection.execute(columnsSql, columnsParams, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    const columns: ColumnInfo[] = (columnsResult.rows as Array<{
      COLUMN_NAME: string;
      DATA_TYPE: string;
      DATA_LENGTH: number;
      DATA_PRECISION: number | null;
      DATA_SCALE: number | null;
      NULLABLE: string;
      DATA_DEFAULT: string | null;
      COMMENTS: string | null;
    }>).map(row => ({
      columnName: row.COLUMN_NAME,
      dataType: row.DATA_TYPE,
      dataLength: row.DATA_LENGTH,
      dataPrecision: row.DATA_PRECISION || undefined,
      dataScale: row.DATA_SCALE || undefined,
      nullable: row.NULLABLE === 'Y',
      dataDefault: row.DATA_DEFAULT || undefined,
      comments: row.COMMENTS || undefined,
    }));

    // 获取约束信息（修复：外键引用表名需要通过 r_constraint_name 连接获取）
    const constraintsSql = owner
      ? `SELECT c.constraint_name, c.constraint_type, c.search_condition,
                cc.column_name, c.r_owner, r.table_name as r_table_name, c.r_constraint_name
         FROM all_constraints c
         LEFT JOIN all_cons_columns cc ON c.owner = cc.owner AND c.constraint_name = cc.constraint_name
         LEFT JOIN all_constraints r ON c.r_owner = r.owner AND c.r_constraint_name = r.constraint_name
         WHERE c.owner = :1 AND c.table_name = :2
         ORDER BY c.constraint_name, cc.position`
      : `SELECT c.constraint_name, c.constraint_type, c.search_condition,
                cc.column_name, c.r_owner, r.table_name as r_table_name, c.r_constraint_name
         FROM user_constraints c
         LEFT JOIN user_cons_columns cc ON c.constraint_name = cc.constraint_name
         LEFT JOIN user_constraints r ON c.r_constraint_name = r.constraint_name
         WHERE c.table_name = :1
         ORDER BY c.constraint_name, cc.position`;

    const constraintsParams = owner ? [owner, table] : [table];
    const constraintsResult = await connection.execute(constraintsSql, constraintsParams, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    const constraints: ConstraintInfo[] = (constraintsResult.rows as Array<{
      CONSTRAINT_NAME: string;
      CONSTRAINT_TYPE: string;
      SEARCH_CONDITION: string | null;
      COLUMN_NAME: string | null;
      R_TABLE_NAME: string | null;
      R_CONSTRAINT_NAME: string | null;
    }>).map(row => ({
      constraintName: row.CONSTRAINT_NAME,
      constraintType: row.CONSTRAINT_TYPE,
      searchCondition: row.SEARCH_CONDITION || undefined,
      columnName: row.COLUMN_NAME || undefined,
      rTableName: row.R_TABLE_NAME || undefined,
    }));

    // 获取索引信息
    const indexesSql = owner
      ? `SELECT i.index_name, i.index_type, i.uniqueness, ic.column_name
         FROM all_indexes i
         JOIN all_ind_columns ic ON i.owner = ic.index_owner AND i.index_name = ic.index_name
         WHERE i.table_owner = :1 AND i.table_name = :2
         ORDER BY i.index_name, ic.column_position`
      : `SELECT i.index_name, i.index_type, i.uniqueness, ic.column_name
         FROM user_indexes i
         JOIN user_ind_columns ic ON i.index_name = ic.index_name
         WHERE i.table_name = :1
         ORDER BY i.index_name, ic.column_position`;

    const indexesParams = owner ? [owner, table] : [table];
    const indexesResult = await connection.execute(indexesSql, indexesParams, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    // 合并索引列
    const indexMap = new Map<string, IndexInfo>();
    (indexesResult.rows as Array<{
      INDEX_NAME: string;
      INDEX_TYPE: string;
      UNIQUENESS: string;
      COLUMN_NAME: string;
    }>).forEach(row => {
      if (!indexMap.has(row.INDEX_NAME)) {
        indexMap.set(row.INDEX_NAME, {
          indexName: row.INDEX_NAME,
          indexType: row.INDEX_TYPE,
          uniqueness: row.UNIQUENESS,
          columns: [],
        });
      }
      indexMap.get(row.INDEX_NAME)!.columns.push(row.COLUMN_NAME);
    });

    const indexes = Array.from(indexMap.values());

    return {
      tableName: table,
      columns,
      constraints,
      indexes,
    };
  } catch (error) {
    console.error('[Oracle Schema] 获取表结构失败:', error);
    throw new Error(`获取表结构失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeError) {
        console.error('[Oracle Schema] 关闭连接失败:', closeError);
      }
    }
  }
}
