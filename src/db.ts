/**
 * 数据库连接池管理模块
 * 提供连接池的创建、获取连接和关闭功能
 */

import oracledb from 'oracledb';
import { OracleConfig } from './config.js';

// 连接池实例
let pool: oracledb.Pool | null = null;

/**
 * 初始化连接池
 * @param config Oracle 连接配置
 */
export async function initializePool(config: OracleConfig): Promise<void> {
  if (pool) {
    console.error('[Oracle] 连接池已存在');
    return;
  }

  try {
    pool = await oracledb.createPool({
      user: config.user,
      password: config.password,
      connectString: config.connectString,
      poolMin: config.poolMin,
      poolMax: config.poolMax,
      poolIncrement: config.poolIncrement,
    });
    console.error('[Oracle] 连接池创建成功');
  } catch (error) {
    console.error('[Oracle] 连接池创建失败:', error);
    throw error;
  }
}

/**
 * 获取数据库连接
 * @returns 数据库连接对象
 */
export async function getConnection(): Promise<oracledb.Connection> {
  if (!pool) {
    throw new Error('连接池未初始化，请先调用 initializePool()');
  }
  return await pool.getConnection();
}

/**
 * 关闭连接池
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close(0);
    pool = null;
    console.error('[Oracle] 连接池已关闭');
  }
}

/**
 * 获取连接池状态
 * @returns 连接池状态信息
 */
export function getPoolStatus(): { connectionsOpen: number; connectionsInUse: number } | null {
  if (!pool) {
    return null;
  }
  return {
    connectionsOpen: pool.connectionsOpen,
    connectionsInUse: pool.connectionsInUse,
  };
}
