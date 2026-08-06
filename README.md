# ProxyLab 实验系统

一个可独立部署的双代理实验系统。参与者通过编号登录并配置自己的代理、查看recap和完整对话；管理员配置两个OpenAI兼容模型、运行Task、查看全部历史记录与逐条评论。

## 功能

- 参与者编号登录：`P1A`、`P1B`等，不区分大小写；首次登录先显示知情同意书，完成全部关键确认后才创建登录会话。系统记录受试者编号、同意时间、同意书版本及确认项。
- 参与者登录后先看到三步使用说明：配置Agent、按需添加个人配置项、点击保存配置；之后可从侧栏再次打开说明。
- 每次启动都会确保存在`P0A`与`P0B`两位内置dummy参与者，并为Profile 1、Profile 2提供可直接运行的测试数据；已有同名数据不会被覆盖。
- 参与者与管理员共用登录框：参与者输入`P1A`、`P1B`等编号；管理员输入`admin_arklab`直接进入管理系统（不区分大小写）。
- 参与者仅可访问自己的Agent配置、相关session的完整transcript和自己的recap。
- 管理员可查看所有已登录参与者、配置两个模型端点、获取模型列表并运行任意两位不同参与者的代理。
- Task 1（社交计划）、Task 2（新关系介绍）与Task 3（固定10个共享支持额度的资源分配协商）均内置交互提示词和recap结构。
- Task 3要求代理显式区分理想份额、最低份额、公平依据、条件/补偿、授权边界与待本人批准事项；完整方案中的双方份额和共同保留额度必须合计为10。
- 管理员可在独立的“Profile结构”页面增加、删除、排序或修改固定问题及Profile标题/描述；改动影响当前问卷和未来会话，既有会话保留创建时的结构快照。
- 每个Task最多10回合。代理发出的结束申请会被服务端解析为不可见元数据，不进入对话记录，也不会传给另一代理；双方独立申请后，还需通过第二阶段的私有授权与未决事项审核才会提前结束。
- 每个代理发言使用`P1A_T1_1`格式的会话内消息ID，并支持参与者/admin逐条评论。
- 参与者可在每个已启用Profile中添加、命名和删除自定义实验条件；有内容的条目会加入对应代理与recap提示词。
- 每次任务启动时冻结双方Profile快照，保证同一session中的提示词条件不会因后续编辑而变化。
- 每次运行独立保存transcript、两个principal的结构化recap、模型与任务配置快照、文字标记、section级决定和后续流程记录。Recap由固定JSON schema约束，A/B使用完全相同的标题与字段，并过滤通用免责声明和重复事实。
- 管理员Recap页按participant A／B左右对照展示双方独立recap；参与者仍只查看自己的单栏报告。旧Markdown记录会自动压缩为固定标题的报告视图。
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

Zeabur部署后，管理员与参与者使用同一登录页；输入`admin_arklab`即可进入管理系统。

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
npm run test:browser
```

API smoke test会启动隔离的数据目录与本地模拟模型，验证首次登录知情同意、`admin_arklab`直接登录、固定recap schema、A/B结构一致性、登录权限、配置保存、双代理交互、标记、section决定和历史记录。浏览器smoke test会自行启动隔离服务，验证实际同意书与统一登录页面；需要本机安装Chrome。

## 数据与安全边界

本系统仍是研究原型。`admin_arklab`是便捷的共享管理员编号，不提供强身份认证；公网部署时应限制该编号的传播，并优先在反向代理层增加HTTPS、IP访问控制或VPN。正式收集数据前还应完成伦理与数据管理审查。
