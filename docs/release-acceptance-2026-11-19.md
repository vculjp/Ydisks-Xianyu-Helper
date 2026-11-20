# V1.0.0 RC 本地发布验收（2026-11-19）

状态：候选版本，仅供受控内测，未正式发布。冻结新增功能，优先完成交易安全和发布门禁。

## 候选版本

- 本地二进制：`xianyu-server-rc.exe`，38,536,192 字节。
- SHA-256：`c78479f9bff24d0b0235cb6465b4ecf3dc134eecbcba9bed92ce50f77a9b0ad6`。
- `start-local.cmd` 指向候选二进制、原有数据目录和 `127.0.0.1:59188`。旧二进制保留，但数据库发生迁移后不得直接降级；应先验证兼容性或恢复匹配版本的备份。
- 目前是未提交工作区构建，不是可复现 Git 发布标记。禁止将 RC 当成正式签名安装包。

## 已验证证据

| 检查 | 结果 |
| --- | --- |
| 重新执行前端全量 Vitest | 151 文件，903 测试通过 |
| 重新执行生产前端构建、Go 候选二进制构建 | 通过 |
| 文档、Go 和前端注释检查 | 通过 |
| 新 RC 二进制独立 HTTP 冒烟 | 25/25，通过 |
| 新 RC SQLite 恢复演练 | 临时库写入、故障式停止、完整性检查、VACUUM INTO 快照、独立密钥复制、恢复启动、登录及客服配置一致性通过 |
| 恢复后短时探测 | 15 秒、15 轮健康与配置读取，最大单轮 33ms |
| `git diff --check` | 通过（仅已跟踪变更） |

此前同日验收日志：`tmp/final-acceptance-go-20261119.jsonl`（5857 个通过事件，65 包通过，20 个跳过），`tmp/final-acceptance-fix-regression.jsonl`（80 项），`tmp/final-acceptance-multidb.jsonl`（237 项），`tmp/final-acceptance-ui.log`、`tmp/final-acceptance-load.log`、`tmp/final-acceptance-soak.log`。这些不是本次重新执行的全量 Go、跨数据库和长时结果。

恢复演练仅覆盖临时 SQLite 与人工构造的设置记录，不覆盖实际店铺数据、加密平台凭证、上传目录、MySQL 或 PostgreSQL 实际备份恢复，也不证明优雅退出。未启动生产库、未访问真实买家、未发布商品或触发发货。

## 复验命令（项目根目录，Windows，Node 24）

```cmd
npm.cmd --prefix frontend run build
E:\ai_projects\.toolchains\go1.26.4\bin\go.exe build -trimpath -o xianyu-server-rc.exe ./cmd/server
node scripts/release-local-acceptance.mjs --soak-seconds=15
node scripts/release-local-acceptance.mjs --soak-seconds=86400
```

最后一条是尚未完成的 24 小时隔离探测；要求终端持续运行，保留输出。探测不绑定任何实际店铺，不替代多账号业务耐久测试。实际运行时监测进程内存、CPU、线程、连接、日志及数据增长；出现异常立即终止并保留证据。

## 剩余发布门禁

1. 对固定源码快照执行完整后端回归、静态检查、覆盖率、剩余适用浏览器测试和专项安全并发检查。
2. 24 小时隔离稳定性以及授权真实测试店铺的多账号在线、登录、咨询、模型回复、人工接管、支付后发货、重复事件和故障恢复验收。先关闭自动发货与自动回复再分阶段启用；真实交易只在明确授权下执行。
3. 真实数据的备份恢复在独立环境验证：数据库、密钥和必要的本地资源共同备份，验证恢复权限、配置、加密记录及版本兼容；禁止将私密数据纳入安装包或 Git。
4. 审核所有工作区变更与生成资源，排除临时二进制、日志、凭证及数据，创建可复现提交和版本号；在隔离环境验证安装包、升级、卸载和回滚。未获正式验收不得打正式发布标记或向公众部署。
