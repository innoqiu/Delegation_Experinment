import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const dataDir = mkdtempSync(join(tmpdir(), "proxylab-review-ui-"));
const chromeProfile = mkdtempSync(join(tmpdir(), "proxylab-review-chrome-"));
const screenshotPath = join(projectDir, "..", "proxylab-review-flow-qa.png");
const revisionScreenshotPath = join(projectDir, "..", "proxylab-revision-qa.png");
const adminRevisionScreenshotPath = join(projectDir, "..", "proxylab-admin-revision-qa.png");
const codingScreenshotPath = join(projectDir, "..", "proxylab-coding-workspace-qa.png");
const codingSummaryScreenshotPath = join(projectDir, "..", "proxylab-coding-summary-qa.png");
const uploadedTranscriptScreenshotPath = join(projectDir, "..", "proxylab-uploaded-transcript-qa.png");
const completionPhrase = "我认为任务已完成申请结束";
let appProcess;
let chromeProcess;

function listen(server, host = "127.0.0.1") {
  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, host, () => resolvePromise(server.address().port));
  });
}

function close(server) {
  return new Promise((resolvePromise) => server.close(resolvePromise));
}

function safeRemove(path) {
  try { rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* Chrome may briefly retain its profile on Windows. */ }
}

async function waitFor(check, message, attempts = 160) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await check();
      if (value) return value;
    } catch { /* The asynchronous UI or server may still be updating. */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(message);
}

const mockModel = createServer(async (req, res) => {
  if (req.url === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ data: [{ id: "mock-model" }] }));
  }
  if (req.url === "/v1/chat/completions" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const system = body.messages?.[0]?.content || "";
    const content = system.includes("不可见的第二阶段结束审核器")
      ? "READY_TO_CLOSE"
      : system.includes("recap生成器")
        ? JSON.stringify({
            headline: "周六下午的候选计划",
            summary: "时间已初步对齐，具体地点与最终参加仍需本人确认。",
            outcomeStatus: "ready_for_review",
            sections: {
              candidate: [{ label: "时间", value: "周六14:30–17:30", status: "agreed", evidence: "双方代理第1轮" }],
              open_items: [{ label: "地点", value: "展馆与咖啡馆尚未确定", status: "unresolved", evidence: "双方代理第1轮" }],
              actions: [{ label: "后续", value: "由双方本人确认地点与是否参加", status: "needs_decision", evidence: "候选方案" }],
            },
          })
        : `我建议先保留周六下午，并继续确认具体地点。\n${completionPhrase}`;
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  }
  res.writeHead(404).end();
});

const mockPort = await listen(mockModel);
const appPort = 45_000 + Math.floor(Math.random() * 5_000);
const debugPort = 40_000 + Math.floor(Math.random() * 3_000);
const appUrl = `http://127.0.0.1:${appPort}/`;

async function api(path, { token, method = "GET", body, expected = 200 } = {}) {
  const response = await fetch(`${appUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  return payload;
}

async function connectPage() {
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const pages = await response.json();
    return pages.find((page) => page.type === "page" && page.url.startsWith(appUrl));
  }, "Chrome page did not become available");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolvePromise, rejectPromise) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", rejectPromise, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) {
      events.push(message);
      return;
    }
    if (!pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.rejectPromise(new Error(message.error.message));
    else entry.resolvePromise(message.result);
  });
  function call(method, params = {}) {
    const callId = ++id;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error(`CDP timeout: ${method}`)), 15_000);
      pending.set(callId, {
        resolvePromise: (value) => { clearTimeout(timer); resolvePromise(value); },
        rejectPromise: (error) => { clearTimeout(timer); rejectPromise(error); },
      });
      try {
        socket.send(JSON.stringify({ id: callId, method, params }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(callId);
        rejectPromise(error);
      }
    });
  }
  return { socket, call, events };
}

async function evaluate(call, expression) {
  const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

try {
  appProcess = spawn(process.execPath, ["server.mjs"], {
    cwd: projectDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(appPort),
      DATA_DIR: dataDir,
      PROFILE_REVISION_PASSWORD: "reentry",
    },
    stdio: "ignore",
  });
  await waitFor(async () => (await fetch(`${appUrl}api/health`)).ok, "ProxyLab server did not start");

  const admin = await api("/api/login", { method: "POST", body: { id: "admin_arklab" } });
  const participant = await api("/api/login", { method: "POST", body: { id: "P0A" } });
  const config = await api("/api/model-config", { token: admin.token });
  for (const slot of ["agent1", "agent2"]) {
    Object.assign(config.modelConfig[slot], {
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      model: "mock-model",
      apiKey: "test",
    });
  }
  await api("/api/model-config", { token: admin.token, method: "PUT", body: config });
  const created = await api("/api/sessions", {
    token: admin.token,
    method: "POST",
    expected: 201,
    body: { participantA: "P0A", participantB: "P0B", task: "task1" },
  });
  await waitFor(async () => {
    const detail = await api(`/api/sessions/${created.session.id}`, { token: admin.token });
    return detail.session.status === "completed" ? detail.session : null;
  }, "Synthetic review session did not complete");

  chromeProcess = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--remote-allow-origins=*",
    "--no-first-run",
    "--window-size=1440,1100",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${chromeProfile}`,
    appUrl,
  ], { stdio: "ignore" });
  const client = await connectPage();
  await client.call("Runtime.enable");
  await client.call("Page.enable");
  await client.call("Log.enable");
  await client.call("Page.navigate", { url: appUrl });
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('进入实验系统')"), "Login page did not load");
  await evaluate(client.call, `(() => {
    const input = document.querySelector('.login-panel input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'P0A');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.login-panel button').click();
    return true;
  })()`);
  await waitFor(() => evaluate(client.call, "document.querySelectorAll('.nav-list .nav-item').length === 3"), "Participant app did not load");
  await evaluate(client.call, `([...document.querySelectorAll('.nav-item')].find((node) => node.innerText.trim() === 'Recap')).click(); true`);
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('周六下午的候选计划')"), "Recap did not render");

  await evaluate(client.call, `(() => {
    const paragraph = document.querySelector('.recap-section-card .report-item p');
    const root = paragraph.closest('.annotatable-content');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return true;
  })()`);
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('信任变化') && document.body.innerText.includes('代理权限')"), "Grouped annotation controls did not appear");
  assert.equal(await evaluate(client.call, "document.body.innerText.includes('简述标记原因')"), true);
  await evaluate(client.call, `(() => {
    const click = (label) => [...document.querySelectorAll('.selection-tags button')].find((node) => node.innerText.trim() === label).click();
    click('重要');
    click('这段话使我对 Agent 的信任下降了');
    click('我觉得我的 Agent 在这里越权了');
    const textarea = document.querySelector('.selection-reason textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, '代理在未获最终授权时形成了过强的确定性');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('.selection-toolbar .button-primary')].find((node) => node.innerText.includes('保存标记')).click();
    return true;
  })()`);
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('标记原因：') && document.body.innerText.includes('信任下降了')"), "Annotation was not rendered");
  assert.equal(await evaluate(client.call, "document.querySelectorAll('.section-decision').length"), 0);
  assert.equal(await evaluate(client.call, "document.body.innerText.includes('你觉得对方对于这件事的预期是什么？') && document.body.innerText.includes('后续联系笔记')"), true);
  assert.equal(await evaluate(client.call, "document.body.innerText.includes('回看／修改本任务配置')"), false);
  const reviewScreenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(screenshotPath, Buffer.from(reviewScreenshot.data, "base64"));

  await evaluate(client.call, `(() => { window.confirm = () => true; document.querySelector('.annotation-cancel-button').click(); return true; })()`);
  await waitFor(() => evaluate(client.call, "document.querySelectorAll('.annotation-record').length === 0"), "Cancelled annotation remained visible");
  await evaluate(client.call, `([...document.querySelectorAll('.nav-item')].find((node) => node.innerText.trim() === 'Agent配置')).click(); true`);
  await waitFor(() => evaluate(client.call, "Boolean(document.querySelector('.revision-quick-unlock input'))"), "Profile-page revision gate did not render");
  assert.equal(await evaluate(client.call, `(() => {
    const button = document.querySelector('.revision-quick-unlock button').getBoundingClientRect();
    const input = document.querySelector('.revision-quick-unlock input').getBoundingClientRect();
    return button.left < input.left;
  })()`), true);
  await evaluate(client.call, `(() => {
    const input = document.querySelector('.revision-quick-unlock input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'reentry');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor(() => evaluate(client.call, "!document.querySelector('.revision-quick-unlock button').disabled"), "Revision unlock button remained disabled");
  await evaluate(client.call, "document.querySelector('.revision-quick-unlock button').click(); true");
  await waitFor(() => evaluate(client.call, "document.querySelectorAll('.revision-slide-toggle input').length === 3"), "All three Profile revision toggles did not unlock");
  assert.equal(await evaluate(client.call, "document.querySelectorAll('.profile-version-original').length"), 3);
  assert.equal(await evaluate(client.call, "[...document.querySelectorAll('.profile-version-original textarea')].every((node) => node.readOnly)"), true);
  await evaluate(client.call, "[...document.querySelectorAll('.revision-slide-toggle input')].forEach((node) => node.click()); true");
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('原配置') && document.body.innerText.includes('修改副本')"), "Side-by-side revision view did not render");
  assert.equal(await evaluate(client.call, "document.querySelectorAll('.profile-version-revised').length"), 3);
  await evaluate(client.call, `(() => {
    const textarea = document.querySelector('.profile-version-revised .study-intent-card textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, '测试修改：代理只能形成候选方案');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('未保存内容已暂存')"), "Revision draft did not become dirty");
  await evaluate(client.call, "document.querySelector('.profile-save-footer .button-primary').click(); true");
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('配置回看已记录')"), "Revision diff was not saved");
  const participantSession = await api(`/api/sessions/${created.session.id}`, { token: participant.token });
  assert.deepEqual(participantSession.session.configurationRevisions.P0A.map((revision) => revision.task), ["task1", "task2", "task3"]);
  const savedRevision = participantSession.session.configurationRevisions.P0A.find((revision) => revision.task === "task1");
  assert.equal(savedRevision.originalProfile.studyIntent.authorizationIntent === savedRevision.revisedProfile.studyIntent.authorizationIntent, false);
  await api(`/api/sessions/${created.session.id}/annotations`, {
    token: participant.token,
    method: "POST",
    expected: 201,
    body: { targetType: "message", targetId: "P0B_T1_1", quote: "周六下午", tags: ["unexpected", "agent_overreach"], note: "需要追溯对方代理为何接受" },
  });
  await api("/api/coding/annotations", {
    token: admin.token,
    method: "POST",
    expected: 201,
    body: { scheme: "interaction", targetType: "transcript", targetId: `message:${created.session.id}:P0B_T1_1`, quote: "周六下午", codes: ["AA_STRUCTURAL", "RECIPROCAL_UPTAKE", "INSPECT"], note: "检查代理如何共同收敛" },
  });
  const revisionScreenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(revisionScreenshotPath, Buffer.from(revisionScreenshot.data, "base64"));

  await evaluate(client.call, "localStorage.clear(); location.href = '/'; true");
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('进入实验系统')"), "Login page did not return");
  await evaluate(client.call, `(() => {
    const input = document.querySelector('.login-panel input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'admin_arklab');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.login-panel button').click();
    return true;
  })()`);
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('模型配置')"), "Admin shell did not load");
  await evaluate(client.call, `([...document.querySelectorAll('.nav-item')].find((node) => node.innerText.trim() === 'Agent配置')).click(); true`);
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('Profile 前后修改记录') && document.body.innerText.includes('P0A - P0B - Task1')"), "Admin revision history did not render");
  await waitFor(() => evaluate(client.call, `([...document.querySelectorAll('.admin-profile-revisions .profile-version-revised textarea')]
    .some((node) => node.value.includes('测试修改：代理只能形成候选方案')))`) , "Revised profile value did not render in admin history");
  await evaluate(client.call, "document.querySelector('.admin-profile-revisions').scrollIntoView({ block: 'start' }); true");
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  const adminRevisionScreenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(adminRevisionScreenshotPath, Buffer.from(adminRevisionScreenshot.data, "base64"));
  await evaluate(client.call, `([...document.querySelectorAll('.nav-item')].find((node) => node.innerText.trim() === '定性编码')).click(); true`);
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('Profile changes') && document.body.innerText.includes('测试修改：代理只能形成候选方案')"), "Individual coding workspace did not render profile differences");
  assert.equal(await evaluate(client.call, "document.querySelectorAll('.coding-index button').length"), 2, "Coding roster must include participants without revisions");
  await evaluate(client.call, `(() => {
    const root = document.querySelector('.coding-source-text');
    const range = document.createRange();
    range.selectNodeContents(root);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return true;
  })()`);
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('REPRESENTATION_REGROUNDING')"), "Profile coding toolbar did not open");
  assert.equal(await evaluate(client.call, "document.querySelectorAll('.coding-code-group').length"), 1);
  assert.equal(await evaluate(client.call, "(() => { const rect = document.querySelector('.coding-toolbar .button-primary').getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= window.innerHeight; })()"), true, "Coding save action must remain visible");
  await evaluate(client.call, `([...document.querySelectorAll('.coding-code-options button')].find((node) => node.innerText.includes('REPRESENTATION_REGROUNDING'))).click(); true`);
  await waitFor(() => evaluate(client.call, "!document.querySelector('.coding-toolbar .button-primary').disabled"), "Profile coding save button remained disabled");
  await evaluate(client.call, "document.querySelector('.coding-toolbar .button-primary').click(); true");
  await waitFor(() => evaluate(client.call, "document.querySelectorAll('.coding-record').length === 1"), "Profile coding was not saved");
  await evaluate(client.call, `([...document.querySelectorAll('.coding-mode-tabs button')].find((node) => node.innerText.includes('双人对照 Coding'))).click(); true`);
  await waitFor(() => evaluate(client.call, "document.querySelectorAll('.coding-trace-column').length === 3"), "Pair coding comparison did not render three trace columns");
  assert.equal(await evaluate(client.call, "document.querySelectorAll('.highlight-participant').length > 0"), true);
  await evaluate(client.call, "(() => { const root = document.querySelector('.coding-message .coding-source-text'); const range = document.createRange(); range.selectNodeContents(root); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return true; })()");
  await waitFor(() => evaluate(client.call, "document.querySelectorAll('.coding-code-group').length === 3"), "Interaction coding groups did not render");
  assert.equal(await evaluate(client.call, "(() => { const groups = [...document.querySelectorAll('.coding-code-group')]; const save = document.querySelector('.coding-toolbar .button-primary').getBoundingClientRect(); return groups.every((group) => !group.open) && save.top >= 0 && save.bottom <= window.innerHeight; })()"), true, "Collapsed coding hierarchy or persistent save action is not visible");
  await evaluate(client.call, "document.querySelector('.coding-toolbar-head button').click(); true");
  await evaluate(client.call, `(() => {
    const textarea = document.querySelector('.interview-panel textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, '访谈：参与者需要澄清代理形成候选方案的依据。');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.interview-panel .button-primary').click();
    return true;
  })()`);
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('已保存文本 · 可直接编码')"), "Interview material was not saved or made codable");
  const codingScreenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(codingScreenshotPath, Buffer.from(codingScreenshot.data, "base64"));
  await evaluate(client.call, "([...document.querySelectorAll('.coding-mode-tabs button')].find((node) => node.innerText.includes('采访 Transcript'))).click(); true");
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('上传采访原文') && Boolean(document.querySelector('.uploaded-transcript-create textarea'))"), "Interview Transcript upload view did not render");
  await evaluate(client.call, "(() => { const input = document.querySelector('.uploaded-transcript-create input:not([type=file])'); const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; inputSetter.call(input, 'P0A-P0B Re-entry interview'); input.dispatchEvent(new Event('input', { bubbles: true })); const textarea = document.querySelector('.uploaded-transcript-create textarea'); const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; textareaSetter.call(textarea, '研究者：请说说你对代理结果的看法。\\nP0A：我需要澄清代理为何形成周六下午这个候选方案。'); textarea.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  await evaluate(client.call, "([...document.querySelectorAll('.uploaded-transcript-create .button-primary')].find((node) => node.innerText.includes('保存并开始编码'))).click(); true");
  await waitFor(() => evaluate(client.call, "document.querySelector('.uploaded-transcript-document h1')?.innerText.includes('P0A-P0B') && document.body.innerText.includes('Coded segments · 0')"), "Uploaded interview Transcript did not render in the three-column workspace");
  await evaluate(client.call, "(() => { const root = document.querySelector('.uploaded-transcript-document .coding-source-text'); const textNode = root.firstChild; const source = textNode.textContent; const start = source.indexOf('需要澄清'); const range = document.createRange(); range.setStart(textNode, start); range.setEnd(textNode, start + '需要澄清代理为何形成周六下午这个候选方案'.length); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return true; })()");
  await waitFor(() => evaluate(client.call, "document.querySelectorAll('.coding-code-group').length === 3"), "Interview Transcript coding toolbar did not open");
  await evaluate(client.call, "([...document.querySelectorAll('.coding-code-options button')].find((node) => node.textContent.includes('DELEGATION_GENERAL'))).click(); true");
  await evaluate(client.call, "([...document.querySelectorAll('.coding-code-options button')].find((node) => node.textContent.includes('POSITION_ENACTMENT'))).click(); true");
  await evaluate(client.call, "([...document.querySelectorAll('.coding-code-options button')].find((node) => node.textContent.includes('REGROUND_EXPLAIN'))).click(); true");
  await waitFor(() => evaluate(client.call, "!document.querySelector('.coding-toolbar .button-primary').disabled"), "Interview Transcript coding save button remained disabled");
  await evaluate(client.call, "document.querySelector('.coding-toolbar .button-primary').click(); true");
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('Coded segments · 1') && document.querySelectorAll('.uploaded-transcript-segments article').length === 1"), "Coded interview segment did not appear in the right panel");
  const uploadedTranscriptScreenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(uploadedTranscriptScreenshotPath, Buffer.from(uploadedTranscriptScreenshot.data, "base64"));
  await evaluate(client.call, "([...document.querySelectorAll('.coding-mode-tabs button')].find((node) => node.innerText.includes('编码汇总'))).click(); true");
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('编码汇总与原文导出') && document.querySelectorAll('.coding-export-actions button').length === 5"), "Coding summary or five original export actions did not render");
  await evaluate(client.call, "(() => { window.__codingDownloads = []; window.__originalAnchorClick = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { fetch(this.href).then((response) => response.text()).then((text) => window.__codingDownloads.push({ filename: this.download, text })); }; [...document.querySelectorAll('.coding-export-actions button')].find((node) => node.innerText.includes('Profile 修改')).click(); return true; })()");
  await waitFor(() => evaluate(client.call, "window.__codingDownloads.length === 1"), "Original-content export was not generated");
  const exportedProfileText = await evaluate(client.call, "window.__codingDownloads[0].text");
  const exportedProfileData = JSON.parse(exportedProfileText);
  assert.equal(exportedProfileData.category, "profile-changes");
  assert.equal(exportedProfileData.records.some((record) => record.after.includes("测试修改：代理只能形成候选方案")), true);
  assert.equal(exportedProfileText.includes("REPRESENTATION_REGROUNDING"), false, "Original export must not include research coding");
  await evaluate(client.call, "([...document.querySelectorAll('.coding-export-actions button')].find((node) => node.innerText.includes('采访 Transcript'))).click(); true");
  await waitFor(() => evaluate(client.call, "window.__codingDownloads.length === 2"), "Uploaded interview original-content export was not generated");
  const exportedInterviewText = await evaluate(client.call, "window.__codingDownloads[1].text");
  const exportedInterviewData = JSON.parse(exportedInterviewText);
  assert.equal(exportedInterviewData.category, "interview-transcripts");
  assert.equal(exportedInterviewData.records[0].text.includes("需要澄清代理为何形成周六下午"), true);
  assert.equal(exportedInterviewText.includes("POSITION_ENACTMENT"), false, "Uploaded interview original export must not include research coding");
  await evaluate(client.call, "([...document.querySelectorAll('.coding-filter-chips button')].find((node) => node.innerText.includes('REPRESENTATION_REGROUNDING'))).click(); true");
  await waitFor(() => evaluate(client.call, "document.querySelectorAll('.coding-summary-list article').length === 1"), "Code-filtered summary did not render the matching coding item");
  const codingSummaryScreenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(codingSummaryScreenshotPath, Buffer.from(codingSummaryScreenshot.data, "base64"));
  await evaluate(client.call, "document.querySelector('.coding-context-link').click(); true");
  await waitFor(() => evaluate(client.call, "document.querySelector('.coding-annotatable.coding-context-focus')?.innerText.includes('测试修改：代理只能形成候选方案')"), "Profile coding context jump did not locate and highlight its source");
  assert.equal(await evaluate(client.call, "[...document.querySelectorAll('.coding-mode-tabs button')].find((node) => node.classList.contains('active')).innerText.includes('单人 Coding')"), true);
  await evaluate(client.call, "([...document.querySelectorAll('.coding-mode-tabs button')].find((node) => node.innerText.includes('编码汇总'))).click(); true");
  await evaluate(client.call, "([...document.querySelectorAll('.coding-filter-chips button')].find((node) => node.innerText.includes('RECIPROCAL_UPTAKE'))).click(); true");
  await waitFor(() => evaluate(client.call, "document.querySelectorAll('.coding-summary-list article').length === 1"), "Interaction code filter did not render");
  await evaluate(client.call, "document.querySelector('.coding-context-link').click(); true");
  await waitFor(() => evaluate(client.call, "document.querySelector('.coding-annotatable.coding-context-focus')?.innerText.includes('周六下午')"), "Transcript coding context jump did not locate and highlight its source");
  assert.equal(await evaluate(client.call, "[...document.querySelectorAll('.coding-mode-tabs button')].find((node) => node.classList.contains('active')).innerText.includes('双人对照 Coding')"), true);
  await evaluate(client.call, "([...document.querySelectorAll('.coding-mode-tabs button')].find((node) => node.innerText.includes('编码汇总'))).click(); true");
  await evaluate(client.call, "([...document.querySelectorAll('.coding-filter-chips button')].find((node) => node.innerText.includes('POSITION_ENACTMENT'))).click(); true");
  await waitFor(() => evaluate(client.call, "document.querySelectorAll('.coding-summary-list article').length === 1"), "Uploaded interview code filter did not render");
  await evaluate(client.call, "document.querySelector('.coding-context-link').click(); true");
  await waitFor(() => evaluate(client.call, "document.querySelector('.uploaded-transcript-document .coding-annotatable.coding-context-focus')?.innerText.includes('需要澄清代理为何形成周六下午')"), "Uploaded interview coding context jump did not locate and highlight its source");
  assert.equal(await evaluate(client.call, "[...document.querySelectorAll('.coding-mode-tabs button')].find((node) => node.classList.contains('active')).innerText.includes('采访 Transcript')"), true);
  const relevantErrors = client.events.filter((event) => (
    event.method === "Runtime.exceptionThrown"
    || (event.method === "Runtime.consoleAPICalled" && event.params?.type === "error")
    || (event.method === "Log.entryAdded" && event.params?.entry?.level === "error")
  ));
  assert.deepEqual(relevantErrors, [], "Browser emitted runtime or console errors");
  client.socket.close();

  console.log(`Review-flow browser test passed. Screenshots: ${screenshotPath}, ${revisionScreenshotPath}, ${adminRevisionScreenshotPath}, ${codingScreenshotPath}, ${codingSummaryScreenshotPath}, ${uploadedTranscriptScreenshotPath}`);
} finally {
  chromeProcess?.kill();
  appProcess?.kill();
  await close(mockModel);
  safeRemove(dataDir);
  safeRemove(chromeProfile);
}
