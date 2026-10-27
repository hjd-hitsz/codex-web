import React, { useState, useEffect, useRef } from "react";
import {
  ArrowUp,
  ArrowDown,
  Square,
  Plus,
  X,
  Copy,
  GitBranch,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Check,
  TerminalSquare,
  FileCode,
  Globe,
  Brain,
  LoaderCircle,
  Paperclip,
  Folder,
  Sparkles,
  ListChecks,
  Shield,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import {
  useStore,
  get,
  set,
  selectModel,
  setDraft,
  sendMessage,
  refreshThreadAccess,
  stop,
  report,
  copy,
  fork,
  attachFile,
  respond,
  basename,
  loadHistory,
  addAttachment,
  uid,
} from "./store";
import { IconButton, DiffBlock } from "./workspace";
import { useComposerShortcuts } from "./shortcuts";
import { actionableMessages } from "./message-actions";
import { reasoningSummaries } from "./reasoning-summary";
import { useSummaryTranslation } from "./use-summary-translation";
import { conversationGroups } from "./conversation-groups";
import { commandDescription } from "./command-description";
import { UserInputForm } from "./user-input";
import { ServiceTierToggle } from "./service-tier-toggle";
import { ReasoningEffortControl } from "./reasoning-effort";
import { MessageImage } from "./message-image";
import { RichText } from "./rich-text";
import { annotationContexts } from "./annotations";
import { AnnotatedUserText, MessageAnnotations } from "./message-annotations";
import { TurnFileChanges } from "./turn-file-changes";
export { RichText } from "./rich-text";
function Content({ content }) {
  return (
    <>
      {(content || []).map((c, i) =>
        c.type === "text" ? (
          <AnnotatedUserText key={i} text={c.text} />
        ) : c.type === "image" || c.type === "localImage" ? (
          <div key={i} className="message-image">
            {c.url || c.path ? (
              <MessageImage src={c.url || c.path} alt="图片附件" />
            ) : (
              <span>
                <Paperclip size={14} />
                {c.path || "图片附件"}
              </span>
            )}
          </div>
        ) : c.type === "skill" ? (
          <span key={i} className="skill-tag">
            <Sparkles size={14} />
            {c.name}
          </span>
        ) : null,
      )}
    </>
  );
}
const toolLabels = {
  commandExecution: "执行命令",
  fileChange: "修改文件",
  webSearch: "搜索网页",
  mcpToolCall: "调用工具",
  dynamicToolCall: "调用工具",
  collabAgentToolCall: "协作代理",
  imageView: "查看图片",
  contextCompaction: "整理上下文",
  plan: "计划",
  enteredReviewMode: "开始代码审查",
  exitedReviewMode: "代码审查完成",
};
function Activity({ item }) {
  const [open, setOpen] = useState(false);
  const working = ["inProgress", "running"].includes(item.status);
  const failed = ["failed", "declined"].includes(item.status);
  const Icon =
    item.type === "commandExecution"
      ? TerminalSquare
      : item.type === "fileChange"
        ? FileCode
        : item.type === "webSearch"
          ? Globe
          : Sparkles;
  let label = toolLabels[item.type] || item.type;
  if (item.type === "commandExecution")
    label = commandDescription(item.command);
  if (item.type === "mcpToolCall")
    label = [item.server, item.tool].filter(Boolean).join(" / ");
  if (item.type === "webSearch")
    label = item.query || item.action?.query || label;
  return (
    <div className={"activity " + (open ? "expanded" : "")}>
      <button
        className="activity-summary"
        aria-expanded={open}
        title={item.type === "commandExecution" ? item.command : undefined}
        onClick={() => setOpen(!open)}
      >
        {working ? (
          <LoaderCircle size={15} className="spin" />
        ) : (
          <Icon size={15} />
        )}
        <span>{label}</span>
        {item.type === "fileChange" && (
          <small>{item.changes?.length || 0} 个文件</small>
        )}
        {failed ? (
          <AlertCircle size={14} />
        ) : item.status === "completed" ? (
          <Check size={13} />
        ) : null}
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <div className="activity-body">
          {item.type === "commandExecution" ? (
            <>
              <small>原始命令</small>
              <pre>{item.command || "—"}</pre>
              <small>输出</small>
              <pre>{item.aggregatedOutput || "暂无输出"}</pre>
              <small>
                退出码 {item.exitCode ?? "—"} · {item.cwd}
              </small>
            </>
          ) : item.type === "fileChange" ? (
            (item.changes || []).map((c) => (
              <div key={c.path}>
                <button
                  className="changed-path"
                  onClick={() =>
                    set({
                      panel: "files",
                      panelFile: c.path.startsWith("/")
                        ? c.path
                        : get().cwd + "/" + c.path,
                    })
                  }
                >
                  <FileCode size={14} />
                  {c.path}
                </button>
                <DiffBlock diff={c.diff} />
              </div>
            ))
          ) : item.type === "plan" ? (
            <RichText text={item.text || ""} />
          ) : (
            <pre>
              {JSON.stringify(
                item.result || item.output || item.action || item,
                null,
                2,
              )}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
function Reasoning({ item }) {
  return reasoningSummaries(item.summary).map((summary, index) => (
    <ReasoningPart key={index} {...summary} />
  ));
}
function ReasoningPart({ title, body }) {
  const heading = useSummaryTranslation(title);
  const content = useSummaryTranslation(body);
  const status = heading.pending ? (
    <LoaderCircle size={12} className="spin" aria-label="正在翻译标题" />
  ) : null;
  return (
    <>
      {body ? (
        <details className="activity reasoning-summary">
          <summary className="activity-summary" title={title}>
            <Brain size={15} />
            <span>{heading.text}</span>
            {status}
            <ChevronRight className="summary-chevron" size={13} />
          </summary>
          <div className="activity-body">
            {content.pending ? (
              <span className="translation-status">正在翻译摘要…</span>
            ) : (
              <RichText text={content.text} />
            )}
            {content.error && (
              <button
                className="translation-retry"
                title={content.error}
                onClick={content.retry}
              >
                翻译失败，点击重试
              </button>
            )}
          </div>
        </details>
      ) : (
        <div className="activity reasoning-summary">
          <div className="activity-summary reasoning-title" title={title}>
            <Brain size={15} />
            <span>{heading.text}</span>
            {status}
          </div>
        </div>
      )}
      {heading.error && (
        <button
          className="translation-retry"
          title={heading.error}
          onClick={heading.retry}
        >
          标题翻译失败，点击重试
        </button>
      )}
    </>
  );
}
function Message({ item, annotations }) {
  if (item.type === "reasoning") return <Reasoning item={item} />;
  if (item.type === "agentMessage" && item.questions?.length)
    return (
      <article className="message assistant-message">
        {item.text?.trim() && (
          <MessageAnnotations item={item}>
            <RichText text={item.text} annotations={annotations} />
          </MessageAnnotations>
        )}
        <AsyncQuestion item={item} />
      </article>
    );
  if (item.type === "agentMessage" && item.phase === "commentary")
    return item.text?.trim() ? (
      <article className="message process-message">
        <MessageAnnotations item={item}>
          <RichText text={item.text} annotations={annotations} />
        </MessageAnnotations>
      </article>
    ) : null;
  if (item.type === "userMessage")
    return (
      <article className="message user-message">
        <div className="user-bubble">
          <Content content={item.content} />
        </div>
        <div className="message-actions">
          <IconButton
            icon={Copy}
            title="复制消息"
            onClick={() =>
              copy(
                item.content
                  ?.filter((c) => c.type === "text")
                  .map((c) => c.text)
                  .join("\n") || "",
              )
            }
          />
          <IconButton
            icon={RotateCcw}
            title="编辑并重新发送"
            onClick={() => {
              setDraft(
                item.content
                  ?.filter((c) => c.type === "text")
                  .map((c) => c.text)
                  .join("\n") || "",
              );
              document.querySelector('[aria-label="消息"]')?.focus();
            }}
          />
        </div>
      </article>
    );
  if (item.type === "agentMessage")
    return (
      <article className="message assistant-message">
        <MessageAnnotations item={item}>
          <RichText text={item.text} annotations={annotations} />
        </MessageAnnotations>
      </article>
    );
  return <Activity item={item} />;
}
function ReplyActions({ item }) {
  return (
    <div className="message-actions reply-actions" aria-label="回复操作">
      <IconButton
        icon={Copy}
        title="复制回复"
        onClick={() => copy(item.text)}
      />
      <IconButton
        icon={GitBranch}
        title="从这里创建分支"
        onClick={() => fork(get().current, item.turnId).catch(report)}
      />
    </div>
  );
}
function AsyncQuestion({ item }) {
  const s = useStore();
  const index = s.items.findIndex((entry) => entry.id === item.id);
  const answered = s.items.slice(index + 1).some((entry) => {
    if (entry.type !== "userMessage" || entry.optimistic) return false;
    const text = (entry.content || [])
      .filter((content) => content.type === "text")
      .map((content) => content.text)
      .join("\n");
    return item.questions.every((question) =>
      text.includes(`${question.title}\n回答：`),
    );
  });
  if (answered)
    return (
      <div className="request-card historical-questions">
        <div className="request-title">
          <MessageSquare size={18} />
          提问
        </div>
        {item.questions.map((question, index) => (
          <p key={index}>{question.title}</p>
        ))}
        <small className="request-hint">回答已发送，可在消息框继续补充。</small>
      </div>
    );
  return (
    <UserInputForm
      questions={item.questions.map((question, index) => ({
        id: String(index),
        header: `问题 ${index + 1}`,
        question: question.title,
        options: question.options?.map((label) => ({ label })),
      }))}
      isBlocking={false}
      disabled={!s.connected || s.busy}
      onSubmit={(answers) =>
        sendMessage(
          item.questions
            .map(
              (question, index) =>
                `${question.title}\n回答：${answers[index].answers[0]}`,
            )
            .join("\n\n"),
          [],
          { clearDraft: false },
        )
      }
    />
  );
}
function Question({ request }) {
  const s = useStore(),
    p = request.params;
  const input = request.method === "item/tool/requestUserInput";
  if (input)
    return (
      <UserInputForm
        questions={p.questions}
        isBlocking={p.isBlocking}
        disabled={!s.connected}
        onSubmit={(answers) => respond(request, { answers })}
      />
    );
  const permission = request.method === "item/permissions/requestApproval";
  const standard = [
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
  ].includes(request.method);
  return (
    <div className="request-card">
      <div className="request-title">
        <Shield size={18} />
        {permission ? "权限请求" : standard ? "等待你的确认" : "客户端工具请求"}
      </div>
      <p>{p.reason || p.command || request.method}</p>
      {permission && <pre>{JSON.stringify(p.permissions, null, 2)}</pre>}
      {standard || permission ? (
        <div className="request-actions">
          <button
            className="secondary"
            onClick={() =>
              respond(
                request,
                permission ? { permissions: {} } : { decision: "decline" },
              )
            }
          >
            拒绝
          </button>
          <button
            className="secondary"
            onClick={() =>
              respond(
                request,
                permission
                  ? { permissions: p.permissions, scope: "session" }
                  : { decision: "acceptForSession" },
              )
            }
          >
            本次会话允许
          </button>
          <button
            className="primary"
            onClick={() =>
              respond(
                request,
                permission
                  ? { permissions: p.permissions, scope: "turn" }
                  : { decision: "accept" },
              )
            }
          >
            允许一次
          </button>
        </div>
      ) : (
        <>
          <p className="muted">
            此工具需要对应客户端提供执行能力。可以取消此请求后继续对话。
          </p>
          <button
            className="secondary"
            onClick={() =>
              respond(request, null, {
                code: -32601,
                message: "当前网页客户端未提供此工具的执行器。",
              })
            }
          >
            取消此请求
          </button>
        </>
      )}
    </div>
  );
}
function ProcessGroup({ group, working, annotations }) {
  const [open, setOpen] = useState(false);
  const latest = group.items.at(-1);
  const summary =
    latest.type === "reasoning"
      ? reasoningSummaries(latest.summary).at(-1)
      : null;
  return (
    <div className="process-group">
      <details
        className="process-history"
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className="activity-summary">
          {working ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <ListChecks size={15} />
          )}
          <span>{working ? "正在处理" : "工作过程"}</span>
          <small>{group.items.length} 项</small>
          <ChevronRight className="process-chevron" size={13} />
        </summary>
        {open && (
          <div className="process-content">
            {group.items.map((item) => (
              <Message
                key={item.id}
                item={item}
                annotations={annotations.get(item.id)}
              />
            ))}
          </div>
        )}
      </details>
      {working && !open && (
        <div className="process-content process-preview">
          {summary ? (
            <ReasoningPart key={latest.id} {...summary} />
          ) : (
            <Message
              key={latest.id}
              item={latest}
              annotations={annotations.get(latest.id)}
            />
          )}
        </div>
      )}
    </div>
  );
}
export function Conversation() {
  const s = useStore(),
    scroll = useRef(),
    bottom = useRef(),
    follow = useRef(true);
  const [below, setBelow] = useState(false);
  const annotations = annotationContexts(s.items);
  const active = s.active[s.current?.id],
    plan = s.plans[s.current?.id];
  const actions = actionableMessages(
    s.items,
    s.turns[s.current?.id] || [],
    active,
  );
  const groups = conversationGroups(s.items);
  const replies = new Map(
    s.items
      .filter((item) => actions.has(item.id))
      .map((item) => [item.turnId, item]),
  );
  const lastGroups = new Map();
  for (const group of groups) {
    const turnId = group.turnId || group.item?.turnId;
    if (turnId) lastGroups.set(turnId, group.id);
  }
  useEffect(() => {
    follow.current = true;
  }, [s.current?.id]);
  useEffect(() => {
    if (follow.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [s.items, s.questions, plan, active, s.turnDiffs]);
  if (!s.current && !s.loading)
    return (
      <div className="welcome">
        <div className="welcome-symbol">
          <span>⌘</span>
        </div>
        <h1>今天想完成什么？</h1>
        <p>从一个想法开始，把工作交给 Codex。</p>
        <div className="suggestions">
          {[
            {
              icon: FileCode,
              title: "了解这个项目",
              text: "请阅读当前项目，介绍它的结构、运行方式和主要模块。",
            },
            {
              icon: GitBranch,
              title: "检查代码变更",
              text: "请审查当前项目尚未提交的代码变更，指出确实存在的问题。",
            },
            {
              icon: ListChecks,
              title: "制定实现计划",
              text: "我想实现一个新功能。先了解项目，并和我一起制定实现计划。",
            },
          ].map(({ icon: Icon, title, text }) => (
            <button
              key={title}
              onClick={() => {
                setDraft(text);
                document.querySelector('[aria-label="消息"]')?.focus();
              }}
            >
              <Icon size={19} />
              <span>{title}</span>
              <ChevronRight size={14} />
            </button>
          ))}
        </div>
      </div>
    );
  return (
    <div className="conversation-wrap">
      <div
        className="conversation"
        ref={scroll}
        onScroll={() => {
          const e = scroll.current;
          follow.current = e.scrollHeight - e.scrollTop - e.clientHeight < 100;
          setBelow(!follow.current);
        }}
      >
        <div className="message-column">
          {s.historyCursor && (
            <button
              className="load-older"
              onClick={() => loadHistory(true).catch(report)}
            >
              加载更早的消息
            </button>
          )}
          {s.loading ? (
            <div className="loading">
              <LoaderCircle className="spin" size={16} />
              正在打开对话…
            </div>
          ) : (
            groups.map((group) => {
              const turnId = group.turnId || group.item?.turnId;
              return (
                <React.Fragment key={`${s.current?.id}:${group.id}`}>
                  {group.type === "process" ? (
                    <ProcessGroup
                      key={`${s.current?.id}:${group.id}`}
                      group={group}
                      annotations={annotations}
                      working={!!active && active === group.turnId}
                    />
                  ) : (
                    <Message
                      key={`${s.current?.id}:${group.id}`}
                      item={group.item}
                      annotations={annotations.get(group.item.id)}
                    />
                  )}
                  {turnId && lastGroups.get(turnId) === group.id && (
                    <>
                      <TurnFileChanges
                        turnId={turnId}
                        items={s.items.filter((item) => item.turnId === turnId)}
                      />
                      {replies.has(turnId) && (
                        <ReplyActions item={replies.get(turnId)} />
                      )}
                    </>
                  )}
                </React.Fragment>
              );
            })
          )}
          {plan?.plan?.length > 0 && (
            <details className="plan-card" open={!!active}>
              <summary>
                <ListChecks size={16} />
                计划 ·{" "}
                {plan.plan.filter((p) => p.status === "completed").length}/
                {plan.plan.length}
              </summary>
              {plan.plan.map((p, i) => (
                <div key={i}>
                  {p.status === "completed" ? (
                    <CheckCircle2 size={15} />
                  ) : p.status === "inProgress" ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <span className="step-dot" />
                  )}
                  <span className={p.status === "completed" ? "done" : ""}>
                    {p.step}
                  </span>
                </div>
              ))}
            </details>
          )}
          {s.questions
            .filter((q) => q.params?.threadId === s.current?.id)
            .map((q) => (
              <Question key={q.id} request={q} />
            ))}
          {active && (
            <div className="working-status">
              <span className="pulse-dot" />
              Codex 正在工作<small>你可以继续补充要求</small>
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>
      {below && (
        <button
          className="scroll-bottom"
          title="回到最新消息"
          onClick={() => {
            follow.current = true;
            bottom.current?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          <ArrowDown size={16} />
        </button>
      )}
    </div>
  );
}
export function Composer() {
  const s = useStore(),
    area = useRef(),
    files = useRef();
  const shortcuts = useComposerShortcuts(area);
  const active = s.active[s.current?.id];
  useEffect(() => {
    if (area.current) {
      area.current.style.height = "auto";
      area.current.style.height =
        Math.min(area.current.scrollHeight, 180) + "px";
    }
  }, [s.draft, s.threadAccess?.status]);
  async function add(files) {
    for (const file of files)
      try {
        await attachFile(file);
      } catch (e) {
        report(e);
      }
  }
  const token = s.tokenUsage[s.current?.id];
  const usage = token?.last?.totalTokens;
  const windowSize = token?.modelContextWindow;
  const access = s.threadAccess;
  const unavailable = s.loading || (access && access.status !== "ready");
  const checking = s.loading || access?.status === "checking";
  return (
    <div className="composer-wrap">
      {!unavailable && shortcuts.popup}
      {unavailable ? (
        <div
          className="composer-access"
          role="status"
          aria-live="polite"
          aria-busy={checking}
        >
          {checking ? (
            <LoaderCircle size={20} className="spin" />
          ) : (
            <AlertCircle size={20} />
          )}
          <div className="composer-access-content">
            <strong>
              {checking
                ? "正在检查对话状态…"
                : access?.status === "blocked"
                  ? "此对话由另一端使用"
                  : "暂时无法连接此对话"}
            </strong>
            <p>
              {checking
                ? "正在确认是否可以继续发送，历史记录仍可查看。"
                : access?.status === "blocked"
                  ? "历史记录可正常查看。点击“重试”刷新状态，恢复后即可继续发送。"
                  : access?.message}
            </p>
            {(s.draft || s.attachments.length > 0) && (
              <small>草稿和附件已保留。</small>
            )}
          </div>
          <button
            className="secondary"
            aria-label="重试连接对话"
            disabled={!s.connected || checking}
            onClick={() => refreshThreadAccess()}
          >
            <RefreshCw size={14} />
            {checking ? "正在检查…" : "重试"}
          </button>
        </div>
      ) : (
        <div
          className="composer"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            add(e.dataTransfer.files);
          }}
        >
          {s.attachments.length > 0 && (
            <div className="attachment-list">
              {s.attachments.map((a) => (
                <div className="attachment" key={a.id}>
                  {a.preview ? (
                    <img src={a.preview} />
                  ) : (
                    <Paperclip size={17} />
                  )}
                  <span>{a.name}</span>
                  <IconButton
                    icon={X}
                    title={"移除 " + a.name}
                    onClick={() =>
                      set({
                        attachments: s.attachments.filter((x) => x.id !== a.id),
                      })
                    }
                  />
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={area}
            aria-label="消息"
            aria-autocomplete="list"
            aria-expanded={shortcuts.open}
            aria-activedescendant={
              shortcuts.open ? shortcuts.activeId : undefined
            }
            placeholder={
              active
                ? "补充说明，或等待 Codex 完成…"
                : "描述任务，@ 引用文件，/ 使用命令…"
            }
            value={s.draft}
            onChange={(e) => {
              setDraft(e.target.value);
              shortcuts.detect(e.target.value, e.target.selectionStart);
            }}
            onClick={(e) =>
              shortcuts.detect(e.target.value, e.target.selectionStart)
            }
            onKeyUp={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                shortcuts.detect(e.target.value, e.target.selectionStart);
            }}
            onPaste={(e) => {
              const images = [...e.clipboardData.files].filter((f) =>
                f.type.startsWith("image/"),
              );
              if (images.length) {
                e.preventDefault();
                add(images);
              }
            }}
            onKeyDown={(e) => {
              if (shortcuts.keydown(e)) return;
              if (
                e.key === "Enter" &&
                e.ctrlKey &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                sendMessage();
              }
            }}
          />
          <div className="composer-toolbar">
            <div className="composer-tools">
              <input
                type="file"
                ref={files}
                multiple
                hidden
                onChange={(e) => {
                  add(e.target.files);
                  e.target.value = "";
                }}
              />
              <IconButton
                icon={Plus}
                title="添加图片或文本附件"
                onClick={() => files.current.click()}
              />
              <label className="select-control model-select">
                <select
                  aria-label="模型"
                  value={s.model}
                  onChange={(e) => {
                    const m = s.models.find((m) => m.model === e.target.value);
                    selectModel(m);
                  }}
                >
                  {s.models.map((m) => (
                    <option key={m.id} value={m.model}>
                      {m.displayName || m.model}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} />
              </label>
              <ReasoningEffortControl />
              <ServiceTierToggle />
              <IconButton
                icon={ListChecks}
                title="计划模式"
                active={s.mode === "plan"}
                onClick={() =>
                  set({ mode: s.mode === "plan" ? "default" : "plan" })
                }
              />
            </div>
            <div className="send-controls">
              {s.mode === "plan" && <span className="mode-badge">计划</span>}
              {active && (
                <button
                  className="stop-button"
                  aria-label="停止任务"
                  title="停止任务"
                  onClick={() => stop().catch(report)}
                >
                  <Square size={13} fill="currentColor" />
                </button>
              )}
              <button
                className="send-button"
                aria-label="发送消息"
                title="发送消息"
                disabled={
                  !s.connected ||
                  s.busy ||
                  (!s.draft.trim() && !s.attachments.length)
                }
                onClick={() => sendMessage()}
              >
                {s.busy ? (
                  <LoaderCircle size={18} className="spin" />
                ) : (
                  <ArrowUp size={19} />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="composer-meta">
        <button
          title={s.projectless ? "未指定项目；可选择文件夹" : s.cwd}
          onClick={() => set({ modal: { type: "directory" } })}
        >
          <Folder size={13} />
          <span>{s.projectless ? "未分类" : basename(s.cwd)}</span>
          <ChevronDown size={11} />
        </button>
        <span className="context-info">
          {usage != null ? (
            <>
              上下文 {usage.toLocaleString()} /{" "}
              {windowSize?.toLocaleString() ?? "—"} tokens
              {windowSize > 0 &&
                `（${Math.round((usage / windowSize) * 100)}%）`}
            </>
          ) : unavailable ? (
            "历史记录可查看"
          ) : (
            "Ctrl + Enter 发送"
          )}
        </span>
      </div>
    </div>
  );
}
