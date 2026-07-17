/**
 * 数据库连接配置管理模块
 * 支持从环境变量读取多数据库连接配置
 * 环境变量命名格式: DB_配置名（如 DB_ALLOW_INSERT）
 * 通过 DB_TYPE 区分不同数据库类型
 */

/**
 * 安全配置接口
 */
export interface McpSecurityConfig {
  /** 是否允许 INSERT */
  allowInsert: boolean;
  /** 是否允许 UPDATE */
  allowUpdate: boolean;
  /** 是否允许 DELETE */
  allowDelete: boolean;
  /** 是否允许 DDL（CREATE/ALTER/DROP/TRUNCATE） */
  allowDdl: boolean;
  /** 是否允许存储过程/函数 */
  allowProcedure: boolean;
  /** 是否允许事务 */
  allowTransaction: boolean;
  /** 是否允许批量操作 */
  allowBatch: boolean;
}

/**
 * 数据库配置接口
 */
export interface DatabaseConfig {
  type: string;
  [key: string]: string | undefined;
}

/**
 * MCP 服务器配置接口
 */
export interface McpConfig {
  db: DatabaseConfig;
  security: McpSecurityConfig;
}

/**
 * 从环境变量获取数据库类型
 */
export function getDbType(): string {
  return process.env.DB_TYPE || process.env.ORACLE_CONNECT_STRING ? 'oracle' : 'sqlite';
}

/**
 * 读取环境变量（DB_前缀，兼容 ORACLE_ 旧变量）
 */
function getEnv(key: string): string | undefined {
  return process.env[`DB_${key}`] || process.env[`ORACLE_${key}`];
}

/**
 * 读取布尔类型的环境变量（'true' 为真）
 * 兼容 ORACLE_ 旧变量
 */
function getEnvBool(key: string): boolean {
  const value = process.env[`DB_${key}`];
  if (value !== undefined) return value === 'true';
  const legacy = process.env[`ORACLE_${key}`];
  if (legacy !== undefined) return legacy === 'true';
  return false;
}

/**
 * 获取安全配置
 */
export function getSecurityConfig(): McpSecurityConfig {
  return {
    allowInsert: getEnvBool('ALLOW_INSERT'),
    allowUpdate: getEnvBool('ALLOW_UPDATE'),
    allowDelete: getEnvBool('ALLOW_DELETE'),
    allowDdl: getEnvBool('ALLOW_DDL'),
    allowProcedure: getEnvBool('ALLOW_PROCEDURE'),
    allowTransaction: getEnvBool('ALLOW_TRANSACTION'),
    allowBatch: getEnvBool('ALLOW_BATCH'),
  };
}

/**
 * 从环境变量获取数据库连接配置
 */
export function getDatabaseConfig(): DatabaseConfig {
  const type = getDbType();
  const config: DatabaseConfig = { type };

  switch (type) {
    case 'oracle': {
      config.user = getEnv('USER') || '';
      config.password = getEnv('PASSWORD') || '';
      config.connectString = getEnv('CONNECT_STRING') || getEnv('HOST') || '';
      config.clientPath = getEnv('CLIENT_PATH') || '';
      config.poolMin = getEnv('POOL_MIN') || '2';
      config.poolMax = getEnv('POOL_MAX') || '10';
      config.poolIncrement = getEnv('POOL_INCREMENT') || '1';
      if (!config.user || !config.password || !config.connectString) {
        throw new Error('缺少 Oracle 连接配置。请设置 DB_USER, DB_PASSWORD, DB_CONNECT_STRING');
      }
      break;
    }

    case 'mysql':
      config.host = getEnv('HOST') || 'localhost';
      config.port = getEnv('PORT') || '3306';
      config.user = getEnv('USER') || 'root';
      config.password = getEnv('PASSWORD') || '';
      config.database = getEnv('DATABASE') || '';
      if (!config.database) throw new Error('缺少 MySQL 数据库名。请设置 DB_DATABASE');
      break;

    case 'postgresql':
      config.host = getEnv('HOST') || 'localhost';
      config.port = getEnv('PORT') || '5432';
      config.user = getEnv('USER') || 'postgres';
      config.password = getEnv('PASSWORD') || '';
      config.database = getEnv('DATABASE') || '';
      if (!config.database) throw new Error('缺少 PostgreSQL 数据库名。请设置 DB_DATABASE');
      break;

    case 'sqlserver':
      config.host = getEnv('HOST') || 'localhost';
      config.port = getEnv('PORT') || '1433';
      config.user = getEnv('USER') || 'sa';
      config.password = getEnv('PASSWORD') || '';
      config.database = getEnv('DATABASE') || '';
      if (!config.database) throw new Error('缺少 SQL Server 数据库名。请设置 DB_DATABASE');
      break;

    case 'sqlite':
      config.database = getEnv('DATABASE') || ':memory:';
      break;

    default:
      throw new Error(`不支持的数据库类型: ${type}。支持: oracle, mysql, postgresql, sqlserver, sqlite`);
  }

  return config;
}

/**
 * 获取完整配置
 */
export function getConfig(): McpConfig {
  return {
    db: getDatabaseConfig(),
    security: getSecurityConfig(),
  };
}
