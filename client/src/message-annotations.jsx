import React, {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { MessageSquare, X } from "lucide-react";
import { sendMessage, useStore } from "./store";
import { annotationMessage, parseAnnotations } from "./annotations";

export const AnnotationContext = createContext([]);
const draftListeners = new Set();
function subscribeDrafts(listener) {
  draftListeners.add(listener);
  return () => draftListeners.delete(listener);
}

export function AnnotationReference({ index }) {
  const annotation = useContext(AnnotationContext)[Number(index) - 1];
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="annotation-reference">
      <button
        type="button"
        className="annotation-marker"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <MessageSquare size={12} />
        注释 {index}
      </button>
      {open && (
        <span id={id} role="note" className="annotation-note">
          {annotation ? (
            <>
              <strong>选中的原文</strong>
              <span>{annotation.text}</span>
              {annotation.annotation && (
                <>
                  <strong>你的注释</strong>
                  <span>{annotation.annotation}</span>
                </>
              )}
            </>
          ) : (
            <span>加载包含此注释的用户消息后可查看原文与批注。</span>
          )}
        </span>
      )}
    </span>
  );
}

export function AnnotatedUserText({ text }) {
  const parsed = parseAnnotations(text);
  return (
    <>
      {parsed.annotations.map((entry, index) => (
        <details className="annotation-card" key={index} open>
          <summary>
            <MessageSquare size={14} />
            注释 {index + 1}
          </summary>
          <blockquote>{entry.text}</blockquote>
          {entry.annotation && <p>{entry.annotation}</p>}
        </details>
      ))}
      {parsed.text && <div className="user-text">{parsed.text}</div>}
    </>
  );
}

export function MessageAnnotations({ item, children }) {
  const s = useStore();
  const content = useRef();
  const key = `cx-annotation-${s.current?.id}-${item.id}`;
  const [selection, setSelection] = useState(null);
  const rawDraft = useSyncExternalStore(subscribeDrafts, () =>
    localStorage.getItem(key),
  );
  let draft;
  try {
    draft = JSON.parse(rawDraft);
  } catch {
    draft = null;
  }
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const unavailable =
    !s.connected ||
    s.busy ||
    s.loading ||
    (s.threadAccess && s.threadAccess.status !== "ready");
  useEffect(() => {
    const doc = content.current?.ownerDocument;
    if (!doc) return;
    doc.addEventListener("selectionchange", selectText);
    doc.addEventListener("scroll", selectText, true);
    return () => {
      doc.removeEventListener("selectionchange", selectText);
      doc.removeEventListener("scroll", selectText, true);
    };
  }, [item.id]);
  function update(next) {
    if (next) localStorage.setItem(key, JSON.stringify(next));
    else localStorage.removeItem(key);
    for (const listener of draftListeners) listener();
    setError("");
  }
  function selectText() {
    const selected = window.getSelection();
    if (!selected?.rangeCount || selected.isCollapsed) {
      setSelection(null);
      return;
    }
    const range = selected.getRangeAt(0);
    if (
      !content.current.contains(range.startContainer) ||
      !content.current.contains(range.endContainer)
    ) {
      setSelection(null);
      return;
    }
    const text = selected.toString();
    if (!text.trim()) {
      setSelection(null);
      return;
    }
    const before = range.cloneRange();
    before.selectNodeContents(content.current);
    before.setEnd(range.startContainer, range.startOffset);
    const startOffset = before.toString().length;
    const rect = range.getBoundingClientRect();
    setSelection({
      text,
      source: {
        messageId: item.id,
        startOffset,
        endOffset: startOffset + text.length,
      },
      anchor: {
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 160)),
        top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 44)),
      },
    });
  }
  async function submit(event) {
    event.preventDefault();
    if (sending || unavailable || !draft.annotation.trim()) return;
    setSending(true);
    setError("");
    const sent = await sendMessage(annotationMessage([draft]), [], {
      clearDraft: false,
    });
    if (sent) {
      if (localStorage.getItem(key) === rawDraft) update(null);
      setSelection(null);
    } else
      setError("注释发送失败，内容已保留，请恢复连接或对话写入状态后重试。");
    setSending(false);
  }
  return (
    <>
      <div ref={content} onPointerUp={selectText} onKeyUp={selectText}>
        {children}
      </div>
      {!draft && selection && (
        <button
          type="button"
          className="annotation-add"
          style={{ position: "fixed", zIndex: 40, ...selection.anchor }}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            update({
              text: selection.text,
              source: selection.source,
              annotation: "",
            });
            setSelection(null);
          }}
        >
          <MessageSquare size={14} />
          注释选中文字
        </button>
      )}
      {draft && (
        <form
          className="annotation-editor"
          onSubmit={submit}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              event.ctrlKey &&
              !event.nativeEvent.isComposing
            )
              submit(event);
          }}
        >
          <div className="annotation-editor-heading">
            <strong>添加注释</strong>
            <button
              type="button"
              aria-label="取消注释"
              disabled={sending}
              onClick={() => update(null)}
            >
              <X size={16} />
            </button>
          </div>
          <blockquote>{draft.text}</blockquote>
          <textarea
            aria-label="注释内容"
            placeholder="针对这段内容补充说明或修改要求…"
            autoFocus
            rows={3}
            value={draft.annotation}
            disabled={sending}
            onChange={(event) =>
              update({ ...draft, annotation: event.target.value })
            }
          />
          {error && <p role="alert">{error}</p>}
          <div className="annotation-editor-actions">
            <small>
              {unavailable
                ? "内容已保留，等待对话可发送"
                : "Ctrl+Enter 发送 · Enter 换行"}
            </small>
            <button
              type="submit"
              className="primary"
              disabled={sending || unavailable || !draft.annotation.trim()}
            >
              {sending ? "正在发送…" : "发送注释"}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
