/**
 * 适配器注册中心
 * 根据配置创建对应的数据库适配器实例
 */

import type { DatabaseAdapter } from './types.js';
import { OracleAdapter } from './oracle.js';
import { MySQLAdapter } from './mysql.js';
import { PostgreSQLAdapter } from './postgresql.js';
import { SqlServerAdapter } from './sqlserver.js';
import { SQLiteAdapter } from './sqlite.js';

const adapters = new Map<string, new () => DatabaseAdapter>();

// 注册内置适配器
adapters.set('oracle', OracleAdapter);
adapters.set('mysql', MySQLAdapter);
adapters.set('postgresql', PostgreSQLAdapter);
adapters.set('sqlserver', SqlServerAdapter);
adapters.set('sqlite', SQLiteAdapter);

// 别名
adapters.set('postgres', PostgreSQLAdapter);
adapters.set('mssql', SqlServerAdapter);

/**
 * 根据类型创建适配器实例
 */
export function createAdapter(type: string): DatabaseAdapter {
  const AdapterClass = adapters.get(type.toLowerCase());
  if (!AdapterClass) {
    const supported = Array.from(adapters.keys()).join(', ');
    throw new Error(`不支持的数据库类型: "${type}"。支持的类型: ${supported}`);
  }
  return new AdapterClass();
}

/**
 * 获取所有支持的数据库类型
 */
export function getSupportedDatabases(): string[] {
  return Array.from(adapters.keys()).filter(k => !['postgres', 'mssql'].includes(k));
}
