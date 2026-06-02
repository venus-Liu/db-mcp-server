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
import { getConfigFromEnv } from './config.js';
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
 * 注册工具列表处理器
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
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
    ],
  };
});

/**
 * 注册工具调用处理器
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

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
    console.error('[Oracle MCP] 服务器已启动，等待连接...');

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
