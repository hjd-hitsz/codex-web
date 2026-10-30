import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { imageBase64, toolActivities } from "../fixtures/tool-activities.mjs";

export async function testToolActivities(app, requests, setResponse, emit) {
  const original = app.get();
  let view;
  const start = requests.length;
  const source = toolActivities.map((item) => ({ ...item, turnId: "turn" }));
  const text = () => JSON.stringify(view.toJSON());
  const activities = () =>
    view.root.findAll(
      (node) =>
        node.type === "div" &&
        node.props.className?.split(" ").includes("activity"),
    );
  const expand = async (index) => {
    const button = activities()[index].findAllByType("button")[0];
    if (!button.props["aria-expanded"])
      await act(async () => button.props.onClick());
  };
  setResponse(({ method }) =>
    method === "fs/readFile" ? { dataBase64: imageBase64 } : { data: [] },
  );
  try {
    app.set({
      current: { id: "tool-fixture", cwd: "/fixture/project" },
      connected: true,
      loading: false,
      items: source,
      active: {},
      turns: {},
      turnTimings: {},
      questions: [],
    });
    await act(async () => {
      view = create(React.createElement(app.Conversation));
    });
    await act(async () =>
      view.root
        .findByProps({ className: "process-history" })
        .props.onToggle({ currentTarget: { open: true } }),
    );
    assert.equal(view.root.findAllByType("img").length, 2);
    assert.deepEqual(
      requests
        .slice(start)
        .filter((r) => r.method === "fs/readFile")
        .map((r) => r.params),
      [{ path: "/fixture/project/figures/planning.svg" }],
    );
    assert.equal(
      activities()[3].findAllByType("button")[0].props["aria-expanded"],
      true,
    );
    for (let i = 0; i < source.length; i++) await expand(i);
    assert.equal(view.root.findAllByType("pre").length, 0);
    for (const value of [
      "搜索网页 · LaValle",
      "打开网页 · https://arxiv.org",
      "在网页中查找 · Optimal RRT",
      "Planning Algorithms",
      "路径连通性",
      "数量",
      "读取超时，请稍后重试。",
      "上下文整理已完成",
      "等待 1.5 秒",
      "检查完成",
    ])
      assert(text().includes(value), value);
    assert(!text().includes('\\"query\\"'));
    assert(!text().includes("dataBase64"));
    assert(
      view.root
        .findAllByType("a")
        .some((node) => node.props.href === "https://lavalle.pl/planning/"),
    );
    assert.equal(
      activities()[6].findAll((node) => node.props["aria-label"] === "执行失败")
        .length > 0,
      true,
    );
    // 新图片在完成事件到达时自动显示；用户主动折叠后保留折叠状态。
    await act(async () =>
      emit("item/started", {
        threadId: "tool-fixture",
        turnId: "turn",
        item: {
          id: "late-image",
          type: "dynamicToolCall",
          tool: "view_image",
          status: "inProgress",
          arguments: { path: "preview.svg" },
          contentItems: null,
        },
      }),
    );
    assert.equal(activities().at(-1).findAllByType("img").length, 0);
    const completed = {
      id: "late-image",
      type: "dynamicToolCall",
      tool: "view_image",
      status: "completed",
      contentItems: [
        {
          type: "inputImage",
          imageUrl: "data:image/svg+xml;base64," + imageBase64,
        },
      ],
    };
    await act(async () =>
      emit("item/completed", {
        threadId: "tool-fixture",
        turnId: "turn",
        item: completed,
      }),
    );
    assert.equal(activities().at(-1).findAllByType("img").length, 1);
    await act(async () =>
      activities().at(-1).findAllByType("button")[0].props.onClick(),
    );
    await act(async () =>
      emit("item/completed", {
        threadId: "tool-fixture",
        turnId: "turn",
        item: completed,
      }),
    );
    assert.equal(activities().at(-1).findAllByType("img").length, 0);
    await act(async () =>
      app.set({
        items: [
          {
            id: "resources",
            turnId: "turn",
            type: "mcpToolCall",
            tool: "read_resource",
            status: "completed",
            result: {
              content: [
                {
                  type: "resource",
                  resource: {
                    uri: "preview.svg",
                    mimeType: "image/svg+xml",
                    blob: imageBase64,
                  },
                },
                {
                  type: "resource_link",
                  uri: "https://example.com/report",
                  name: "验证报告",
                },
                {
                  type: "resource_link",
                  uri: "javascript:alert(1)",
                  name: "不安全地址",
                },
                { type: "text", text: "**格式化正文**" },
              ],
            },
          },
          {
            id: "structured",
            turnId: "turn",
            type: "mcpToolCall",
            tool: "inspect",
            result: {
              content: [],
              structuredContent: {
                title: "结构化结果",
                count: 0,
                success: false,
                _meta: { secret: "internal metadata" },
              },
            },
          },
          {
            id: "generated",
            turnId: "turn",
            type: "imageGeneration",
            status: "completed",
            result: "data:image/svg+xml;base64," + imageBase64,
          },
          {
            id: "legacy-output",
            turnId: "turn",
            type: "functionCallOutput",
            name: "read",
            output: [
              {
                type: "input_image",
                image_url: "data:image/svg+xml;base64," + imageBase64,
              },
            ],
          },
          {
            id: "other",
            turnId: "turn",
            type: "futureTool",
            result: "普通文字输出",
          },
          {
            id: "failed",
            turnId: "turn",
            type: "dynamicToolCall",
            status: "failed",
            tool: "inspect",
            contentItems: null,
          },
        ],
      }),
    );
    assert.equal(view.root.findAllByType("img").length, 3);
    for (let i = 0; i < 6; i++) await expand(i);
    assert(text().includes("格式化正文"));
    assert(text().includes("结构化结果"));
    assert(text().includes("普通文字输出"));
    assert(text().includes("工具执行失败"));
    assert(!text().includes("internal metadata"));
    assert.equal(
      view.root
        .findAllByType("a")
        .some((node) => node.props.href?.startsWith("javascript:")),
      false,
    );
    assert.equal(view.root.findAllByType("pre").length, 0);
    // 原有命令详情继续保留实际命令、输出、退出码与目录。
    await act(async () =>
      app.set({
        items: [
          {
            id: "command",
            turnId: "turn",
            type: "commandExecution",
            command: "npm test",
            cwd: "/fixture/project",
            aggregatedOutput: "PASS",
            exitCode: 0,
            status: "completed",
          },
        ],
      }),
    );
    await expand(0);
    assert.equal(view.root.findAllByType("pre").length, 2);
    assert(text().includes("退出码 "));
    assert(text().includes("/fixture/project"));
    console.log(
      "PASS 工具记录显示图片、网页操作和可读结果，覆盖历史、实时图片、失败、资源与通用回退",
    );
  } finally {
    if (view) await act(async () => view.unmount());
    app.set(original);
  }
}
