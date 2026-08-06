import { useEffect, useState } from "react";
import { api, jsonBody } from "../api.js";
import { Field, TextArea, TextInput } from "../components/FormControls.jsx";
import { Icon } from "../components/Icons.jsx";

const DEFAULT = {
  agent1: { baseUrl: "https://api.deepseek.com", apiKey: "", model: "", temperature: 0.6, hasApiKey: false },
  agent2: { baseUrl: "https://api.deepseek.com", apiKey: "", model: "", temperature: 0.6, hasApiKey: false },
  tasks: {},
};

function ModelEndpoint({ title, slot, value, onChange, testState, onTest }) {
  const availableModels = Array.from(new Set([
    ...(testState.models || []),
    ...(value.model ? [value.model] : []),
  ]));

  return (
    <section className="endpoint-panel">
      <h2>{title}</h2>
      <div className="endpoint-grid">
        <Field label="Base URL" hint="DeepSeek可使用 https://api.deepseek.com"><TextInput value={value.baseUrl} placeholder="https://api.deepseek.com" onChange={(e) => onChange("baseUrl", e.target.value)} /></Field>
        <Field label="API Key" hint={value.hasApiKey ? "已保存在本地服务器；留空不会覆盖" : "只写入本地 data/store.json，不会回显"}><TextInput type="password" value={value.apiKey} placeholder={value.hasApiKey ? "已保存 ••••••••" : "输入API Key"} onChange={(e) => onChange("apiKey", e.target.value)} /></Field>
        <Field label="模型名称" hint={testState.models?.length ? `已获取 ${testState.models.length} 个可用模型` : "先点击下方“获取模型”，再从列表选择"}>
          <select className="select model-select" value={value.model} onChange={(e) => onChange("model", e.target.value)} aria-label={`${title}模型名称`}>
            <option value="">{testState.loading ? "正在获取模型…" : "请选择模型"}</option>
            {availableModels.map((model) => <option key={model} value={model}>{model}{value.model === model && !testState.models?.includes(model) ? "（当前保存）" : ""}</option>)}
          </select>
        </Field>
        <Field label="温度"><TextInput type="number" min="0" max="2" step="0.1" value={value.temperature} onChange={(e) => onChange("temperature", e.target.value)} /></Field>
      </div>
      <div className="endpoint-actions">
        <button type="button" className="button button-secondary" onClick={onTest} disabled={testState.loading}>{testState.loading ? "正在获取…" : "获取模型"}</button>
        {testState.message && <span className={`connection-result ${testState.ok ? "ok" : "bad"}`}><span className="status-dot" />{testState.message}</span>}
      </div>
    </section>
  );
}

export default function ModelConfigPage({ notify }) {
  const [config, setConfig] = useState(DEFAULT);
  const [activeTask, setActiveTask] = useState("task1");
  const [saving, setSaving] = useState(false);
  const [tests, setTests] = useState({ agent1: {}, agent2: {} });

  useEffect(() => {
    api("/api/model-config")
      .then(({ modelConfig }) => setConfig(modelConfig))
      .catch((error) => notify(error.message, "error"));
  }, [notify]);

  function updateEndpoint(slot, key, value) {
    setConfig((current) => ({ ...current, [slot]: { ...current[slot], [key]: value } }));
    if (key === "baseUrl" || key === "apiKey") {
      setTests((current) => ({ ...current, [slot]: {} }));
    }
  }

  function updateTask(key, value) {
    setConfig((current) => ({
      ...current,
      tasks: { ...current.tasks, [activeTask]: { ...current.tasks[activeTask], [key]: value } },
    }));
  }

  async function test(slot) {
    setTests((current) => ({ ...current, [slot]: { loading: true } }));
    try {
      const result = await api(`/api/model-test/${slot}`, { method: "POST", body: jsonBody({ config: config[slot] }) });
      setTests((current) => ({ ...current, [slot]: { loading: false, ok: true, models: result.models, message: result.models.length ? `获取成功 · ${result.models.length}个模型` : `连接成功，但接口没有返回模型` } }));
      if (!config[slot].model && result.models[0]) updateEndpoint(slot, "model", result.models[0]);
    } catch (error) {
      setTests((current) => ({ ...current, [slot]: { loading: false, ok: false, message: error.message, models: [] } }));
    }
  }

  async function save() {
    setSaving(true);
    try {
      const result = await api("/api/model-config", { method: "PUT", body: jsonBody({ modelConfig: config }) });
      setConfig(result.modelConfig);
      notify("模型与任务配置已保存");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  const task = config.tasks?.[activeTask];
  return (
    <div className="page-stack">
      <div className="page-heading-row">
        <div><h1>模型与任务配置</h1><p>分别设置两个代理的OpenAI兼容端点，并维护每个Profile的交互与recap提示词。</p></div>
        <button className="button button-primary" onClick={save} disabled={saving}><Icon name="save" size={17} />{saving ? "保存中…" : "保存全部配置"}</button>
      </div>
      <div className="endpoint-layout">
        <ModelEndpoint title="Agent 1" slot="agent1" value={config.agent1} onChange={(key, value) => updateEndpoint("agent1", key, value)} testState={tests.agent1} onTest={() => test("agent1")} />
        <ModelEndpoint title="Agent 2" slot="agent2" value={config.agent2} onChange={(key, value) => updateEndpoint("agent2", key, value)} testState={tests.agent2} onTest={() => test("agent2")} />
      </div>
      <section className="task-editor">
        <div className="task-tabs">
          {["task1", "task2", "task3"].map((key, index) => (
            <button key={key} className={activeTask === key ? "active" : ""} onClick={() => setActiveTask(key)}>
              Task {index + 1}{key === "task3" && !config.tasks?.task3?.enabled ? "（未启用）" : ""}
            </button>
          ))}
        </div>
        {task && (
          <div className="task-editor-body">
            <div className="task-meta-row">
              <Field label="任务名称"><TextInput value={task.label} onChange={(e) => updateTask("label", e.target.value)} /></Field>
              <label className="switch-row"><input type="checkbox" checked={task.enabled} onChange={(e) => updateTask("enabled", e.target.checked)} /><span>启用该任务</span></label>
              <div className="fixed-rule"><span>最大回合</span><strong>10</strong></div>
            </div>
            <Field label="系统提示词" hint="用于指导两个代理完成当前Profile；参与者配置将在运行时附加。"><TextArea className="code-textarea" rows="14" value={task.systemPrompt} onChange={(e) => updateTask("systemPrompt", e.target.value)} /></Field>
            <Field label="第一阶段结束信号" hint="仅供模型协议使用；服务端会将其转换为不可见元数据，不保存到transcript，也不发送给另一代理。"><TextInput value={task.completionPhrase} readOnly /></Field>
            <Field label="Recap提取规则" hint="界面标题与字段结构由系统固定，以保证A/B一致；这里仅配置各Task应提取或忽略的信息。"><TextArea className="code-textarea" rows="8" value={task.recapPrompt} onChange={(e) => updateTask("recapPrompt", e.target.value)} /></Field>
          </div>
        )}
      </section>
    </div>
  );
}
