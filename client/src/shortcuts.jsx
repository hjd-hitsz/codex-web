import React, { useState, useEffect, useRef } from "react";
import {
  FileCode,
  Folder,
  Sparkles,
  SquarePen,
  Brain,
  ListChecks,
  GitPullRequest,
  Minimize2,
  TerminalSquare,
  Search,
  Settings,
  GitBranch,
  Square,
  ChevronRight,
  LoaderCircle,
  Pencil,
  Trash2,
} from "lucide-react";
import * as store from "./store";

const commands = [
  {
    id: "new",
    label: "新对话",
    description: "在当前项目开始新对话",
    icon: SquarePen,
    run: () => store.newChat(),
  },
  {
    id: "model",
    label: "模型与思考强度",
    description: "选择模型和推理强度",
    icon: Brain,
    run: () => store.set({ modal: { type: "model" } }),
  },
  {
    id: "plan",
    label: "计划模式",
    description: "切换计划模式与执行模式",
    icon: ListChecks,
    run: () => {
      const mode = store.get().mode === "plan" ? "default" : "plan";
      store.set({ mode });
      store.notice(mode === "plan" ? "已切换到计划模式" : "已切换到执行模式");
    },
  },
  {
    id: "review",
    label: "代码审查",
    description: "审查当前项目未提交的更改",
    icon: GitPullRequest,
    run: () => {
      store.set({ panel: "changes" });
      return store.review();
    },
  },
  {
    id: "compact",
    label: "整理上下文",
    description: "压缩当前对话上下文",
    icon: Minimize2,
    current: true,
    run: store.compact,
  },
  {
    id: "skills",
    label: "技能",
    description: "选择已安装技能",
    icon: Sparkles,
    run: () => store.set({ modal: { type: "skills" } }),
  },
  {
    id: "files",
    label: "文件",
    description: "浏览和编辑项目文件",
    icon: Folder,
    run: () => store.set({ panel: "files" }),
  },
  {
    id: "diff",
    label: "查看变更",
    description: "查看 Git 差异及对话变更",
    icon: GitBranch,
    run: () => store.set({ panel: "changes" }),
  },
  {
    id: "terminal",
    label: "终端",
    description: "打开本机交互式终端",
    icon: TerminalSquare,
    run: () => store.set({ terminalOpen: true }),
  },
  {
    id: "project",
    label: "切换项目",
    description: "选择本机工作目录",
    icon: Folder,
    run: () => store.set({ modal: { type: "directory" } }),
  },
  {
    id: "search",
    label: "搜索对话",
    description: "查找已有聊天记录",
    icon: Search,
    run: () => store.set({ modal: { type: "search" } }),
  },
  {
    id: "status",
    label: "账户与用量",
    description: "查看账户、额度和设置",
    icon: Settings,
    run: () => store.set({ modal: { type: "settings" } }),
  },
  {
    id: "fork",
    label: "创建分支",
    description: "从当前对话继续另一条思路",
    icon: GitBranch,
    current: true,
    run: () => store.fork(),
  },
  {
    id: "rename",
    label: "重命名对话",
    description: "修改当前对话的名称",
    icon: Pencil,
    current: true,
    run: () =>
      store.set({ modal: { type: "rename", thread: store.get().current } }),
  },
  {
    id: "delete",
    label: "删除对话",
    description: "删除当前对话记录",
    icon: Trash2,
    current: true,
    run: () =>
      store.set({ modal: { type: "delete", thread: store.get().current } }),
  },
  {
    id: "stop",
    label: "停止任务",
    description: "停止当前正在执行的任务",
    icon: Square,
    active: true,
    run: store.stop,
  },
];
function absolute(path, cwd) {
  const parts = (path.startsWith("/") ? path : cwd + "/" + path).split("/"),
    out = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(p);
  }
  return "/" + out.join("/");
}
export function useComposerShortcuts(area) {
  const s = store.useStore();
  const [trigger, setTrigger] = useState(null),
    [files, setFiles] = useState([]),
    [index, setIndex] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const list = useRef(),
    generation = useRef(0);
  function detect(text, position) {
    const before = text.slice(0, position),
      match = before.match(/(^|\s)([@/])([^\s@]*)$/);
    setTrigger(
      match
        ? {
            kind: match[2],
            query: match[3],
            start: position - match[3].length - 1,
            end: position,
          }
        : null,
    );
    setIndex(0);
  }
  useEffect(() => {
    if (s.connected) store.loadSkills().catch(() => {});
  }, [s.cwd, s.connected]);
  useEffect(() => {
    const n = ++generation.current;
    setFiles([]);
    setError("");
    if (trigger?.kind !== "@") {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        let rows;
        const q = trigger.query;
        if (!q || q.endsWith("/")) {
          const directory = q ? absolute(q, s.cwd) : s.cwd;
          const result = await store.rpc("fs/readDirectory", {
            path: directory,
          });
          rows = result.entries
            .sort(
              (a, b) =>
                Number(b.isDirectory) - Number(a.isDirectory) ||
                a.fileName.localeCompare(b.fileName),
            )
            .map((e) => ({
              path: absolute(e.fileName, directory),
              name: e.fileName,
              directory: e.isDirectory,
            }));
        } else {
          const result = await store.rpc("fuzzyFileSearch", {
            query: q,
            roots: [s.cwd],
          });
          rows = result.files.map((f) => ({
            path: absolute(f.path, f.root),
            name: f.file_name,
            directory: f.match_type === "directory",
          }));
        }
        if (n === generation.current) setFiles(rows.slice(0, 60));
      } catch (e) {
        if (n === generation.current) setError(e.message);
      } finally {
        if (n === generation.current) setLoading(false);
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [trigger?.kind, trigger?.query, s.cwd]);
  const q = trigger?.query.toLowerCase() || "";
  const matchingSkills = s.skills
    .filter((skill) =>
      (skill.name + " " + skill.description).toLowerCase().includes(q),
    )
    .map((skill) => ({
      id: "skill:" + skill.path,
      kind: "skill",
      label: skill.name,
      description: skill.shortDescription || skill.description,
      icon: Sparkles,
      skill,
    }));
  const items =
    trigger?.kind === "/"
      ? [
          ...commands
            .filter(
              (c) =>
                (!c.current || s.current) &&
                (!c.active || s.active[s.current?.id]) &&
                (c.id + " " + c.label + " " + c.description)
                  .toLowerCase()
                  .includes(q),
            )
            .map((c) => ({ ...c, kind: "command" })),
          ...matchingSkills,
        ]
      : trigger?.kind === "@"
        ? [
            ...files.map((file) => ({
              id: file.path,
              kind: "file",
              label: file.name,
              description: file.path.startsWith(s.cwd + "/")
                ? file.path.slice(s.cwd.length + 1)
                : file.path,
              icon: file.directory ? Folder : FileCode,
              file,
            })),
            ...matchingSkills,
          ]
        : [];
  const selected = Math.min(index, Math.max(0, items.length - 1));
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, items.length]);
  function choose(item) {
    if (!item || !trigger) return;
    const t = trigger,
      text = store.get().draft;
    let replacement = "";
    if (item.kind === "file") {
      const file = item.file;
      replacement = "@" + file.name + " ";
      store.addAttachment({
        id: store.uid(),
        name: file.name,
        input: {
          type: "text",
          text: `引用本机${file.directory ? "目录" : "文件"}：${file.path}\n请根据任务按需读取。`,
          text_elements: [],
        },
      });
    }
    if (item.kind === "skill") {
      store.addAttachment({
        id: store.uid(),
        name: item.skill.name,
        input: { type: "skill", name: item.skill.name, path: item.skill.path },
      });
    }
    store.setDraft(text.slice(0, t.start) + replacement + text.slice(t.end));
    setTrigger(null);
    setIndex(0);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(
        t.start + replacement.length,
        t.start + replacement.length,
      );
    });
    if (item.kind === "command")
      Promise.resolve().then(item.run).catch(store.report);
  }
  function keydown(e) {
    if (!trigger || e.nativeEvent.isComposing) return false;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setTrigger(null);
      return true;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setIndex(
        (selected + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
          Math.max(1, items.length),
      );
      return true;
    }
    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
      e.preventDefault();
      if (items.length) choose(items[selected]);
      return true;
    }
    return false;
  }
  const popup = trigger && (
    <div className="shortcut-popover">
      <div className="shortcut-heading">
        <span>
          {trigger.kind === "@" ? "引用文件、目录或技能" : "快捷命令与技能"}
        </span>
        <small>{trigger.kind === "@" ? store.basename(s.cwd) : "/"}</small>
      </div>
      <div
        className="shortcut-options"
        role="listbox"
        aria-label={trigger.kind === "@" ? "引用建议" : "快捷命令"}
        ref={list}
      >
        {items.map((item, i) => (
          <button
            role="option"
            aria-selected={selected === i}
            id={"shortcut-option-" + i}
            className={selected === i ? "selected" : ""}
            key={item.id}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setIndex(i)}
            onClick={() => choose(item)}
          >
            <span className="shortcut-icon">
              <item.icon size={17} />
            </span>
            <span>
              <b>{item.kind === "command" ? "/" + item.id : item.label}</b>
              <small>
                {item.kind === "command"
                  ? item.label + " · " + item.description
                  : item.description}
              </small>
            </span>
            {item.kind === "skill" ? (
              <em>技能</em>
            ) : item.kind === "file" && item.file.directory ? (
              <em>目录</em>
            ) : (
              <ChevronRight size={12} />
            )}
          </button>
        ))}
        {loading && (
          <div className="shortcut-empty">
            <LoaderCircle size={14} className="spin" />
            搜索项目文件…
          </div>
        )}
        {!loading && !items.length && (
          <div className="shortcut-empty">
            {error || "没有匹配项，继续输入以搜索。"}
          </div>
        )}
      </div>
      <div className="shortcut-footer">
        <span>↑ ↓ 选择 · Enter / Tab 确认</span>
        <span>Esc 关闭</span>
      </div>
    </div>
  );
  return {
    popup,
    open: !!trigger,
    activeId: items.length ? "shortcut-option-" + selected : undefined,
    detect,
    keydown,
  };
}
