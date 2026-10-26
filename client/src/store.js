import { useSyncExternalStore } from "react";
import { fullAccessParams } from "./execution-policy";
import { createThreadOrdering, sortThreads } from "./thread-order";

const listeners = new Set(),
  eventListeners = new Set(),
  pending = new Map();
const saved = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
export const basename = (path) =>
  path?.split("/").filter(Boolean).at(-1) || "本机";
export const titleOf = (t) => t?.name || t?.preview || "新对话";
export const b64decode = (text) =>
  new TextDecoder().decode(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)));
export const b64encode = (text) => {
  const bytes = new TextEncoder().encode(text);
  let raw = "";
  for (let i = 0; i < bytes.length; i += 8192)
    raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(raw);
};
let state = {
  connected: false,
  booting: true,
  threads: [],
  threadCursor: null,
  archived: false,
  search: "",
  current: null,
  items: [],
  historyCursor: null,
  turns: {},
  active: {},
  questions: [],
  models: [],
  model: "",
  effort: "",
  mode: "default",
  cwd: saved("cx-cwd", ""),
  projects: saved("cx-projects", []),
  pins: saved("cx-pins", []),
  theme: saved("cx-theme", "system"),
  draft: "",
  attachments: [],
  skills: [],
  account: null,
  usage: null,
  tokenUsage: {},
  diffs: {},
  plans: {},
  busy: false,
  loading: false,
  error: "",
  notice: "",
  panel: null,
  panelFile: null,
  terminalOpen: false,
  terminals: {},
  sidebar: false,
  modal: null,
};
export function set(patch) {
  if (patch.cwd) persist("cx-cwd", patch.cwd);
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}
export function get() {
  return state;
}
export function useStore() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
export function onEvent(fn) {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}
export function report(error) {
  set({ error: error?.message || String(error) });
}
export function notice(text) {
  set({ notice: text });
  setTimeout(() => {
    if (state.notice === text) set({ notice: "" });
  }, 4000);
}
export function persist(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
let socket,
  seq = 1,
  opening = 0,
  initialized = false;
let pendingForks = saved("cx-pending-forks", []);
const deletedThreads = new Set();
const threadOrdering = createThreadOrdering(rpc);
let listing = 0;
export const listThreads = (params) => threadOrdering.list(params);
export function rpc(method, params = {}, timeout = 120000) {
  return new Promise((resolve, reject) => {
    if (!state.connected)
      return reject(new Error("与电脑的连接尚未就绪，正在自动重连。"));
    const id = seq++;
    const timer = timeout
      ? setTimeout(() => {
          pending.delete(id);
          reject(new Error("请求等待超时，请刷新会话查看任务状态。"));
        }, timeout)
      : null;
    pending.set(id, { resolve, reject, timer });
    socket.send(
      JSON.stringify({ id, method, params: fullAccessParams(method, params) }),
    );
  });
}
export function respond(request, result, error) {
  socket.send(
    JSON.stringify({ id: request.id, ...(error ? { error } : { result }) }),
  );
  set({ questions: state.questions.filter((q) => q.id !== request.id) });
}
function connect() {
  socket = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/rpc`,
  );
  socket.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "lan/state") {
      const was = state.connected;
      set({
        ...(!state.cwd && m.params.defaultCwd
          ? { cwd: m.params.defaultCwd }
          : {}),
        connected: m.params.ready,
        active: m.params.activeTurns,
        questions: m.params.questions,
        terminals: m.params.terminals || {},
      });
      const terminalId = localStorage.getItem("cx-terminal");
      if (m.params.terminals?.[terminalId]?.running === false)
        closeTerminal(terminalId);
      for (const fn of eventListeners) fn(m);
      if (m.params.ready && !was) boot();
      return;
    }
    if (m.id !== undefined && !m.method) {
      const p = pending.get(m.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      }
      return;
    }
    if (m.id !== undefined && m.method) {
      set({ questions: [...state.questions.filter((q) => q.id !== m.id), m] });
      return;
    }
    handle(m);
    for (const fn of eventListeners) fn(m);
  };
  socket.onclose = () => {
    set({ connected: false });
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("连接中断，正在重连；已提交的任务会在电脑上继续。"));
    }
    pending.clear();
    setTimeout(connect, 1500);
  };
  socket.onerror = () => {};
}
async function boot() {
  try {
    const [models, account, config] = await Promise.all([
      rpc("model/list"),
      rpc("account/read", { refreshToken: false }),
      rpc("config/read", { includeLayers: false }),
    ]);
    const cfg = config.config || {};
    set({
      models: models.data,
      account: account.account,
      model:
        state.model ||
        cfg.model ||
        models.data.find((m) => m.isDefault)?.model ||
        "",
      effort: state.effort || cfg.model_reasoning_effort || "",
      booting: false,
    });
    await loadThreads(false);
    const id = state.current?.id || localStorage.getItem("cx-current");
    if (id) await openThread(id);
    else set({ draft: localStorage.getItem("cx-draft-new") || "" });
    rpc("account/rateLimits/read")
      .then((usage) => set({ usage }))
      .catch(() => {});
    if (!initialized) {
      initialized = true;
      loadSkills().catch(() => {});
    }
  } catch (e) {
    set({ booting: false });
    report(e);
  }
}
export async function loadThreads(more = false) {
  const epoch = ++listing;
  const limit = Math.max(60, state.threads.length + (more ? 60 : 0));
  const data = await listThreads({
    archived: state.archived,
    ...(state.search ? { searchTerm: state.search } : {}),
  });
  if (epoch !== listing) return;
  pendingForks = pendingForks.filter((id) => !data.some((t) => t.id === id));
  persist("cx-pending-forks", pendingForks);
  const extra = await Promise.all(
    pendingForks.map((id) =>
      rpc("thread/read", { threadId: id, includeTurns: false })
        .then((r) => r.thread)
        .catch(() => null),
    ),
  );
  const visible = extra.filter(
    (t) =>
      t &&
      !deletedThreads.has(t.id) &&
      Boolean(t.path?.includes("/archived_sessions/")) === state.archived &&
      (!state.search || titleOf(t).includes(state.search)),
  );
  const threads = [...visible, ...data];
  if (
    state.current &&
    !state.archived &&
    !state.search &&
    !threads.some((t) => t.id === state.current.id)
  )
    threads.unshift(state.current);
  const sorted = await threadOrdering.hydrate(
    [...new Map(threads.map((t) => [t.id, t])).values()].filter(
      (thread) => !deletedThreads.has(thread.id),
    ),
  );
  if (epoch !== listing) return;
  set({
    threads: sorted.filter((t) => !deletedThreads.has(t.id)).slice(0, limit),
    threadCursor: sorted.length > limit ? String(limit) : null,
    current: state.current
      ? sorted.find((t) => t.id === state.current.id) || state.current
      : null,
  });
}
export function setDraft(draft) {
  set({ draft });
  localStorage.setItem("cx-draft-" + (state.current?.id || "new"), draft);
}
export function newChat(cwd = state.cwd) {
  opening++;
  localStorage.removeItem("cx-current");
  set({
    current: null,
    items: [],
    historyCursor: null,
    cwd,
    draft: localStorage.getItem("cx-draft-new") || "",
    attachments: [],
    error: "",
    loading: false,
    sidebar: false,
  });
}
export async function openThread(id) {
  const epoch = ++opening;
  set({ loading: true, error: "", sidebar: false, attachments: [] });
  try {
    const r = await rpc("thread/resume", { threadId: id, excludeTurns: true });
    if (epoch !== opening || deletedThreads.has(id)) return;
    const [thread] = await threadOrdering.hydrate([r.thread]);
    if (epoch !== opening || deletedThreads.has(id)) return;
    set({
      threads: state.threads.some((t) => t.id === id)
        ? state.threads
        : sortThreads([thread, ...state.threads]),
      current: thread,
      cwd: r.cwd || r.thread.cwd,
      model: r.model || state.model,
      effort: r.reasoningEffort || "",
      items: [],
      historyCursor: null,
      draft: localStorage.getItem("cx-draft-" + id) || "",
    });
    localStorage.setItem("cx-current", id);
    await loadHistory(false, epoch);
    rpc("thread/turns/list", { threadId: id, limit: 20, itemsView: "summary" })
      .then((page) => {
        if (state.current?.id === id) {
          const active = { ...state.active };
          const running = page.data.find((t) => t.status === "inProgress");
          if (running) active[id] = running.id;
          else delete active[id];
          set({ turns: { ...state.turns, [id]: page.data }, active });
        }
      })
      .catch(() => {});
  } catch (e) {
    report(e);
  } finally {
    if (epoch === opening) set({ loading: false });
  }
}
export async function loadHistory(older = false, epoch = opening) {
  if (!state.current) return;
  const id = state.current.id;
  const page = await rpc("thread/items/list", {
    threadId: id,
    limit: 100,
    sortDirection: "desc",
    ...(older && state.historyCursor ? { cursor: state.historyCursor } : {}),
  });
  if (epoch !== opening || state.current?.id !== id) return;
  const map = new Map(
    page.data
      .slice()
      .reverse()
      .map((e) => [e.item.id, { ...e.item, turnId: e.turnId }]),
  );
  for (const item of state.items) map.set(item.id, item);
  set({ items: [...map.values()], historyCursor: page.nextCursor });
}
function put(item) {
  const index = state.items.findIndex((i) => i.id === item.id);
  const items = state.items.slice();
  if (index >= 0 && item.type === "userMessage") {
    const content = [...(items[index].content || []), ...(item.content || [])];
    item = {
      ...item,
      content: [
        ...new Map(content.map((c) => [JSON.stringify(c), c])).values(),
      ],
    };
  }
  if (index < 0) items.push(item);
  else items[index] = { ...items[index], ...item };
  set({ items });
}
function closeTerminal(processId) {
  if (localStorage.getItem("cx-terminal") !== processId) return;
  localStorage.removeItem("cx-terminal");
  set({ terminalOpen: false });
}
function handle({ method, params: p = {} }) {
  if (method === "thread/deleted") {
    forgetThread(p.threadId);
    return;
  }
  if (method === "lan/terminalStarted")
    set({
      terminals: {
        ...state.terminals,
        [p.processId]: { buffer: "", running: true },
      },
    });
  if (method === "command/exec/outputDelta" && state.terminals[p.processId]) {
    const t = state.terminals[p.processId];
    set({
      terminals: {
        ...state.terminals,
        [p.processId]: {
          ...t,
          buffer: (t.buffer + b64decode(p.deltaBase64)).slice(-200000),
        },
      },
    });
  }
  if (method === "lan/terminalExit") {
    set({
      terminals: {
        ...state.terminals,
        [p.processId]: { ...state.terminals[p.processId], running: false },
      },
    });
    closeTerminal(p.processId);
  }
  if (method === "lan/questionResolved") {
    set({
      questions: state.questions.filter((q) => String(q.id) !== String(p.id)),
    });
    return;
  }
  if (method === "turn/started")
    set({ active: { ...state.active, [p.threadId]: p.turn.id } });
  if (method === "turn/completed") {
    threadOrdering.completed(p.threadId, p.turn);
    const active = { ...state.active };
    delete active[p.threadId];
    const completedAt = p.turn.completedAt;
    const update = (thread) =>
      thread?.id === p.threadId && Number.isFinite(completedAt)
        ? {
            ...thread,
            completedAt: Math.max(thread.completedAt ?? 0, completedAt),
          }
        : thread;
    set({
      active,
      threads: sortThreads(state.threads.map(update)),
      current: update(state.current),
    });
    if (state.current?.id === p.threadId) {
      if (p.turn.error) report(p.turn.error);
      if (p.turn.status === "interrupted") notice("任务已停止");
      set({
        turns: {
          ...state.turns,
          [p.threadId]: [
            p.turn,
            ...(state.turns[p.threadId] || []).filter(
              (t) => t.id !== p.turn.id,
            ),
          ],
        },
      });
    }
    loadThreads().catch(() => {});
  }
  if (method === "thread/name/updated") {
    set({
      threads: state.threads.map((t) =>
        t.id === p.threadId ? { ...t, name: p.threadName || p.name } : t,
      ),
      current:
        state.current?.id === p.threadId
          ? { ...state.current, name: p.threadName || p.name }
          : state.current,
    });
  }
  if (method === "thread/tokenUsage/updated")
    set({ tokenUsage: { ...state.tokenUsage, [p.threadId]: p.tokenUsage } });
  if (method === "turn/diff/updated")
    set({ diffs: { ...state.diffs, [p.threadId]: p.diff } });
  if (method === "turn/plan/updated")
    set({ plans: { ...state.plans, [p.threadId]: p } });
  if (p.threadId !== state.current?.id) return;
  if (method === "error") report(p.error || p.message || "任务失败");
  if (method === "item/started" || method === "item/completed") {
    if (p.item.type === "userMessage")
      set({ items: state.items.filter((i) => !i.optimistic) });
    put({ ...p.item, turnId: p.turnId });
  }
  if (method === "item/agentMessage/delta") {
    const i = state.items.find((i) => i.id === p.itemId) || {
      id: p.itemId,
      type: "agentMessage",
      text: "",
      turnId: p.turnId,
    };
    put({ ...i, text: i.text + p.delta });
  }
  if (method === "item/commandExecution/outputDelta") {
    const i = state.items.find((i) => i.id === p.itemId);
    if (i)
      put({ ...i, aggregatedOutput: (i.aggregatedOutput || "") + p.delta });
  }
  if (method === "item/reasoning/summaryTextDelta") {
    const i = state.items.find((i) => i.id === p.itemId) || {
      id: p.itemId,
      type: "reasoning",
      summary: [],
    };
    const summary = [...(i.summary || [])];
    summary[p.summaryIndex] = (summary[p.summaryIndex] || "") + p.delta;
    put({ ...i, summary });
  }
}
export async function ensureThread() {
  if (state.current) return state.current;
  const r = await rpc("thread/start", {
    cwd: state.cwd,
    model: state.model || undefined,
  });
  set({ current: r.thread });
  localStorage.setItem("cx-current", r.thread.id);
  return r.thread;
}
export async function sendMessage(
  text = state.draft,
  attachments = state.attachments,
) {
  if ((!text.trim() && !attachments.length) || state.busy) return;
  set({ busy: true, error: "" });
  try {
    const thread = await ensureThread();
    const input = [
      ...(text.trim() ? [{ type: "text", text, text_elements: [] }] : []),
      ...attachments.map((a) => a.input),
    ];
    put({
      id: "optimistic-" + uid(),
      type: "userMessage",
      content: input,
      optimistic: true,
    });
    const params = {
      threadId: thread.id,
      input,
      model: state.model || undefined,
      effort: state.effort || undefined,
      collaborationMode: {
        mode: state.mode,
        settings: {
          model: state.model,
          reasoning_effort: state.effort || null,
        },
      },
    };
    const running = state.active[thread.id];
    const r = await rpc(
      running ? "turn/steer" : "turn/start",
      running
        ? { threadId: thread.id, expectedTurnId: running, input }
        : params,
    );
    if (state.current?.id === thread.id) {
      setDraft("");
      set({ attachments: [] });
    }
    if (r.turn?.status === "inProgress")
      set({ active: { ...state.active, [thread.id]: r.turn.id } });
    loadThreads().catch(() => {});
  } catch (e) {
    set({ items: state.items.filter((i) => !i.optimistic) });
    report(e);
  } finally {
    set({ busy: false });
  }
}
export async function stop() {
  const id = state.current?.id;
  if (id && state.active[id])
    await rpc("turn/interrupt", { threadId: id, turnId: state.active[id] });
}
export async function rename(thread, name) {
  await rpc("thread/name/set", { threadId: thread.id, name });
  set({
    current:
      state.current?.id === thread.id
        ? { ...state.current, name }
        : state.current,
  });
  await loadThreads();
}
export async function archive(thread) {
  const restoring = state.archived;
  await rpc(restoring ? "thread/unarchive" : "thread/archive", {
    threadId: thread.id,
  });
  if (state.current?.id === thread.id) newChat();
  if (restoring) {
    pendingForks = [...new Set([...pendingForks, thread.id])];
    persist("cx-pending-forks", pendingForks);
    set({ archived: false });
    await openThread(thread.id);
  }
  await loadThreads();
}
function forgetThread(id) {
  threadOrdering.forget(id);
  deletedThreads.add(id);
  pendingForks = pendingForks.filter((value) => value !== id);
  persist("cx-pending-forks", pendingForks);
  const pins = state.pins.filter((value) => value !== id);
  persist("cx-pins", pins);
  localStorage.removeItem("cx-draft-" + id);
  if (localStorage.getItem("cx-current") === id)
    localStorage.removeItem("cx-current");
  if (state.current?.id === id) newChat();
  const patch = {};
  for (const key of ["active", "turns", "diffs", "plans", "tokenUsage"]) {
    patch[key] = { ...state[key] };
    delete patch[key][id];
  }
  set({
    ...patch,
    pins,
    threads: state.threads.filter((thread) => thread.id !== id),
    questions: state.questions.filter(
      (question) => question.params?.threadId !== id,
    ),
    modal: state.modal?.thread?.id === id ? null : state.modal,
  });
}
export async function deleteThread(thread) {
  await rpc("thread/delete", { threadId: thread.id });
  forgetThread(thread.id);
  notice("对话已删除");
  await loadThreads().catch(report);
}
export async function fork(thread = state.current, lastTurnId) {
  const r = await rpc("thread/fork", {
    threadId: thread.id,
    excludeTurns: true,
    ...(lastTurnId ? { lastTurnId } : {}),
  });
  pendingForks = [...new Set([...pendingForks, r.thread.id])];
  persist("cx-pending-forks", pendingForks);
  await rpc("thread/name/set", {
    threadId: r.thread.id,
    name: titleOf(thread).slice(0, 70) + " (分支)",
  });
  await openThread(r.thread.id);
  await loadThreads();
  notice("已创建对话分支");
}
export async function compact() {
  const t = await ensureThread();
  await rpc("thread/compact/start", { threadId: t.id });
  notice("已开始整理对话上下文");
}
export async function review() {
  const t = await ensureThread();
  await rpc("review/start", {
    threadId: t.id,
    target: { type: "uncommittedChanges" },
  });
}
export async function loadSkills() {
  const r = await rpc("skills/list", { cwds: [state.cwd] });
  set({ skills: r.data.flatMap((e) => e.skills || []) });
}
export function pin(id) {
  const pins = state.pins.includes(id)
    ? state.pins.filter((x) => x !== id)
    : [...state.pins, id];
  set({ pins });
  persist("cx-pins", pins);
}
export function addProject(path) {
  if (!state.projects.includes(path)) {
    const projects = [...state.projects, path];
    set({ projects });
    persist("cx-projects", projects);
  }
  newChat(path);
}
export function addAttachment(a) {
  set({ attachments: [...state.attachments, a] });
}
export async function attachFile(file) {
  if (file.type.startsWith("image/")) {
    const url = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    addAttachment({
      id: uid(),
      name: file.name,
      preview: url,
      input: { type: "image", url },
    });
  } else {
    const text = await file.text();
    addAttachment({
      id: uid(),
      name: file.name,
      input: {
        type: "text",
        text: `附件 ${file.name}\n\n${text}`,
        text_elements: [],
      },
    });
  }
}
export function setTheme(theme) {
  set({ theme });
  persist("cx-theme", theme);
}
export async function copy(text) {
  try {
    if (navigator.clipboard?.writeText)
      await navigator.clipboard.writeText(text);
    else {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      const ok = document.execCommand("copy");
      input.remove();
      if (!ok) throw new Error("浏览器未允许复制，请长按文本选择复制。");
    }
    notice("已复制");
  } catch (e) {
    report(e);
  }
}
connect();
