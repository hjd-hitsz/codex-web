export const imageBase64 = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#e8eef4"/><path d="M70 310 190 180 290 260 430 100 570 310" fill="none" stroke="#46758c" stroke-width="12"/><text x="40" y="60" font-family="sans-serif" font-size="28" fill="#253b49">Tool image preview</text></svg>',
).toString("base64");

export const toolActivities = [
  {
    id: "search",
    type: "webSearch",
    query: "",
    action: {
      type: "search",
      query: null,
      queries: [
        "LaValle Planning Algorithms RRT",
        "Karaman Frazzoli optimal motion planning",
      ],
    },
    results: [
      {
        title: "Planning Algorithms",
        url: "https://lavalle.pl/planning/",
        snippet: "搜索结果摘要：采样规划与路径搜索。",
        type: "text_result",
        domain: "lavalle.pl",
        ref_id: "fixture-search-0",
      },
      {
        url: "https://arxiv.org/abs/1105.1186",
        description: "搜索结果说明：渐近最优规划。",
        type: "text_result",
        domain: "arxiv.org",
        ref_id: "fixture-search-1",
      },
    ],
  },
  {
    id: "open",
    type: "webSearch",
    query: "https://arxiv.org/html/1105.1186v1",
    action: { type: "openPage", url: "https://arxiv.org/html/1105.1186v1" },
  },
  {
    id: "find",
    type: "webSearch",
    query: "'Optimal RRT'",
    action: { type: "findInPage", url: null, pattern: "Optimal RRT" },
  },
  { id: "image", type: "imageView", path: "figures/planning.svg" },
  {
    id: "mcp",
    type: "mcpToolCall",
    server: "library",
    tool: "search",
    status: "completed",
    arguments: { query: "采样规划" },
    result: {
      content: [
        {
          type: "text",
          text: '{"results":[{"title":"Planning Algorithms","url":"https://lavalle.pl/planning/","snippet":"采样规划与路径搜索。"}],"count":1}',
        },
      ],
      structuredContent: null,
    },
  },
  {
    id: "dynamic",
    type: "dynamicToolCall",
    tool: "inspect_plot",
    status: "completed",
    success: true,
    arguments: { path: "figures/planning.svg" },
    contentItems: [
      {
        type: "inputImage",
        imageUrl: "data:image/svg+xml;base64," + imageBase64,
      },
      { type: "inputText", text: "图片已读取，展示规划路径。" },
    ],
  },
  {
    id: "error",
    type: "mcpToolCall",
    server: "library",
    tool: "fetch",
    status: "failed",
    arguments: { url: "https://example.com/paper" },
    error: { message: "读取超时，请稍后重试。" },
    result: null,
  },
  {
    id: "review",
    type: "exitedReviewMode",
    review: "已检查路径规划实现，发现一处边界条件需要修复。",
  },
  { id: "compact", type: "contextCompaction", status: "completed" },
  { id: "wait", type: "sleep", durationMs: 1500 },
  {
    id: "output",
    type: "functionCallOutput",
    name: "read_summary",
    output: [{ type: "input_text", text: "**检查完成**：已读取全部摘要。" }],
  },
  {
    id: "unknown",
    type: "futureTool",
    status: "completed",
    result: {
      title: "检查结果",
      checks: [{ name: "路径连通性", success: true }],
      count: 1,
    },
  },
];
