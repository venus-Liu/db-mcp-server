# DB MCP Server v2.0

多数据库 MCP 服务器，支持 Oracle、MySQL、PostgreSQL、SQL Server、SQLite。

## 功能特性

- ✅ **多数据库支持** - Oracle / MySQL / PostgreSQL / SQL Server / SQLite
- ✅ **SQL 查询** - 执行 SELECT 查询并返回结果
- ✅ **DML 操作** - 执行 INSERT/UPDATE/DELETE，支持细粒度权限控制
- ✅ **存储过程** - 调用存储过程和函数
- ✅ **事务管理** - 支持事务的开始、提交和回滚
- ✅ **批量操作** - 批量执行和批量插入
- ✅ **数据库结构** - 查询表列表、表结构、索引和约束
- ✅ **安全控制** - INSERT/UPDATE/DELETE 独立权限，默认只读

## 快速开始

```bash
npm install
npm run build
```

## 配置

### 通用配置

所有数据库共享以下环境变量：

| 变量 | 必需 | 说明 |
|------|------|------|
| `DB_TYPE` | 是 | 数据库类型: `oracle`, `mysql`, `postgresql`, `sqlserver`, `sqlite` |
| `DB_USER` | 部分 | 用户名 |
| `DB_PASSWORD` | 部分 | 密码 |
| `DB_HOST` | 部分 | 主机地址 |
| `DB_PORT` | 部分 | 端口号 |
| `DB_DATABASE` | 部分 | 数据库名 |

### 按数据库类型

**Oracle:**
```json
{
  "mcpServers": {
    "oracle": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "DB_TYPE": "oracle",
        "ORACLE_USER": "scott",
        "ORACLE_PASSWORD": "tiger",
        "ORACLE_CONNECT_STRING": "localhost:1521/ORCL",
        "ORACLE_ALLOW_INSERT": "true"
      }
    }
  }
}
```

**MySQL:**
```json
{
  "mcpServers": {
    "mysql": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "DB_TYPE": "mysql",
        "DB_USER": "root",
        "DB_PASSWORD": "password",
        "DB_HOST": "localhost",
        "DB_PORT": "3306",
        "DB_DATABASE": "mydb",
        "DB_ALLOW_INSERT": "true",
        "DB_ALLOW_UPDATE": "true"
      }
    }
  }
}
```

**PostgreSQL:**
```json
{
  "mcpServers": {
    "postgres": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "DB_TYPE": "postgresql",
        "DB_USER": "postgres",
        "DB_PASSWORD": "password",
        "DB_HOST": "localhost",
        "DB_PORT": "5432",
        "DB_DATABASE": "mydb"
      }
    }
  }
}
```

**SQL Server:**
```json
{
  "mcpServers": {
    "sqlserver": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "DB_TYPE": "sqlserver",
        "DB_USER": "sa",
        "DB_PASSWORD": "password",
        "DB_HOST": "localhost",
        "DB_PORT": "1433",
        "DB_DATABASE": "mydb"
      }
    }
  }
}
```

**SQLite:**
```json
{
  "mcpServers": {
    "sqlite": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "DB_TYPE": "sqlite",
        "DB_DATABASE": "/path/to/database.db"
      }
    }
  }
}
```

## 权限配置

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `DB_ALLOW_INSERT` | `false` | 允许 INSERT 操作 |
| `DB_ALLOW_UPDATE` | `false` | 允许 UPDATE 操作 |
| `DB_ALLOW_DELETE` | `false` | 允许 DELETE 操作 |

`db_execute` 和 `db_batch_execute` 会根据 SQL 语句自动识别操作类型。

## 工具列表

| 工具名 | 说明 |
|--------|------|
| `db_query` | 执行 SELECT 查询 |
| `db_execute` | 执行 INSERT/UPDATE/DELETE |
| `db_procedure` | 调用存储过程 |
| `db_begin_transaction` | 开始事务 |
| `db_commit_transaction` | 提交事务 |
| `db_rollback_transaction` | 回滚事务 |
| `db_transaction_execute` | 事务中执行 SQL |
| `db_batch_execute` | 批量执行 SQL |
| `db_batch_insert` | 批量插入数据 |
| `db_list_tables` | 获取表列表 |
| `db_get_table_schema` | 获取表结构 |

## 架构

```
src/
├── adapters/
│   ├── types.ts          # 适配器接口定义
│   ├── oracle.ts         # Oracle 适配器
│   ├── mysql.ts          # MySQL 适配器
│   ├── postgresql.ts     # PostgreSQL 适配器
│   ├── sqlserver.ts      # SQL Server 适配器
│   ├── sqlite.ts         # SQLite 适配器
│   └── index.ts          # 适配器注册中心
├── config.ts             # 配置管理
├── index.ts              # MCP 服务器入口
├── db.ts                 # (已废弃)
├── types.ts              # (已废弃)
└── tools/                # (已废弃)
```

## 许可证

MIT
