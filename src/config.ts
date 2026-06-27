/**
 * 数据库连接配置管理模块
 * 支持从环境变量读取多数据库连接配置
 * 环境变量命名格式: DB_<数据库类型>_配置名（如 DB_ORACLE_ALLOW_INSERT）
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
 * 获取数据库类型前缀（大写）
 */
function getDbPrefix(): string {
  return getDbType().toUpperCase();
}

/**
 * 读取带数据库类型前缀的环境变量
 * 优先读取 DB_<TYPE>_KEY，其次 DB_KEY，最后 ORACLE_KEY（向后兼容）
 */
function getEnvWithPrefix(key: string): string | undefined {
  const prefix = getDbPrefix();
  return process.env[`DB_${prefix}_${key}`] || process.env[`DB_${key}`] || process.env[`ORACLE_${key}`];
}

/**
 * 读取布尔类型的环境变量（'true' 为真）
 */
function getEnvBoolWithPrefix(key: string): boolean {
  const prefix = getDbPrefix();
  const specific = process.env[`DB_${prefix}_${key}`];
  if (specific !== undefined) return specific === 'true';
  const generic = process.env[`DB_${key}`];
  if (generic !== undefined) return generic === 'true';
  const legacy = process.env[`ORACLE_${key}`];
  if (legacy !== undefined) return legacy === 'true';
  return false;
}

/**
 * 获取安全配置
 */
export function getSecurityConfig(): McpSecurityConfig {
  return {
    allowInsert: getEnvBoolWithPrefix('ALLOW_INSERT'),
    allowUpdate: getEnvBoolWithPrefix('ALLOW_UPDATE'),
    allowDelete: getEnvBoolWithPrefix('ALLOW_DELETE'),
    allowDdl: getEnvBoolWithPrefix('ALLOW_DDL'),
    allowProcedure: getEnvBoolWithPrefix('ALLOW_PROCEDURE'),
    allowTransaction: getEnvBoolWithPrefix('ALLOW_TRANSACTION'),
    allowBatch: getEnvBoolWithPrefix('ALLOW_BATCH'),
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
      config.user = getEnvWithPrefix('USER') || '';
      config.password = getEnvWithPrefix('PASSWORD') || '';
      config.connectString = getEnvWithPrefix('CONNECT_STRING') || getEnvWithPrefix('HOST') || '';
      config.clientPath = getEnvWithPrefix('CLIENT_PATH') || '';
      config.poolMin = getEnvWithPrefix('POOL_MIN') || '2';
      config.poolMax = getEnvWithPrefix('POOL_MAX') || '10';
      config.poolIncrement = getEnvWithPrefix('POOL_INCREMENT') || '1';
      if (!config.user || !config.password || !config.connectString) {
        throw new Error('缺少 Oracle 连接配置。请设置 DB_ORACLE_USER, DB_ORACLE_PASSWORD, DB_ORACLE_CONNECT_STRING');
      }
      break;
    }

    case 'mysql':
      config.host = getEnvWithPrefix('HOST') || 'localhost';
      config.port = getEnvWithPrefix('PORT') || '3306';
      config.user = getEnvWithPrefix('USER') || 'root';
      config.password = getEnvWithPrefix('PASSWORD') || '';
      config.database = getEnvWithPrefix('DATABASE') || '';
      if (!config.database) throw new Error('缺少 MySQL 数据库名。请设置 DB_MYSQL_DATABASE');
      break;

    case 'postgresql':
      config.host = getEnvWithPrefix('HOST') || 'localhost';
      config.port = getEnvWithPrefix('PORT') || '5432';
      config.user = getEnvWithPrefix('USER') || 'postgres';
      config.password = getEnvWithPrefix('PASSWORD') || '';
      config.database = getEnvWithPrefix('DATABASE') || '';
      if (!config.database) throw new Error('缺少 PostgreSQL 数据库名。请设置 DB_POSTGRESQL_DATABASE');
      break;

    case 'sqlserver':
      config.host = getEnvWithPrefix('HOST') || 'localhost';
      config.port = getEnvWithPrefix('PORT') || '1433';
      config.user = getEnvWithPrefix('USER') || 'sa';
      config.password = getEnvWithPrefix('PASSWORD') || '';
      config.database = getEnvWithPrefix('DATABASE') || '';
      if (!config.database) throw new Error('缺少 SQL Server 数据库名。请设置 DB_SQLSERVER_DATABASE');
      break;

    case 'sqlite':
      config.database = getEnvWithPrefix('DATABASE') || ':memory:';
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
