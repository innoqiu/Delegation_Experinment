import { useEffect, useMemo, useState } from "react";
import { api, jsonBody } from "../api.js";
import { Field, TextArea, TextInput } from "../components/FormControls.jsx";
import { Icon } from "../components/Icons.jsx";

const TASK_KEYS = ["task1", "task2", "task3"];
const FIELD_TYPES = [
  { value: "textarea", label: "多行文本" },
  { value: "text", label: "单行文本" },
  { value: "number", label: "数字" },
  { value: "multiselect", label: "多选" },
];

function optionsToText(options = []) {
  return options.map((option) => `${option.value}|${option.label}`).join("\n");
}

function textToOptions(text) {
  return String(text || "").split(/\r?\n/).flatMap((line) => {
    const [value, ...labelParts] = line.split("|");
    const cleanValue = value?.trim();
    const label = labelParts.join("|").trim() || cleanValue;
    return cleanValue && label ? [{ value: cleanValue.slice(0, 80), label: label.slice(0, 120) }] : [];
  }).slice(0, 20);
}

export default function ProfileSchemaPage({ notify }) {
  const [schemas, setSchemas] = useState(null);
  const [activeTask, setActiveTask] = useState("task1");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api("/api/profile-schemas")
      .then(({ profileSchemas }) => setSchemas(profileSchemas))
      .catch((error) => notify(error.message, "error"));
  }, [notify]);

  const schema = schemas?.[activeTask];
  const taskNumber = TASK_KEYS.indexOf(activeTask) + 1;
  const updateSchema = (changes) => setSchemas((current) => ({
    ...current,
    [activeTask]: { ...current[activeTask], ...changes },
  }));
  const updateField = (index, changes) => updateSchema({
    fields: schema.fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...changes } : field),
  });

  function addField() {
    const key = `field_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    updateSchema({ fields: [...schema.fields, { key, label: "新问题", hint: "", placeholder: "", type: "textarea", wide: false }] });
  }

  function removeField(index) {
    if (schema.fields.length === 1) return notify("每个 Profile 至少保留一个固定问题", "error");
    if (!window.confirm(`删除固定问题“${schema.fields[index].label}”？参与者已经填写的同名数据将不再用于未来会话。`)) return;
    updateSchema({ fields: schema.fields.filter((_, fieldIndex) => fieldIndex !== index) });
  }

  function moveField(index, offset) {
    const target = index + offset;
    if (target < 0 || target >= schema.fields.length) return;
    const fields = [...schema.fields];
    [fields[index], fields[target]] = [fields[target], fields[index]];
    updateSchema({ fields });
  }

  async function save() {
    setSaving(true);
    try {
      const { profileSchemas } = await api("/api/profile-schemas", {
        method: "PUT",
        body: jsonBody({ profileSchemas: schemas }),
      });
      setSchemas(profileSchemas);
      notify("Profile 固定结构已更新；新会话将使用当前版本");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  const profileLabel = useMemo(() => schema ? `Profile ${taskNumber} · ${schema.title}` : "Profile 结构", [schema, taskNumber]);

  if (!schemas) return <div className="screen-center"><div className="loader" />正在读取 Profile 结构…</div>;

  return (
    <div className="page-stack schema-page">
      <div className="page-heading-row">
        <div>
          <h1>Profile 固定结构</h1>
          <p>管理员可调整每个实验条件的标题、说明与固定问题。参与者仍可在个人配置中添加自己的补充条件。</p>
        </div>
        <button className="button button-primary" onClick={save} disabled={saving}><Icon name="save" size={17} />{saving ? "保存中…" : "保存全部结构"}</button>
      </div>

      <div className="schema-notice">
        <strong>版本规则</strong>
        <span>改动会立即影响当前问卷和未来代理会话；已经开始的会话保留其 Profile 结构快照，不会被追溯修改。</span>
      </div>

      <section className="task-editor schema-editor">
        <div className="task-tabs" role="tablist" aria-label="Profile 选择">
          {TASK_KEYS.map((task, index) => <button key={task} type="button" className={activeTask === task ? "active" : ""} onClick={() => setActiveTask(task)}>Profile {index + 1}</button>)}
        </div>
        <div className="schema-editor-body">
          <div className="schema-title-row">
            <Field label="Profile 标题"><TextInput value={schema.title} maxLength={120} onChange={(event) => updateSchema({ title: event.target.value })} /></Field>
            <Field label="Profile 描述"><TextArea value={schema.description} maxLength={1000} onChange={(event) => updateSchema({ description: event.target.value })} /></Field>
          </div>

          <div className="schema-list-heading">
            <div><h2>{profileLabel} 的固定问题</h2><p>顺序即参与者看到的顺序。稳定 key 用于保存数据，创建后不可编辑。</p></div>
            <button type="button" className="button button-secondary" onClick={addField} disabled={schema.fields.length >= 30}><Icon name="plus" size={16} />添加固定问题</button>
          </div>

          <div className="schema-fields-list">
            {schema.fields.map((field, index) => (
              <article className="schema-field-card" key={field.key}>
                <div className="schema-field-index"><span>{String(index + 1).padStart(2, "0")}</span><code>{field.key}</code></div>
                <div className="schema-field-main">
                  <div className="schema-field-grid">
                    <Field label="问题标题"><TextInput value={field.label} maxLength={120} onChange={(event) => updateField(index, { label: event.target.value })} /></Field>
                    <Field label="回答类型">
                      <select className="select" value={field.type} onChange={(event) => updateField(index, { type: event.target.value, ...(event.target.value === "multiselect" && !field.options ? { options: [{ value: "option1", label: "选项 1" }] } : {}) })}>
                        {FIELD_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                      </select>
                    </Field>
                    <Field label="说明 / 提示" className="span-two"><TextInput value={field.hint || ""} maxLength={500} onChange={(event) => updateField(index, { hint: event.target.value })} /></Field>
                    {field.type !== "multiselect" && <Field label="输入框示例" hint="以灰色placeholder显示，不会保存为参与者答案" className="span-two"><TextArea value={field.placeholder || ""} maxLength={1000} onChange={(event) => updateField(index, { placeholder: event.target.value })} /></Field>}
                    {field.type === "number" && <>
                      <Field label="最小值"><TextInput type="number" value={field.min ?? ""} onChange={(event) => updateField(index, { min: event.target.value === "" ? undefined : Number(event.target.value) })} /></Field>
                      <Field label="最大值"><TextInput type="number" value={field.max ?? ""} onChange={(event) => updateField(index, { max: event.target.value === "" ? undefined : Number(event.target.value) })} /></Field>
                    </>}
                    {field.type === "multiselect" && <Field label="多选选项" hint="每行一个，格式为 value|显示文字；value 保存后应保持稳定" className="span-two"><TextArea value={optionsToText(field.options)} onChange={(event) => updateField(index, { options: textToOptions(event.target.value) })} /></Field>}
                  </div>
                  <label className="schema-wide-toggle"><input type="checkbox" checked={Boolean(field.wide)} onChange={(event) => updateField(index, { wide: event.target.checked })} />在问卷中占用双列宽度</label>
                </div>
                <div className="schema-field-actions">
                  <button type="button" className="icon-button" aria-label="上移" title="上移" disabled={index === 0} onClick={() => moveField(index, -1)}>↑</button>
                  <button type="button" className="icon-button" aria-label="下移" title="下移" disabled={index === schema.fields.length - 1} onClick={() => moveField(index, 1)}>↓</button>
                  <button type="button" className="icon-button danger-icon" aria-label="删除问题" title="删除问题" onClick={() => removeField(index)}><Icon name="trash" size={16} /></button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
