# DB MCP Server v2.0

多数据库 MCP 服务器，支持 Oracle、MySQL、PostgreSQL、SQL Server、SQLite。

## 功能特性

- **多数据库支持** — Oracle / MySQL / PostgreSQL / SQL Server / SQLite，通过适配器模式统一接口
- **SQL 查询** — 执行 SELECT 查询并返回结果
- **DML 操作** — 执行 INSERT / UPDATE / DELETE，支持细粒度权限控制
- **DDL 操作** — 执行 CREATE / ALTER / DROP / TRUNCATE，独立开关控制
- **存储过程** — 调用存储过程和函数
- **事务管理** — 支持事务的开始、提交、回滚和事务内执行
- **批量操作** — 批量执行 SQL 和批量插入数据
- **数据库结构** — 查询表列表、表结构、索引和约束
- **安全控制** — 7 种独立权限开关，默认全部关闭（只读模式）

## 快速开始

```bash
npm install
npm run build
```

启动后通过标准输入输出与 MCP 客户端通信。

## 环境变量命名规则

本项目采用**前缀优先**的环境变量读取策略：

```
DB_<数据库类型大写>_<配置名>  >  DB_<配置名>  >  ORACLE_<配置名>
```

**示例**（Oracle 数据库的 INSERT 权限）：
1. 优先读取 `DB_ORACLE_ALLOW_INSERT`
2. 其次读取 `DB_ALLOW_INSERT`
3. 最后读取 `ORACLE_ALLOW_INSERT`（向后兼容）
4. 均未设置则默认 `false`

## 配置

### 1. 数据库类型（必需）

```bash
DB_TYPE=oracle          # oracle | mysql | postgresql | sqlserver | sqlite
```

若未设置 `DB_TYPE`，但存在 `ORACLE_CONNECT_STRING` 或 `DB_ORACLE_CONNECT_STRING`，则自动推断为 Oracle。

### 2. 连接配置

#### Oracle

| 环境变量 | 必需 | 默认值 | 说明 |
|---------|------|--------|------|
| `DB_ORACLE_USER` | 是 | — | 用户名 |
| `DB_ORACLE_PASSWORD` | 是 | — | 密码 |
| `DB_ORACLE_CONNECT_STRING` | 是 | — | 连接串，如 `localhost:1521/ORCL` |
| `DB_ORACLE_CLIENT_PATH` | 否 | — | Oracle Instant Client 路径（不添加到系统 PATH 时使用） |
| `DB_ORACLE_POOL_MIN` | 否 | `2` | 连接池最小连接数 |
| `DB_ORACLE_POOL_MAX` | 否 | `10` | 连接池最大连接数 |
| `DB_ORACLE_POOL_INCREMENT` | 否 | `1` | 连接池增量 |

Oracle Instant Client 要求：
- 使用 **Basic** 版本（非 Basic Light），否则部分功能可能受限
- 通过 `DB_ORACLE_CLIENT_PATH` 指定路径，或确保其在系统 PATH 中

#### MySQL

| 环境变量 | 必需 | 默认值 | 说明 |
|---------|------|--------|------|
| `DB_MYSQL_HOST` | 否 | `localhost` | 主机地址 |
| `DB_MYSQL_PORT` | 否 | `3306` | 端口号 |
| `DB_MYSQL_USER` | 否 | `root` | 用户名 |
| `DB_MYSQL_PASSWORD` | 否 | — | 密码 |
| `DB_MYSQL_DATABASE` | 是 | — | 数据库名 |

#### PostgreSQL

| 环境变量 | 必需 | 默认值 | 说明 |
|---------|------|--------|------|
| `DB_POSTGRESQL_HOST` | 否 | `localhost` | 主机地址 |
| `DB_POSTGRESQL_PORT` | 否 | `5432` | 端口号 |
| `DB_POSTGRESQL_USER` | 否 | `postgres` | 用户名 |
| `DB_POSTGRESQL_PASSWORD` | 否 | — | 密码 |
| `DB_POSTGRESQL_DATABASE` | 是 | — | 数据库名 |

#### SQL Server

| 环境变量 | 必需 | 默认值 | 说明 |
|---------|------|--------|------|
| `DB_SQLSERVER_HOST` | 否 | `localhost` | 主机地址 |
| `DB_SQLSERVER_PORT` | 否 | `1433` | 端口号 |
| `DB_SQLSERVER_USER` | 否 | `sa` | 用户名 |
| `DB_SQLSERVER_PASSWORD` | 否 | — | 密码 |
| `DB_SQLSERVER_DATABASE` | 是 | — | 数据库名 |

#### SQLite

| 环境变量 | 必需 | 默认值 | 说明 |
|---------|------|--------|------|
| `DB_SQLITE_DATABASE` | 否 | `:memory:` | 数据库文件路径，默认内存数据库 |

### 3. 权限配置（默认全部 `false`）

| 环境变量 | 默认值 | 控制的操作 |
|---------|--------|-----------|
| `DB_ORACLE_ALLOW_INSERT` | `false` | INSERT 插入 |
| `DB_ORACLE_ALLOW_UPDATE` | `false` | UPDATE 更新 |
| `DB_ORACLE_ALLOW_DELETE` | `false` | DELETE 删除 |
| `DB_ORACLE_ALLOW_DDL` | `false` | CREATE / ALTER / DROP / TRUNCATE 等结构变更 |
| `DB_ORACLE_ALLOW_PROCEDURE` | `false` | 存储过程 / 函数调用 |
| `DB_ORACLE_ALLOW_TRANSACTION` | `false` | 事务管理（开始、提交、回滚、事务内执行） |
| `DB_ORACLE_ALLOW_BATCH` | `false` | 批量执行 SQL / 批量插入 |

> 将前缀 `ORACLE` 替换为 `MYSQL`、`POSTGRESQL`、`SQLSERVER`、`SQLITE` 即可对应其他数据库类型。

**说明：**
- `db_execute` 和 `db_batch_execute` 会根据 SQL 语句内容自动推断操作类型（INSERT / UPDATE / DELETE / DDL），并与对应权限开关匹配
- `db_transaction_execute` 在事务内执行 SQL 时，同样需要同时开启 `ALLOW_TRANSACTION` 和对应操作类型的权限
- 所有权限未配置时默认关闭，即**只读模式**

### 4. MCP 配置示例

#### Oracle（使用 Instant Client 路径）

```json
{
  "mcpServers": {
    "oracle": {
      "command": "node",
      "args": ["D:/tools/mcp/oracle-mcp/dist/index.js"],
      "env": {
        "DB_TYPE": "oracle",
        "DB_ORACLE_USER": "scott",
        "DB_ORACLE_PASSWORD": "tiger",
        "DB_ORACLE_CONNECT_STRING": "localhost:1521/ORCL",
        "DB_ORACLE_CLIENT_PATH": "C:\\oracle\\instantclient_19_22",
        "DB_ORACLE_ALLOW_INSERT": "true",
        "DB_ORACLE_ALLOW_UPDATE": "true"
      }
    }
  }
}
```

#### MySQL

```json
{
  "mcpServers": {
    "mysql": {
      "command": "node",
      "args": ["D:/tools/mcp/oracle-mcp/dist/index.js"],
      "env": {
        "DB_TYPE": "mysql",
        "DB_MYSQL_HOST": "localhost",
        "DB_MYSQL_PORT": "3306",
        "DB_MYSQL_USER": "root",
        "DB_MYSQL_PASSWORD": "password",
        "DB_MYSQL_DATABASE": "mydb",
        "DB_MYSQL_ALLOW_INSERT": "true",
        "DB_MYSQL_ALLOW_UPDATE": "true",
        "DB_MYSQL_ALLOW_DELETE": "false"
      }
    }
  }
}
```

#### PostgreSQL

```json
{
  "mcpServers": {
    "postgres": {
      "command": "node",
      "args": ["D:/tools/mcp/oracle-mcp/dist/index.js"],
      "env": {
        "DB_TYPE": "postgresql",
        "DB_POSTGRESQL_HOST": "localhost",
        "DB_POSTGRESQL_PORT": "5432",
        "DB_POSTGRESQL_USER": "postgres",
        "DB_POSTGRESQL_PASSWORD": "password",
        "DB_POSTGRESQL_DATABASE": "mydb",
        "DB_POSTGRESQL_ALLOW_DDL": "true"
      }
    }
  }
}
```

#### SQL Server

```json
{
  "mcpServers": {
    "sqlserver": {
      "command": "node",
      "args": ["D:/tools/mcp/oracle-mcp/dist/index.js"],
      "env": {
        "DB_TYPE": "sqlserver",
        "DB_SQLSERVER_HOST": "localhost",
        "DB_SQLSERVER_PORT": "1433",
        "DB_SQLSERVER_USER": "sa",
        "DB_SQLSERVER_PASSWORD": "password",
        "DB_SQLSERVER_DATABASE": "mydb"
      }
    }
  }
}
```

#### SQLite

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "node",
      "args": ["D:/tools/mcp/oracle-mcp/dist/index.js"],
      "env": {
        "DB_TYPE": "sqlite",
        "DB_SQLITE_DATABASE": "C:/data/mydb.sqlite",
        "DB_SQLITE_ALLOW_INSERT": "true",
        "DB_SQLITE_ALLOW_UPDATE": "true"
      }
    }
  }
}
```

## 工具列表

| 工具名 | 需要的权限 | 说明 |
|--------|-----------|------|
| `db_query` | 读取（默认允许） | 执行 SELECT 查询 |
| `db_execute` | 根据 SQL 类型 | 执行 INSERT / UPDATE / DELETE / DDL |
| `db_procedure` | `ALLOW_PROCEDURE` | 调用存储过程或函数 |
| `db_begin_transaction` | `ALLOW_TRANSACTION` | 开始事务 |
| `db_commit_transaction` | `ALLOW_TRANSACTION` | 提交事务 |
| `db_rollback_transaction` | `ALLOW_TRANSACTION` | 回滚事务 |
| `db_transaction_execute` | `ALLOW_TRANSACTION` + 操作类型权限 | 在事务中执行 SQL |
| `db_batch_execute` | `ALLOW_BATCH` | 批量执行 SQL |
| `db_batch_insert` | `ALLOW_BATCH` | 批量插入数据 |
| `db_list_tables` | 读取（默认允许） | 获取表列表 |
| `db_get_table_schema` | 读取（默认允许） | 获取表结构（列、约束、索引） |

> **注意：** 当某个权限关闭时，对应的工具不会出现在 MCP 工具列表中，客户端也无法调用。

## 向后兼容

旧版 `ORACLE_*` 环境变量仍然有效，但建议迁移到新格式：

| 旧格式 | 新格式（推荐） |
|--------|--------------|
| `ORACLE_USER` | `DB_ORACLE_USER` |
| `ORACLE_PASSWORD` | `DB_ORACLE_PASSWORD` |
| `ORACLE_CONNECT_STRING` | `DB_ORACLE_CONNECT_STRING` |
| `ORACLE_ALLOW_INSERT` | `DB_ORACLE_ALLOW_INSERT` |
| `ORACLE_ALLOW_UPDATE` | `DB_ORACLE_ALLOW_UPDATE` |
| `ORACLE_ALLOW_DELETE` | `DB_ORACLE_ALLOW_DELETE` |

## 项目结构

```
src/
├── adapters/
│   ├── types.ts          # 适配器接口定义
│   ├── index.ts          # 适配器注册中心
│   ├── oracle.ts         # Oracle 适配器（oracledb v6）
│   ├── mysql.ts          # MySQL 适配器（mysql2）
│   ├── postgresql.ts     # PostgreSQL 适配器（pg）
│   ├── sqlserver.ts      # SQL Server 适配器（mssql）
│   └── sqlite.ts         # SQLite 适配器（better-sqlite3）
├── config.ts             # 配置管理与环境变量读取
├── index.ts              # MCP 服务器入口
├── db.ts                 # （已废弃，保留空文件）
├── types.ts              # （已废弃，保留空文件）
└── tools/                # （已废弃，保留空文件）
```

## 技术要点

- **oracledb v6** 使用 `DB_TYPE_*` 常量替代旧版类型常量
- **oracledb v6** 不支持直接设置 `connection.autoCommit`，通过 `execute()` 的 `options` 参数控制
- **SQLite** 使用 `better-sqlite3`，采用同步 API 包装为异步接口
- 事务连接由各自适配器管理，通过 `Map` 追踪活跃事务

## 许可证

MIT
