import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const debugPort = 40_000 + Math.floor(Math.random() * 3_000);
const appPort = 44_000 + Math.floor(Math.random() * 8_000);
const profileDir = mkdtempSync(join(projectDir, ".proxylab-browser-"));
const appDataDir = process.env.BROWSER_TEST_URL ? null : mkdtempSync(join(projectDir, ".proxylab-browser-data-"));
const appUrl = process.env.BROWSER_TEST_URL || `http://127.0.0.1:${appPort}/`;
const screenshotPath = process.env.BROWSER_SCREENSHOT_PATH || join(projectDir, "..", "proxylab-consent-qa.png");
const introScreenshotPath = process.env.BROWSER_INTRO_SCREENSHOT_PATH || join(projectDir, "..", "proxylab-participant-intro-qa.png");
const introMobileScreenshotPath = process.env.BROWSER_INTRO_MOBILE_SCREENSHOT_PATH || join(projectDir, "..", "proxylab-participant-intro-mobile-qa.png");
const profileScreenshotPath = process.env.BROWSER_PROFILE_SCREENSHOT_PATH || join(projectDir, "..", "proxylab-profile-qa.png");
const adminScreenshotPath = process.env.BROWSER_ADMIN_SCREENSHOT_PATH || join(projectDir, "..", "proxylab-admin-login-qa.png");
let appProcess;
let chrome;

async function waitFor(check, message, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await check();
      if (value) return value;
    } catch { /* The app, page, or debugging endpoint may still be starting. */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(message);
}

if (!process.env.BROWSER_TEST_URL) {
  appProcess = spawn(process.execPath, ["server.mjs"], {
    cwd: projectDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(appPort),
      DATA_DIR: appDataDir,
    },
    stdio: "ignore",
  });
  await waitFor(async () => (await fetch(`${appUrl}api/health`)).ok, "Isolated ProxyLab server did not start");
}

chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--disable-extensions",
  "--remote-allow-origins=*",
  "--no-first-run",
  "--window-size=1440,1000",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  appUrl,
], { stdio: "ignore" });

async function connectPage() {
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const pages = await response.json();
    return pages.find((page) => page.type === "page" && page.webSocketDebuggerUrl);
  }, "Chrome DevTools page did not become available");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolvePromise, rejectPromise) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", rejectPromise, { once: true });
  });
  let callId = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) {
      events.push(message);
      return;
    }
    if (!pending.has(message.id)) return;
    const { resolvePromise, rejectPromise } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) rejectPromise(new Error(message.error.message));
    else resolvePromise(message.result);
  });
  function call(method, params = {}) {
    const id = ++callId;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        rejectPromise(new Error(`Chrome DevTools call timed out: ${method}`));
      }, 15_000);
      pending.set(id, {
        resolvePromise: (value) => { clearTimeout(timeout); resolvePromise(value); },
        rejectPromise: (error) => { clearTimeout(timeout); rejectPromise(error); },
      });
    });
  }
  return { socket, call, events };
}

async function evaluate(call, expression) {
  const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed");
  }
  return result.result.value;
}

const fillAndSubmitScript = (value) => `(() => {
  const input = document.querySelector('input');
  const button = [...document.querySelectorAll('button')].find((item) => item.innerText.trim() === '登录');
  if (!input || !button) throw new Error('Login controls not found');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  button.click();
  return true;
})()`;

let client;
try {
  client = await connectPage();
  await client.call("Runtime.enable");
  await client.call("Log.enable");
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('进入实验系统')"), "Participant login page did not render");
  assert.equal(await evaluate(client.call, "location.origin"), new URL(appUrl).origin);
  assert.match(await evaluate(client.call, "document.title"), /ProxyLab/);
  const publicLoginText = await evaluate(client.call, "document.body.innerText");
  assert.doesNotMatch(publicLoginText, /admin|管理员/i);

  await evaluate(client.call, fillAndSubmitScript("P1-HUANYI"));
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('研究参与知情同意')"), "Consent form did not render for a first-time participant");
  const consentText = await evaluate(client.call, "document.body.innerText");
  assert.match(consentText, /HKUST\(GZ\)-HSP-2026-0135/);
  assert.match(consentText, /TONG XIN/);
  assert.match(consentText, /FANGZE QIU/);
  assert.match(consentText, /2026年07月06日—2030年07月05日/);
  assert.equal(await evaluate(client.call, "[...document.querySelectorAll('button')].find((item) => item.innerText.includes('同意并进入研究')).disabled"), true);
  const screenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  await evaluate(client.call, `(() => {
    document.querySelectorAll('.consent-check input').forEach((input) => input.click());
    return true;
  })()`);
  await waitFor(() => evaluate(client.call, "![...document.querySelectorAll('button')].find((item) => item.innerText.includes('同意并进入研究')).disabled"), "Consent submit did not enable");
  await evaluate(client.call, "[...document.querySelectorAll('button')].find((item) => item.innerText.includes('同意并进入研究')).click(); true");
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('先告诉 Agent，怎样代表你')"), "Participant introduction page did not render after login");
  const introText = await evaluate(client.call, "document.body.innerText");
  assert.match(introText, /配置你的 Agent/);
  assert.match(introText, /按需添加配置项/);
  assert.match(introText, /点击保存配置/);
  assert.doesNotMatch(introText, /模型配置|历史/);
  const introScreenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(introScreenshotPath, Buffer.from(introScreenshot.data, "base64"));
  await client.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate(client.call, "document.documentElement.scrollWidth <= document.documentElement.clientWidth"), true);
  const introMobileScreenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(introMobileScreenshotPath, Buffer.from(introMobileScreenshot.data, "base64"));
  await client.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate(client.call, "[...document.querySelectorAll('button')].find((item) => item.innerText.includes('开始配置')).click(); true");
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('授权意图记录')"), "Accepted participant did not enter the profile page");
  assert.equal(await evaluate(client.call, "document.querySelector('.page-heading-row .button-primary') === null"), true);
  const profileText = await evaluate(client.call, "document.body.innerText");
  assert.match(profileText, /帮你和朋友们安排本周出游或聚会/);
  assert.match(profileText, /帮你进行初步交友/);
  assert.match(profileText, /本轮共10个相同的支持额度/);
  assert.doesNotMatch(profileText, /允许代理披露的信息|限制披露的信息/);
  assert.equal(await evaluate(client.call, "document.querySelector('[placeholder*=\"当代艺术展\"]') !== null"), true);
  assert.equal(await evaluate(client.call, "document.querySelector('[placeholder=\"例如：7\"]')?.value"), "");
  await evaluate(client.call, `(() => {
    const field = document.querySelector('[placeholder*="当代艺术展"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(field, '周末去看展');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  assert.equal(await evaluate(client.call, "document.querySelector('[placeholder*=\"当代艺术展\"]')?.value"), "周末去看展");
  await waitFor(() => evaluate(client.call, "Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).some((key) => key.includes('proxylab_profile_draft_v1:P1-HUANYI'))"), "Profile draft was not stored in the browser");
  await evaluate(client.call, "[...document.querySelectorAll('.nav-item')].find((item) => item.innerText.trim() === 'Recap').click(); true");
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('会话列表')"), "Participant could not switch to Recap");
  await evaluate(client.call, "[...document.querySelectorAll('.nav-item')].find((item) => item.innerText.trim() === 'Agent配置').click(); true");
  await waitFor(() => evaluate(client.call, "document.querySelector('[placeholder*=\"当代艺术展\"]')?.value === '周末去看展'"), "Profile draft did not survive page switching");
  assert.match(await evaluate(client.call, "document.body.innerText"), /未保存内容已暂存于当前浏览器/);
  assert.equal(await evaluate(client.call, "document.querySelector('.profile-save-footer .button-primary')?.innerText.includes('保存配置')"), true);
  await evaluate(client.call, "document.querySelector('.profile-save-footer').scrollIntoView({ block: 'center' }); true");
  const profileScreenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(profileScreenshotPath, Buffer.from(profileScreenshot.data, "base64"));
  await evaluate(client.call, "document.querySelector('.profile-save-footer .button-primary').click(); true");
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('Agent 配置已保存')"), "Profile save did not complete");
  assert.equal(await evaluate(client.call, "Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).some((key) => key.includes('proxylab_profile_draft_v1:P1-HUANYI'))"), false);

  await evaluate(client.call, "localStorage.clear(); location.href = '/admin'; true");
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('进入实验系统')"), "Unified login page did not render on /admin");
  await evaluate(client.call, fillAndSubmitScript("admin_arklab"));
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('模型配置')"), "admin_arklab did not enter the admin shell");
  assert.match(await evaluate(client.call, "document.body.innerText"), /admin · 管理员/);
  const adminScreenshot = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(adminScreenshotPath, Buffer.from(adminScreenshot.data, "base64"));
  await evaluate(client.call, "[...document.querySelectorAll('button')].find((item) => item.innerText.trim() === 'Profile结构').click(); true");
  await waitFor(() => evaluate(client.call, "document.body.innerText.includes('输入框示例')"), "Admin Profile schema editor did not expose placeholder editing");
  await evaluate(client.call, "[...document.querySelectorAll('.nav-item')].find((item) => item.innerText.trim() === '历史').click(); true");
  await waitFor(() => evaluate(client.call, "[...document.querySelectorAll('button')].some((item) => item.innerText.includes('下载全部记录'))"), "Admin ZIP export button did not render");

  const browserErrors = client.events.filter((event) => (
    event.method === "Runtime.exceptionThrown"
    || (event.method === "Log.entryAdded" && ["error", "warning"].includes(event.params?.entry?.level))
  ));
  assert.deepEqual(browserErrors, [], `Browser errors: ${JSON.stringify(browserErrors)}`);
  console.log(`Browser smoke passed: participant draft recovery, bottom save, admin ZIP export control, consent, responsive introduction, and profile schema editing. Screenshots: ${screenshotPath}, ${introScreenshotPath}, ${introMobileScreenshotPath}, ${profileScreenshotPath}, ${adminScreenshotPath}`);
} finally {
  try { await client?.call("Browser.close"); } catch { chrome?.kill(); }
  appProcess?.kill();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  rmSync(profileDir, { recursive: true, force: true });
  if (appDataDir) rmSync(appDataDir, { recursive: true, force: true });
}
