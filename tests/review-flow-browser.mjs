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
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('使用说明')"), "Participant app did not load");
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
  await waitFor(() => evaluate(client.call, "Boolean(document.querySelector('.revision-slide-toggle input'))"), "Revision toggle did not unlock");
  await evaluate(client.call, "document.querySelector('.revision-slide-toggle input').click(); true");
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('原配置') && document.body.innerText.includes('修改副本')"), "Side-by-side revision view did not render");
  assert.equal(await evaluate(client.call, "document.querySelector('.profile-version-original textarea')?.readOnly"), true);
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
  const savedRevision = participantSession.session.configurationRevisions.P0A.at(-1);
  assert.equal(savedRevision.originalProfile.studyIntent.authorizationIntent === savedRevision.revisedProfile.studyIntent.authorizationIntent, false);
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
  const relevantErrors = client.events.filter((event) => (
    event.method === "Runtime.exceptionThrown"
    || (event.method === "Runtime.consoleAPICalled" && event.params?.type === "error")
    || (event.method === "Log.entryAdded" && event.params?.entry?.level === "error")
  ));
  assert.deepEqual(relevantErrors, [], "Browser emitted runtime or console errors");
  client.socket.close();

  console.log(`Review-flow browser test passed. Screenshots: ${screenshotPath}, ${revisionScreenshotPath}, ${adminRevisionScreenshotPath}`);
} finally {
  chromeProcess?.kill();
  appProcess?.kill();
  await close(mockModel);
  safeRemove(dataDir);
  safeRemove(chromeProfile);
}
