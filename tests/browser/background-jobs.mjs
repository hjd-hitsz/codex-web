import assert from "node:assert/strict";

export async function testBackgroundJobs({
  page,
  evaluate,
  waitFor,
  pause,
  click,
  clickText,
  type,
  screenshot,
}) {
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(
    "sessionStorage.removeItem('compact-fixture');sessionStorage.removeItem('compact-legacy');sessionStorage.removeItem('background-fixture')",
  );
  await page("Page.reload", {});
  await waitFor(
    `document.querySelector('textarea[aria-label="消息"]') && !document.querySelector('.history-loading')`,
  );
  await evaluate('document.documentElement.dataset.theme="light"');
  await type("保留草稿：任务结束后请继续检查构建结果。");
  await screenshot("background-before");
  const job = {
    id: "background-browser-task",
    threadId: "browser-command-fixture",
    title: "构建并运行测试",
    command: "npm run build && npm test",
    cwd: "/fixture/project",
    status: "running",
    delivery: "pending",
    exitCode: null,
    startedAt: Date.now(),
    completedAt: null,
  };
  await evaluate(`commandFixture.backgroundSet(${JSON.stringify([job])})`);
  await waitFor(
    `document.querySelector('.background-status')?.textContent.includes('1 项运行中')`,
  );
  await click(".background-status");
  await waitFor(
    `document.querySelector('pre[aria-label="后台任务日志"]')?.textContent.includes('124 个模块')`,
  );
  assert.equal(
    await evaluate("document.querySelectorAll('.context-tools button').length"),
    4,
  );
  await screenshot("background-running-desktop");
  await clickText("继续读取");
  await waitFor(
    `document.querySelector('pre[aria-label="后台任务日志"]')?.textContent.includes('日志续页')`,
  );
  await clickText("从头读取");
  await waitFor(
    `document.querySelector('pre[aria-label="后台任务日志"]')?.textContent.includes('124 个模块')`,
  );
  await evaluate("commandFixture.backgroundFail(true)");
  await click('button[title="刷新后台任务"]');
  await waitFor(
    `document.querySelector('.background-notice[role="alert"]')?.textContent.includes('测试日志读取失败')`,
  );
  await screenshot("background-read-failed");
  await evaluate("commandFixture.backgroundFail(false)");
  await clickText("重试读取");
  await waitFor(`document.querySelector('pre[aria-label="后台任务日志"]')`);
  await page("Page.reload", {});
  await waitFor(`document.querySelector('.background-status')`);
  assert.equal(
    await evaluate(
      `document.querySelector('textarea[aria-label="消息"]').value`,
    ),
    "保留草稿：任务结束后请继续检查构建结果。",
  );
  await click(".background-status");
  await waitFor(`document.querySelector('pre[aria-label="后台任务日志"]')`);
  await click('button[title="停止后台任务"]');
  await waitFor(
    `document.querySelector('.background-job')?.textContent.includes('已停止')`,
  );
  assert.equal(
    await evaluate(`!!document.querySelector('.background-status')`),
    false,
  );
  await screenshot("background-cancelled");
  await evaluate(
    `commandFixture.backgroundSet(${JSON.stringify([{ ...job, status: "failed", exitCode: 7, delivery: "uncertain", deliveryError: "继续请求的结果需要核对，可点击检查并重试", completedAt: Date.now() }])})`,
  );
  await waitFor(
    `document.querySelector('.background-job')?.textContent.includes('继续结果待核对')`,
  );
  await screenshot("background-completed-uncertain");
  const layouts = [];
  for (const width of [1440, 390]) {
    await page("Emulation.setDeviceMetricsOverride", {
      width,
      height: width === 390 ? 844 : 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const theme of ["light", "dark"]) {
      await evaluate(
        `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
      );
      await pause(300);
      const layout = await evaluate(
        `(()=>{const e=document.querySelector('.background-panel'),r=e.getBoundingClientRect();return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,panel:{x:r.x,y:r.y,right:r.right,bottom:r.bottom},composerTop:document.querySelector('.composer-wrap').getBoundingClientRect().top,bodyColor:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor}})()`,
      );
      assert(layout.scrollWidth <= width, "页面应保持视口宽度");
      assert(
        layout.panel.x >= 0 && layout.panel.right <= width,
        "任务卡片应完整显示",
      );
      assert(
        layout.panel.bottom <= layout.composerTop + 1,
        "卡片应位于输入框上方",
      );
      layouts.push({ theme, ...layout });
      await screenshot(`background-${theme}-${width}`);
    }
  }
  for (const zoom of [0.8, 1, 1.25, 1.5, 2]) {
    await page("Emulation.setDeviceMetricsOverride", {
      width: Math.round(1440 / zoom),
      height: Math.round(1000 / zoom),
      deviceScaleFactor: zoom,
      mobile: false,
    });
    await pause(100);
    assert.equal(
      await evaluate("document.documentElement.scrollWidth <= innerWidth"),
      true,
      `${zoom * 100}% 缩放应保持布局`,
    );
    assert.equal(
      await evaluate(
        "(()=>{const r=document.querySelector('button[title=\"检查并重试继续\"]').getBoundingClientRect();return r.width>0 && r.right<=innerWidth && r.x>=0})()",
      ),
      true,
      "重试按钮应可操作",
    );
    await screenshot(`background-zoom-${Math.round(zoom * 100)}`);
  }
  await page("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await pause(200);
  await click('button[title="检查并重试继续"]');
  await waitFor(
    `document.querySelector('.background-job')?.textContent.includes('已提交继续')`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('textarea[aria-label="消息"]').value`,
    ),
    "保留草稿：任务结束后请继续检查构建结果。",
  );
  assert.equal(
    await evaluate(
      `commandFixture.requests.filter((entry)=>entry.method==='lan/background/retry').length`,
    ),
    1,
  );
  await screenshot("background-retried-dark-390");
  return {
    layouts,
    cases: [
      "启动前后",
      "日志分页",
      "失败重试",
      "完整刷新恢复",
      "停止进程",
      "待核对结果重试",
      "草稿保留",
      "深浅主题与窄屏",
    ],
  };
}
