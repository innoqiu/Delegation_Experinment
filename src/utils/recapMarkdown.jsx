import { Fragment } from "react";

const LEGACY_LAYOUTS = {
  task1: [
    ["candidate", "候选方案"],
    ["turning_points", "关键协商节点"],
    ["alignment", "已对齐"],
    ["tradeoffs", "差异与取舍"],
    ["open_items", "待确认"],
    ["actions", "你的决定"],
  ],
  task2: [
    ["recommendation", "当前建议"],
    ["evidence", "支持依据"],
    ["path_probe", "关键试探"],
    ["mismatch", "不匹配与边界"],
    ["first_contact", "首次接触条件"],
    ["change_conditions", "什么会改变建议"],
    ["actions", "你的决定"],
  ],
  task3: [
    ["allocation", "当前分配"],
    ["needs", "需求与依据"],
    ["turning_points", "关键协商节点"],
    ["conditions", "条件与未来义务"],
    ["open_items", "待确认"],
    ["actions", "你的决定"],
  ],
};

const LEGACY_MAX_ITEMS = { candidate: 6, allocation: 3, turning_points: 2, actions: 3 };
const LEGACY_HEADLINES = { task1: "社交计划概览", task2: "关系探索建议", task3: "资源分配结果" };

function cleanLegacyLine(value) {
  return String(value || "")
    .replace(/^>\s*/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .replace(/[，；。]?任何选择都不应替你决定.*$/u, "")
    .replace(/[，；。]?代理不会自行(?:预订|预约|付款).*$/u, "")
    .replace(/具体展馆和咖啡馆尚未确定.*$/u, "具体展馆和咖啡馆待确认")
    .replace(/，该条件目前以“?最好”?形式保留，并非硬性。?$/u, "（软偏好）")
    .replace(/(?:待双方?本人批准|尚未生效|不具有约束力)/gu, "")
    .replace(/^的计划：/u, "计划：")
    .trim();
}

function isLegacyBoilerplate(value) {
  return !value
    || /^(再次强调|注意|请审阅上述|请查看以上|以上只是|以下为)/u.test(value)
    || /仅为代理层达成的候选方案/u.test(value)
    || (/^(该|此|最终|所有)/u.test(value) && /(批准|决定|生效|约束力)/u.test(value));
}

function legacyTarget(task, heading) {
  if (/需要.*行动|你的决定/u.test(heading)) return "actions";
  if (/未决|待确认/u.test(heading)) return "open_items";
  if (task === "task1") {
    if (/候选|结果/u.test(heading)) return "candidate";
    if (/形成过程/u.test(heading)) return "turning_points";
    if (/契合|取舍/u.test(heading)) return "tradeoffs";
    if (/边界|授权/u.test(heading)) return "open_items";
  }
  if (task === "task2") {
    if (/建议/u.test(heading)) return "recommendation";
    if (/依据|契合/u.test(heading)) return "evidence";
    if (/试探|关系路径/u.test(heading)) return "path_probe";
    if (/不匹配|边界|不确定/u.test(heading)) return "mismatch";
    if (/首次|节奏|关系目的/u.test(heading)) return "first_contact";
    if (/改变建议/u.test(heading)) return "change_conditions";
  }
  if (task === "task3") {
    if (/分配方案/u.test(heading)) return "allocation";
    if (/需求|公平|依据|取舍/u.test(heading)) return "needs";
    if (/协商形成|形成过程/u.test(heading)) return "turning_points";
    if (/条件|补偿|义务|边界/u.test(heading)) return "conditions";
  }
  return null;
}

function legacyItems(body, target) {
  const status = target === "actions" ? "needs_decision" : target === "open_items" ? "unresolved" : "proposed";
  const seen = new Set();
  const items = [];
  for (const rawLine of String(body || "").split("\n")) {
    if (!/^\s*(?:[-*]|\d+[.)]|>)/.test(rawLine)) continue;
    const value = cleanLegacyLine(rawLine);
    if (isLegacyBoilerplate(value) || value.endsWith("：") || seen.has(value)) continue;
    seen.add(value);
    const separator = value.indexOf("：");
    const possibleLabel = separator > 0 && separator <= 14 ? value.slice(0, separator) : "";
    const detail = possibleLabel ? value.slice(separator + 1).trim() : value;
    if (!detail) continue;
    items.push({
      label: possibleLabel,
      value: detail.length > 140 ? `${detail.slice(0, 137)}…` : detail,
      status: /(待确认|尚未确定|未确定)/u.test(detail) ? "unresolved" : status,
      evidence: "",
    });
    if (items.length >= (LEGACY_MAX_ITEMS[target] || 3)) break;
  }
  return items;
}

export function legacyRecapToStructured(markdown = "", task = "task1") {
  const layout = LEGACY_LAYOUTS[task] || LEGACY_LAYOUTS.task1;
  const sectionMap = new Map(layout.map(([id, title]) => [id, { id, title, items: [] }]));
  for (const legacySection of parseRecapSections(markdown)) {
    const target = legacyTarget(task, legacySection.heading);
    if (!target || !sectionMap.has(target)) continue;
    const current = sectionMap.get(target);
    const limit = LEGACY_MAX_ITEMS[target] || 3;
    const extracted = legacyItems(legacySection.body, target);
    if (["candidate", "recommendation", "allocation"].includes(target) && sectionMap.has("open_items")) {
      const pending = extracted.filter((item) => item.status === "unresolved");
      sectionMap.get("open_items").items.push(...pending);
      current.items = [...current.items, ...extracted.filter((item) => item.status !== "unresolved")].slice(0, limit);
    } else {
      current.items = [...current.items, ...extracted].slice(0, limit);
    }
  }
  const seen = new Set();
  const sections = layout.map(([id]) => {
    const section = sectionMap.get(id);
    section.items = section.items.filter((item) => {
      const key = item.value.replace(/[，。；\s]/g, "").slice(0, 60);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, LEGACY_MAX_ITEMS[id] || 3);
    return section;
  });
  return {
    schemaVersion: 0,
    task,
    legacy: true,
    headline: LEGACY_HEADLINES[task] || "代理互动结果",
    summary: "",
    outcomeStatus: "partial",
    sections,
  };
}

export function parseRecapSections(markdown = "") {
  const sections = [];
  let current = { heading: "概览", lines: [] };
  for (const rawLine of String(markdown).replace(/\r\n/g, "\n").split("\n")) {
    const heading = rawLine.match(/^##\s+(.+)$/);
    if (heading) {
      if (current.lines.some((line) => line.trim())) sections.push(current);
      current = { heading: heading[1].trim(), lines: [] };
    } else {
      current.lines.push(rawLine);
    }
  }
  if (current.lines.some((line) => line.trim()) || !sections.length) sections.push(current);
  return sections.map((section, index) => ({
    ...section,
    id: `section-${index + 1}`,
    body: section.lines.join("\n").trim(),
  }));
}

function renderInline(text) {
  return String(text).split(/(\*\*[^*]+\*\*)/g).map((part, index) => (
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
      : <Fragment key={`${part}-${index}`}>{part}</Fragment>
  ));
}

export function MarkdownSectionBody({ body }) {
  const blocks = [];
  let bullets = [];
  const flushBullets = () => {
    if (!bullets.length) return;
    blocks.push(<ul key={`list-${blocks.length}`}>{bullets.map((line, index) => <li key={`${line}-${index}`}>{renderInline(line)}</li>)}</ul>);
    bullets = [];
  };

  for (const rawLine of String(body || "").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushBullets();
      continue;
    }
    if (line === "---") {
      flushBullets();
      blocks.push(<hr key={`hr-${blocks.length}`} />);
      continue;
    }
    if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
      continue;
    }
    flushBullets();
    if (line.startsWith("### ")) {
      blocks.push(<h4 key={`h-${blocks.length}`}>{renderInline(line.slice(4))}</h4>);
    } else {
      blocks.push(<p key={`p-${blocks.length}`}>{renderInline(line)}</p>);
    }
  }
  flushBullets();
  return blocks;
}
