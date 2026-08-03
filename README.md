# ProxyLab 实验系统

一个可独立部署的双代理实验系统。参与者通过编号登录并配置自己的代理、查看recap和完整对话；管理员配置两个OpenAI兼容模型、运行Task、查看全部历史记录与逐条评论。

## 功能

- 参与者编号登录：`P1A`、`P1B`等，不区分大小写；首次登录自动注册。
- 每次启动都会确保存在`P0A`与`P0B`两位内置dummy参与者，并为Profile 1、Profile 2提供可直接运行的测试数据；已有同名数据不会被覆盖。
- `admin`登录进入管理界面，无密码（按实验内网使用要求实现）。
- 参与者仅可访问自己的Agent配置、相关session的完整transcript和自己的recap。
- 管理员可查看所有已登录参与者、配置两个模型端点、获取模型列表并运行任意两位不同参与者的代理。
- Task 1（社交计划）与Task 2（新关系介绍）内置交互提示词和recap结构。
- Task 3保留可编辑占位；管理员补全提示词与recap结构并启用后才可执行。
- 每个Task最多10回合。双方发送`我认为任务已完成申请结束`后提前结束。
- 每个代理发言使用`P1A_T1_1`格式的会话内消息ID，并支持参与者/admin逐条评论。
- 参与者可在每个已启用Profile中添加、命名和删除自定义实验条件；有内容的条目会加入对应代理与recap提示词。
- 每次任务启动时冻结双方Profile快照，保证同一session中的提示词条件不会因后续编辑而变化。
- 每次运行独立保存transcript、两个principal的recap、模型与任务配置快照、评论和审批决定。
- 管理员Recap页按participant A／B左右对照展示双方独立recap；参与者仍只查看自己的单栏recap。
- 管理员可在历史详情中永久删除已结束的记录；系统会二次确认，并禁止删除仍在运行或生成recap的记录。

## 本地运行

要求Node.js 20或更高版本。

```bash
npm install
npm run build
npm start
```

默认访问：`http://localhost:8787`

## 服务器部署

将整个`proxylab-experiment`文件夹复制到服务器：

```bash
npm ci
npm run build
HOST=0.0.0.0 PORT=8787 DATA_DIR=/srv/proxylab-data npm start
```

Windows PowerShell示例：

```powershell
$env:HOST = "0.0.0.0"
$env:PORT = "8787"
$env:DATA_DIR = "D:\proxylab-data"
npm.cmd start
```

建议由Nginx/Caddy反向代理并启用HTTPS。实验开始后应定期备份`DATA_DIR/store.json`。API Key保存在此文件中，因此应限制文件权限并避免把数据目录提交到Git。

本仓库若附带研究数据快照，其中的Base URL与实验记录会保留，但所有API Key字段均已置空。部署后请在管理员“模型配置”页重新填写Key，并避免提交随后产生的`data/store.json`变更。

## 模型兼容性

模型端点需要支持OpenAI兼容接口：

- `GET {baseUrl}/models`
- `POST {baseUrl}/chat/completions`

在管理员的“模型配置”页分别为Agent 1和Agent 2填写Base URL与API Key，点击“获取模型”，再从返回的下拉列表中选择模型。DeepSeek可直接使用`https://api.deepseek.com`。API Key只保存在本地`DATA_DIR/store.json`中，读取配置时不会回显，也不会写入session历史快照。

## 验证

```bash
npm run check
npm run test:smoke
```

Smoke test会启动隔离的数据目录与本地模拟模型，验证登录权限、配置保存、模型连接、双代理自动交互、消息ID、双方recap、评论、审批决定和历史记录。

## 数据与安全边界

本系统按研究原型要求允许输入`admin`直接获得管理权限，不适合直接暴露在公共互联网。若需要公网部署，应在反向代理层增加访问控制或VPN，并在正式收集数据前完成伦理与数据管理审查。
