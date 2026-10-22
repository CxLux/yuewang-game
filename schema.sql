-- 《文枢·寻迹》数据库建表脚本（PostgreSQL）
-- 可选：仅在配置了 DATABASE_URL 环境变量时使用，用于持久化排行榜战绩。
-- 未配置 DATABASE_URL 时，服务端使用内存态（let users = {}），进程重启后战绩清零。
--
-- 用法：
--   1. 创建数据库：createdb platform
--   2. 导入本脚本：psql -d platform -f schema.sql
--   3. 配置环境变量：DATABASE_URL=postgres://user:pass@127.0.0.1:5432/platform
--
-- 注：server.js 启动时也会自动执行相同的建表语句（CREATE TABLE IF NOT EXISTS），
--     因此手动导入本脚本并非必需，此处仅作为提交源码包里的数据库说明文件。

CREATE TABLE IF NOT EXISTS users (
    name    TEXT PRIMARY KEY,          -- 玩家昵称（游客账号）
    wins    INT  NOT NULL DEFAULT 0,   -- 胜场
    losses  INT  NOT NULL DEFAULT 0    -- 负场
);
