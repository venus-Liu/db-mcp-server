# Oracle MCP Server

一个基于 Model Context Protocol (MCP) 的 Oracle 数据库操作服务器，提供完整的数据库操作能力。

## 功能特性

- ✅ **SQL 查询** - 执行 SELECT 查询并返回结果
- ✅ **DML 操作** - 执行 INSERT、UPDATE、DELETE 语句
- ✅ **存储过程** - 调用存储过程和函数，支持输入/输出参数和游标
- ✅ **事务管理** - 支持事务的开始、提交和回滚
- ✅ **批量操作** - 批量插入、更新和删除
- ✅ **数据库结构** - 查询表列表、表结构、索引和约束
- ✅ **连接池** - 内置连接池管理，提高性能

## 安装

### 前提条件

1. 安装 Node.js 18+
2. 安装 Oracle Instant Client（见下方说明）

### Oracle Instant Client 安装

#### Windows

1. 下载 Oracle Instant Client Basic 包：https://www.oracle.com/database/technologies/instant-client/downloads.html
2. 解压到 `C:\oracle\instantclient_19_22`
3. 添加 `C:\oracle\instantclient_19_22` 到系统 PATH

#### macOS

```bash
brew install instantclient-basic
```

#### Linux

```bash
# Ubuntu/Debian
sudo apt-get install libaio1
wget https://download.oracle.com/otn_software/linux/instantclient/1922000/instantclient-basic-linux.x64-19.22.0.0.0dbru.zip
unzip instantclient-basic-linux.x64-19.22.0.0.0dbru.zip
sudo mv instantclient_19_22 /opt/oracle/
sudo sh -c "echo /opt/oracle/instantclient_19_22 > /etc/ld.so.conf.d/oracle-instantclient.conf"
sudo ldconfig
```

### 安装依赖

```bash
npm install
```

### 编译

```bash
npm run build
```

## 配置

### 环境变量

复制 `.env.example` 为 `.env` 并配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
ORACLE_USER=your_username
ORACLE_PASSWORD=your_password
ORACLE_CONNECT_STRING=localhost:1521/ORCL

# 可选：连接池配置
ORACLE_POOL_MIN=2
ORACLE_POOL_MAX=10
ORACLE_POOL_INCREMENT=1
```

### MCP 配置

在 Claude Desktop 或其他 MCP 客户端中配置：

```json
{
  "mcpServers": {
    "oracle": {
      "command": "node",
      "args": ["/path/to/oracle-mcp/dist/index.js"],
      "env": {
        "ORACLE_USER": "your_username",
        "ORACLE_PASSWORD": "your_password",
        "ORACLE_CONNECT_STRING": "localhost:1521/ORCL"
      }
    }
  }
}
```

## 工具说明

### 1. oracle_query - SQL 查询

执行 SELECT 查询语句。

**参数：**
- `sql` (string, 必需): SQL 查询语句
- `params` (array, 可选): 查询参数数组
- `maxRows` (number, 可选): 最大返回行数，默认 1000

**示例：**
```json
{
  "sql": "SELECT * FROM employees WHERE department_id = :1",
  "params": [10],
  "maxRows": 100
}
```

### 2. oracle_execute - DML 执行

执行 INSERT、UPDATE、DELETE 语句。

**参数：**
- `sql` (string, 必需): SQL 语句
- `params` (array, 可选): 参数数组
- `autoCommit` (boolean, 可选): 是否自动提交，默认 true

**示例：**
```json
{
  "sql": "UPDATE employees SET salary = :1 WHERE employee_id = :2",
  "params": [5000, 101],
  "autoCommit": true
}
```

### 3. oracle_procedure - 存储过程调用

调用存储过程或函数。

**参数：**
- `name` (string, 必需): 存储过程或函数名称
- `params` (array, 可选): 参数数组，每个参数包含：
  - `name`: 参数名
  - `direction`: 方向（IN/OUT/IN OUT）
  - `type`: 数据类型（可选，如 VARCHAR2, NUMBER, CURSOR）
  - `value`: 输入值（IN 和 IN OUT 参数需要）
- `hasCursor` (boolean, 可选): 是否包含游标返回

**示例：**
```json
{
  "name": "GET_EMPLOYEE_DETAILS",
  "params": [
    { "name": "p_emp_id", "direction": "IN", "value": 101 },
    { "name": "p_name", "direction": "OUT", "type": "VARCHAR2" },
    { "name": "p_salary", "direction": "OUT", "type": "NUMBER" }
  ]
}
```

### 4. oracle_begin_transaction - 开始事务

开始一个新的事务。

**参数：**
- `transactionId` (string, 可选): 事务ID，不提供则自动生成

**返回：**
```json
{
  "transactionId": "tx_1234567890_abc123"
}
```

### 5. oracle_commit_transaction - 提交事务

提交指定的事务。

**参数：**
- `transactionId` (string, 必需): 要提交的事务ID

### 6. oracle_rollback_transaction - 回滚事务

回滚指定的事务。

**参数：**
- `transactionId` (string, 必需): 要回滚的事务ID

### 7. oracle_transaction_execute - 事务内执行

在指定事务中执行 SQL。

**参数：**
- `transactionId` (string, 必需): 事务ID
- `sql` (string, 必需): SQL 语句
- `params` (array, 可选): 参数数组

### 8. oracle_batch_execute - 批量执行

批量执行 SQL 语句。

**参数：**
- `sql` (string, 必需): SQL 语句模板
- `paramsList` (array, 必需): 参数数组列表
- `batchSize` (number, 可选): 每批处理记录数，默认 1000
- `autoCommit` (boolean, 可选): 是否自动提交，默认 true

**示例：**
```json
{
  "sql": "INSERT INTO employees (id, name) VALUES (:1, :2)",
  "paramsList": [
    [1, "张三"],
    [2, "李四"],
    [3, "王五"]
  ],
  "batchSize": 1000
}
```

### 9. oracle_batch_insert - 批量插入

批量插入数据到指定表。

**参数：**
- `table` (string, 必需): 目标表名
- `columns` (array, 必需): 列名数组
- `values` (array, 必需): 值数组，每行是一个数组
- `batchSize` (number, 可选): 每批处理记录数，默认 1000
- `autoCommit` (boolean, 可选): 是否自动提交，默认 true

**示例：**
```json
{
  "table": "employees",
  "columns": ["id", "name", "salary"],
  "values": [
    [1, "张三", 5000],
    [2, "李四", 6000],
    [3, "王五", 7000]
  ]
}
```

### 10. oracle_list_tables - 获取表列表

获取数据库中的表列表。

**参数：**
- `schema` (string, 可选): 模式名，默认为当前用户
- `tableNamePattern` (string, 可选): 表名匹配模式，支持 `%` 通配符

**示例：**
```json
{
  "schema": "HR",
  "tableNamePattern": "EMP%"
}
```

### 11. oracle_get_table_schema - 获取表结构

获取指定表的详细结构信息，包括列、主键、索引、约束等。

**参数：**
- `tableName` (string, 必需): 表名
- `schema` (string, 可选): 模式名，默认为当前用户

**示例：**
```json
{
  "tableName": "employees",
  "schema": "HR"
}
```

## 使用示例

### 基本查询

```
使用 oracle_query 工具查询员工信息：
SQL: SELECT * FROM employees WHERE department_id = 10
```

### 带参数的查询

```
使用 oracle_query 工具查询：
SQL: SELECT * FROM employees WHERE hire_date > :1 AND salary > :2
参数: ["2020-01-01", 5000]
```

### 插入数据

```
使用 oracle_execute 工具插入新员工：
SQL: INSERT INTO employees (id, name, salary) VALUES (:1, :2, :3)
参数: [201, "新员工", 8000]
```

### 事务操作

```
1. 使用 oracle_begin_transaction 开始事务
2. 使用 oracle_transaction_execute 执行多个操作
3. 使用 oracle_commit_transaction 提交或 oracle_rollback_transaction 回滚
```

### 批量插入

```
使用 oracle_batch_insert 工具批量插入：
表: employees
列: ["id", "name", "department_id"]
值: [[1, "张三", 10], [2, "李四", 20], [3, "王五", 10]]
```

## 开发

```bash
# 开发模式（自动编译）
npm run dev

# 构建
npm run build

# 运行
npm start
```

## 故障排除

### ORA-12154: TNS:could not resolve the connect identifier

检查 `ORACLE_CONNECT_STRING` 格式是否正确，应该是 `hostname:port/service_name` 格式。

### DPI-1047: Cannot locate a 64-bit Oracle Client library

确保 Oracle Instant Client 已正确安装并添加到系统 PATH。

### 连接超时

检查网络连接和防火墙设置，确保可以访问 Oracle 数据库端口（默认 1521）。

## 许可证

MIT
