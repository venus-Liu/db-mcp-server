/**
 * 数据库连接配置管理模块
 * 支持从环境变量读取 Oracle 连接配置
 */

import oracledb from 'oracledb';

// 初始化 Oracle 客户端（支持自定义路径）
const oracleClientPath = process.env.ORACLE_CLIENT_PATH;
if (oracleClientPath) {
  oracledb.initOracleClient({ libDir: oracleClientPath });
} else {
  oracledb.initOracleClient();
}

/**
 * Oracle 连接配置接口
 */
export interface OracleConfig {
  user: string;
  password: string;
  connectString: string;
  poolMin?: number;
  poolMax?: number;
  poolIncrement?: number;
}

/**
 * MCP 安全配置接口
 */
export interface McpSecurityConfig {
  /** 是否允许 INSERT 操作，默认 false */
  allowInsert: boolean;
  /** 是否允许 UPDATE 操作，默认 false */
  allowUpdate: boolean;
  /** 是否允许 DELETE 操作，默认 false */
  allowDelete: boolean;
}

/**
 * 获取安全配置
 * @returns McpSecurityConfig 安全配置对象
 */
export function getSecurityConfig(): McpSecurityConfig {
  return {
    allowInsert: process.env.ORACLE_ALLOW_INSERT === 'true',
    allowUpdate: process.env.ORACLE_ALLOW_UPDATE === 'true',
    allowDelete: process.env.ORACLE_ALLOW_DELETE === 'true',
  };
}

/**
 * 从环境变量获取配置
 * @returns OracleConfig 配置对象
 */
export function getConfigFromEnv(): OracleConfig {
  const user = process.env.ORACLE_USER;
  const password = process.env.ORACLE_PASSWORD;
  const connectString = process.env.ORACLE_CONNECT_STRING;

  if (!user || !password || !connectString) {
    throw new Error(
      '缺少必需的 Oracle 连接配置。请设置以下环境变量：\n' +
      '  - ORACLE_USER: 数据库用户名\n' +
      '  - ORACLE_PASSWORD: 数据库密码\n' +
      '  - ORACLE_CONNECT_STRING: 连接字符串 (如: localhost:1521/ORCL)'
    );
  }

  return {
    user,
    password,
    connectString,
    poolMin: parseInt(process.env.ORACLE_POOL_MIN || '2', 10),
    poolMax: parseInt(process.env.ORACLE_POOL_MAX || '10', 10),
    poolIncrement: parseInt(process.env.ORACLE_POOL_INCREMENT || '1', 10),
  };
}

/**
 * 默认配置
 */
export const defaultConfig: Partial<OracleConfig> = {
  poolMin: 2,
  poolMax: 10,
  poolIncrement: 1,
};
