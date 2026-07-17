/**
 * 数据库 MCP 服务器主入口
 * 支持 Oracle / MySQL / PostgreSQL / SQL Server / SQLite
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getConfig, getSecurityConfig, getDbType } from './config.js';
import { createAdapter, getSupportedDatabases } from './adapters/index.js';
import type { DatabaseAdapter, SqlParameter } from './adapters/types.js';

// 全局适配器实例
let adapter: DatabaseAdapter | null = null;

// 活跃事务
const activeTransactions = new Map<string, { connection: unknown; startTime: Date }>();

/**
 * 创建 MCP 服务器
 */
const server = new Server(
  { name: 'db-mcp-server', version: '2.0.0' },
  { capabilities: { tools: {} } },
);

// ==================== 工具定义 ====================

const tools = [
  {
    name: 'db_query',
    description: '执行 SQL 查询语句并返回结果',
    inputSchema: {
      type: 'object', properties: {
        sql: { type: 'string', description: 'SQL 查询语句' },
        params: { type: 'array', items: { type: ['string', 'number', 'boolean', 'null'] }, description: '查询参数数组' },
        maxRows: { type: 'number', description: '最大返回行数' },
      }, required: ['sql'],
    },
  },
  {
    name: 'db_execute',
    description: '执行 DML 语句（INSERT/UPDATE/DELETE）',
    inputSchema: {
      type: 'object', properties: {
        sql: { type: 'string', description: 'SQL 语句' },
        params: { type: 'array', items: { type: ['string', 'number', 'boolean', 'null'] } },
        autoCommit: { type: 'boolean', description: '是否自动提交，默认 true' },
      }, required: ['sql'],
    },
  },
  {
    name: 'db_procedure',
    description: '调用存储过程或函数',
    inputSchema: {
      type: 'object', properties: {
        name: { type: 'string', description: '存储过程或函数名称' },
        params: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, direction: { type: 'string', enum: ['IN', 'OUT', 'IN OUT'] }, type: { type: 'string' }, value: { type: ['string', 'number', 'boolean', 'null'] } }, required: ['name', 'direction'] } },
        hasCursor: { type: 'boolean' },
      }, required: ['name'],
    },
  },
  {
    name: 'db_begin_transaction', description: '开始事务',
    inputSchema: { type: 'object', properties: { transactionId: { type: 'string' } } },
  },
  {
    name: 'db_commit_transaction', description: '提交事务',
    inputSchema: { type: 'object', properties: { transactionId: { type: 'string' } }, required: ['transactionId'] },
  },
  {
    name: 'db_rollback_transaction', description: '回滚事务',
    inputSchema: { type: 'object', properties: { transactionId: { type: 'string' } }, required: ['transactionId'] },
  },
  {
    name: 'db_transaction_execute', description: '在事务中执行 SQL',
    inputSchema: {
      type: 'object', properties: {
        transactionId: { type: 'string' }, sql: { type: 'string' },
        params: { type: 'array', items: { type: ['string', 'number', 'boolean', 'null'] } },
      }, required: ['transactionId', 'sql'],
    },
  },
  {
    name: 'db_batch_execute', description: '批量执行 SQL',
    inputSchema: {
      type: 'object', properties: {
        sql: { type: 'string' },
        paramsList: { type: 'array', items: { type: 'array' } },
        autoCommit: { type: 'boolean' },
      }, required: ['sql', 'paramsList'],
    },
  },
  {
    name: 'db_batch_insert', description: '批量插入数据',
    inputSchema: {
      type: 'object', properties: {
        table: { type: 'string' }, columns: { type: 'array', items: { type: 'string' } },
        values: { type: 'array', items: { type: 'array' } }, autoCommit: { type: 'boolean' },
      }, required: ['table', 'columns', 'values'],
    },
  },
  {
    name: 'db_list_tables', description: '获取表列表',
    inputSchema: { type: 'object', properties: { schema: { type: 'string' }, pattern: { type: 'string' } } },
  },
  {
    name: 'db_get_table_schema', description: '获取表结构',
    inputSchema: { type: 'object', properties: { tableName: { type: 'string' }, schema: { type: 'string' } }, required: ['tableName'] },
  },
];

// ==================== 权限控制 ====================

type Permission = 'read' | 'insert' | 'update' | 'delete' | 'ddl' | 'procedure' | 'transaction' | 'batch';
const TOOL_PERMS: Record<string, Permission> = {
  db_query: 'read', db_list_tables: 'read', db_get_table_schema: 'read',
  db_execute: 'ddl', db_procedure: 'procedure',
  db_begin_transaction: 'transaction', db_commit_transaction: 'transaction',
  db_rollback_transaction: 'transaction', db_transaction_execute: 'transaction',
  db_batch_execute: 'batch', db_batch_insert: 'batch',
};

function inferSqlType(sql: string): 'insert' | 'update' | 'delete' | 'ddl' | 'other' {
  const t = sql.trim().toUpperCase();
  if (t.startsWith('INSERT')) return 'insert';
  if (t.startsWith('UPDATE')) return 'update';
  if (t.startsWith('DELETE')) return 'delete';
  if (/^(CREATE|ALTER|DROP|TRUNCATE)/.test(t)) return 'ddl';
  return 'other';
}

function checkDmlPerm(sqlType: 'insert' | 'update' | 'delete' | 'ddl', s: ReturnType<typeof getSecurityConfig>): boolean {
  switch (sqlType) {
    case 'insert': return s.allowInsert;
    case 'update': return s.allowUpdate;
    case 'delete': return s.allowDelete;
    case 'ddl': return s.allowDdl;
    default: return false;
  }
}

function checkPerm(p: Permission, s: ReturnType<typeof getSecurityConfig>): boolean {
  switch (p) {
    case 'read': return true;
    case 'insert': return s.allowInsert;
    case 'update': return s.allowUpdate;
    case 'delete': return s.allowDelete;
    case 'ddl': return s.allowDdl;
    case 'procedure': return s.allowProcedure;
    case 'transaction': return s.allowTransaction;
    case 'batch': return s.allowBatch;
    default: return false;
  }
}

function permLabel(p: Permission): string {
  return { read: '读取', insert: 'INSERT', update: 'UPDATE', delete: 'DELETE', ddl: 'DDL', procedure: '存储过程', transaction: '事务', batch: '批量操作' }[p];
}

// ==================== 工具注册 ====================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const s = getSecurityConfig();
  return { tools: tools.filter(t => checkPerm(TOOL_PERMS[t.name], s)) };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (!adapter) return { content: [{ type: 'text', text: '错误: 数据库未连接' }], isError: true };

  // 权限检查
  const perm = TOOL_PERMS[name];
  if (perm && perm !== 'read') {
    const s = getSecurityConfig();
    if (name === 'db_execute' || name === 'db_batch_execute') {
      const sqlType = inferSqlType((args as any).sql);
      if (sqlType !== 'other' && !checkDmlPerm(sqlType, s)) {
        return { content: [{ type: 'text', text: `错误: 当前禁止 ${sqlType.toUpperCase()} 操作。请设置 DB_ALLOW_${sqlType.toUpperCase()}=true` }], isError: true };
      }
    } else if (name === 'db_transaction_execute') {
      const sqlType = inferSqlType((args as any).sql);
      if (sqlType !== 'other' && !checkDmlPerm(sqlType, s)) {
        return { content: [{ type: 'text', text: `错误: 当前禁止事务内执行 ${sqlType.toUpperCase()} 操作。请设置 DB_ALLOW_${sqlType.toUpperCase()}=true 和 DB_ALLOW_TRANSACTION=true` }], isError: true };
      } else if (!checkPerm(perm, s)) {
        return { content: [{ type: 'text', text: `错误: 当前禁止${permLabel(perm)}操作。请设置 DB_ALLOW_TRANSACTION=true` }], isError: true };
      }
    } else if (!checkPerm(perm, s)) {
      return { content: [{ type: 'text', text: `错误: 当前禁止${permLabel(perm)}操作。请设置 DB_ALLOW_${perm.toUpperCase()}=true` }], isError: true };
    }
  }

  try {
    const a = args as any;
    switch (name) {
      case 'db_query': {
        const r = await adapter.query(a.sql, a.params, a.maxRows);
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
      }
      case 'db_execute': {
        const r = await adapter.execute(a.sql, a.params, a.autoCommit ?? true);
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
      }
      case 'db_procedure': {
        const r = await adapter.callProcedure(a.name, a.params, a.hasCursor);
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
      }
      case 'db_begin_transaction': {
        const id = a.transactionId || `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const conn = await adapter.getTransactionConnection();
        activeTransactions.set(id, { connection: conn, startTime: new Date() });
        return { content: [{ type: 'text', text: JSON.stringify({ transactionId: id }) }] };
      }
      case 'db_commit_transaction': {
        const tx = activeTransactions.get(a.transactionId);
        if (!tx) throw new Error(`事务 "${a.transactionId}" 不存在`);
        await adapter.commitTransaction(tx.connection);
        activeTransactions.delete(a.transactionId);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      }
      case 'db_rollback_transaction': {
        const tx = activeTransactions.get(a.transactionId);
        if (!tx) throw new Error(`事务 "${a.transactionId}" 不存在`);
        await adapter.rollbackTransaction(tx.connection);
        activeTransactions.delete(a.transactionId);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      }
      case 'db_transaction_execute': {
        const tx = activeTransactions.get(a.transactionId);
        if (!tx) throw new Error(`事务 "${a.transactionId}" 不存在`);
        const r = await adapter.executeInTransaction(tx.connection, a.sql, a.params);
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
      }
      case 'db_batch_execute': {
        const r = await adapter.batchExecute(a.sql, a.paramsList, a.autoCommit ?? true);
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
      }
      case 'db_batch_insert': {
        const cols = a.columns.map((_: string, i: number) => `$${i + 1}`).join(', ');
        const sql = `INSERT INTO ${adapter.escapeIdentifier(a.table)} (${a.columns.join(', ')}) VALUES (${cols})`;
        const r = await adapter.batchExecute(sql, a.values, a.autoCommit ?? true);
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
      }
      case 'db_list_tables': {
        const r = await adapter.listTables(a.schema, a.pattern);
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
      }
      case 'db_get_table_schema': {
        const r = await adapter.getTableSchema(a.tableName, a.schema);
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
      }
      default:
        throw new Error(`未知工具: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `错误: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
});

// ==================== 启动 ====================

async function main() {
  try {
    const config = getConfig();
    const dbType = config.db.type;

    console.error(`[DB MCP] 启动中... 数据库类型: ${dbType}`);
    console.error(`[DB MCP] 支持的数据库: ${getSupportedDatabases().join(', ')}`);

    adapter = createAdapter(dbType);
    await adapter.initialize(config.db as Record<string, string>);

    const transport = new StdioServerTransport();
    await server.connect(transport);

    const s = config.security;
    const perms: string[] = ['读取'];
    if (s.allowInsert) perms.push('INSERT');
    if (s.allowUpdate) perms.push('UPDATE');
    if (s.allowDelete) perms.push('DELETE');
    if (s.allowDdl) perms.push('DDL');
    if (s.allowProcedure) perms.push('存储过程');
    if (s.allowTransaction) perms.push('事务');
    if (s.allowBatch) perms.push('批量操作');
    console.error(`[DB MCP] 服务器已启动 (${dbType})，权限: ${perms.join(' / ')}`);

    const shutdown = async () => {
      console.error('[DB MCP] 正在关闭...');
      for (const [id, tx] of activeTransactions) {
        try { await adapter!.rollbackTransaction(tx.connection); } catch {}
      }
      activeTransactions.clear();
      await adapter!.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('[DB MCP] 启动失败:', error);
    process.exit(1);
  }
}

main();
