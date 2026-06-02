/**
 * Oracle MCP 服务器主入口
 * 实现 Model Context Protocol 服务器，提供 Oracle 数据库操作能力
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { initializePool, closePool, getPoolStatus } from './db.js';
import { getConfigFromEnv, getSecurityConfig } from './config.js';
import {
  // 工具定义
  queryTool,
  executeTool,
  procedureTool,
  transactionTools,
  batchTools,
  schemaTools,
  // 工具实现
  executeQuery,
  executeDML,
  callProcedure,
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  executeInTransaction,
  cleanupTransactions,
  batchExecute,
  batchInsert,
  listTables,
  getTableSchema,
} from './tools/index.js';

/**
 * 创建 MCP 服务器
 */
const server = new Server(
  {
    name: 'oracle-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * 工具所需权限类型
 */
type Permission = 'read' | 'insert' | 'update' | 'delete' | 'ddl' | 'procedure' | 'transaction';

/**
 * 工具权限映射：每个工具需要哪种权限才能执行
 */
const TOOL_PERMISSIONS: Record<string, Permission> = {
  oracle_query: 'read',
  oracle_list_tables: 'read',
  oracle_get_table_schema: 'read',
  oracle_execute: 'ddl',          // 需要在运行时根据 SQL 类型判断
  oracle_procedure: 'procedure',
  oracle_begin_transaction: 'transaction',
  oracle_commit_transaction: 'transaction',
  oracle_rollback_transaction: 'transaction',
  oracle_transaction_execute: 'transaction',
  oracle_batch_execute: 'ddl',    // 需要在运行时根据 SQL 类型判断
  oracle_batch_insert: 'insert',
};

/**
 * 从 SQL 语句推断操作类型
 */
function inferSqlType(sql: string): 'insert' | 'update' | 'delete' | 'ddl' | 'other' {
  const trimmed = sql.trim().toUpperCase();
  if (trimmed.startsWith('INSERT')) return 'insert';
  if (trimmed.startsWith('UPDATE')) return 'update';
  if (trimmed.startsWith('DELETE')) return 'delete';
  if (trimmed.startsWith('CREATE') || trimmed.startsWith('ALTER') || trimmed.startsWith('DROP') || trimmed.startsWith('TRUNCATE')) return 'ddl';
  return 'other';
}

/**
 * 检查权限是否被允许
 */
function checkPermission(perm: Permission, security: ReturnType<typeof getSecurityConfig>): boolean {
  switch (perm) {
    case 'read': return true;
    case 'insert': return security.allowInsert;
    case 'update': return security.allowUpdate;
    case 'delete': return security.allowDelete;
    case 'ddl': return security.allowInsert && security.allowUpdate && security.allowDelete;
    case 'procedure': return security.allowInsert || security.allowUpdate || security.allowDelete;
    case 'transaction': return security.allowInsert || security.allowUpdate || security.allowDelete;
    default: return false;
  }
}

/**
 * 获取权限描述
 */
function getPermissionLabel(perm: Permission): string {
  const labels: Record<Permission, string> = {
    read: '读取',
    insert: 'INSERT',
    update: 'UPDATE',
    delete: 'DELETE',
    ddl: 'DDL',
    procedure: '存储过程',
    transaction: '事务',
  };
  return labels[perm];
}

/**
 * 注册工具列表处理器
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const security = getSecurityConfig();

  const allTools = [
    queryTool,
    executeTool,
    procedureTool,
    transactionTools.begin,
    transactionTools.commit,
    transactionTools.rollback,
    transactionTools.execute,
    batchTools.execute,
    batchTools.insert,
    schemaTools.listTables,
    schemaTools.getTableSchema,
  ];

  // 根据权限过滤工具
  const tools = allTools.filter(t => {
    const perm = TOOL_PERMISSIONS[t.name];
    if (!perm) return true;
    return checkPermission(perm, security);
  });

  return { tools };
});

/**
 * 注册工具调用处理器
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // 安全校验
  const perm = TOOL_PERMISSIONS[name];
  if (perm && perm !== 'read') {
    const security = getSecurityConfig();

    // oracle_execute 和 oracle_batch_execute 需要根据 SQL 类型动态判断
    if (name === 'oracle_execute' || name === 'oracle_batch_execute') {
      const sql = (args as { sql: string }).sql;
      const sqlType = inferSqlType(sql);
      if (sqlType === 'insert' && !security.allowInsert) {
        return { content: [{ type: 'text', text: `错误: 当前禁止 INSERT 操作。如需启用，请设置 ORACLE_ALLOW_INSERT=true` }], isError: true };
      }
      if (sqlType === 'update' && !security.allowUpdate) {
        return { content: [{ type: 'text', text: `错误: 当前禁止 UPDATE 操作。如需启用，请设置 ORACLE_ALLOW_UPDATE=true` }], isError: true };
      }
      if (sqlType === 'delete' && !security.allowDelete) {
        return { content: [{ type: 'text', text: `错误: 当前禁止 DELETE 操作。如需启用，请设置 ORACLE_ALLOW_DELETE=true` }], isError: true };
      }
      if (sqlType === 'ddl' && !(security.allowInsert && security.allowUpdate && security.allowDelete)) {
        return { content: [{ type: 'text', text: `错误: 当前禁止 DDL 操作（CREATE/ALTER/DROP/TRUNCATE）。如需启用，请同时设置 ORACLE_ALLOW_INSERT、ORACLE_ALLOW_UPDATE、ORACLE_ALLOW_DELETE=true` }], isError: true };
      }
    } else if (!checkPermission(perm, security)) {
      return {
        content: [{
          type: 'text',
          text: `错误: 当前禁止${getPermissionLabel(perm)}操作（${name}）。` +
            (perm === 'insert' ? '请设置 ORACLE_ALLOW_INSERT=true' :
             perm === 'update' ? '请设置 ORACLE_ALLOW_UPDATE=true' :
             perm === 'delete' ? '请设置 ORACLE_ALLOW_DELETE=true' :
             perm === 'procedure' ? '请至少设置一项写权限（ORACLE_ALLOW_INSERT/UPDATE/DELETE=true）' :
             perm === 'transaction' ? '请至少设置一项写权限（ORACLE_ALLOW_INSERT/UPDATE/DELETE=true）' :
             ''),
        }],
        isError: true,
      };
    }
  }

  try {
    switch (name) {
      // 查询工具
      case 'oracle_query': {
        const result = await executeQuery(args as { sql: string; params?: (string | number | boolean | null)[]; maxRows?: number });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // 执行工具
      case 'oracle_execute': {
        const result = await executeDML(args as { sql: string; params?: (string | number | boolean | null)[]; autoCommit?: boolean });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // 存储过程工具
      case 'oracle_procedure': {
        const result = await callProcedure(args as { name: string; params?: Array<{ name: string; direction: 'IN' | 'OUT' | 'IN OUT'; type?: string; value?: string | number | boolean | null }>; hasCursor?: boolean });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // 事务工具
      case 'oracle_begin_transaction': {
        const result = await beginTransaction(args as { transactionId?: string });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'oracle_commit_transaction': {
        const result = await commitTransaction(args as { transactionId: string });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'oracle_rollback_transaction': {
        const result = await rollbackTransaction(args as { transactionId: string });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'oracle_transaction_execute': {
        const result = await executeInTransaction(args as { transactionId: string; sql: string; params?: (string | number | boolean | null)[] });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // 批量操作工具
      case 'oracle_batch_execute': {
        const result = await batchExecute(args as { sql: string; paramsList: (string | number | boolean | null)[][]; batchSize?: number; autoCommit?: boolean });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'oracle_batch_insert': {
        const result = await batchInsert(args as { table: string; columns: string[]; values: (string | number | boolean | null)[][]; batchSize?: number; autoCommit?: boolean });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // 数据库结构工具
      case 'oracle_list_tables': {
        const result = await listTables(args as { schema?: string; tableNamePattern?: string });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'oracle_get_table_schema': {
        const result = await getTableSchema(args as { tableName: string; schema?: string });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`未知工具: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `错误: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

/**
 * 主函数
 */
async function main() {
  try {
    // 从环境变量获取配置并初始化连接池
    const config = getConfigFromEnv();
    await initializePool(config);

    // 创建 stdio 传输层
    const transport = new StdioServerTransport();
    
    // 连接服务器
    await server.connect(transport);
    const security = getSecurityConfig();
    const perms: string[] = ['读取'];
    if (security.allowInsert) perms.push('INSERT');
    if (security.allowUpdate) perms.push('UPDATE');
    if (security.allowDelete) perms.push('DELETE');
    console.error(`[Oracle MCP] 服务器已启动，权限: ${perms.join(' / ')}`);

    // 处理进程退出
    process.on('SIGINT', async () => {
      console.error('[Oracle MCP] 正在关闭服务器...');
      await cleanupTransactions();
      await closePool();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.error('[Oracle MCP] 正在关闭服务器...');
      await cleanupTransactions();
      await closePool();
      process.exit(0);
    });
  } catch (error) {
    console.error('[Oracle MCP] 启动失败:', error);
    process.exit(1);
  }
}

// 启动服务器
main();
