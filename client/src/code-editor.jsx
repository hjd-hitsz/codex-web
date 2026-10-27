import React, { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  keymap,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import { fileLanguage, codeHighlightStyle } from "./editor-language";

export function CodeEditor({ path, text, onChange }) {
  const parent = useRef(),
    handler = useRef(onChange);
  handler.current = onChange;
  useEffect(() => {
    const editor = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          syntaxHighlighting(codeHighlightStyle),
          fileLanguage(path),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handler.current(update.state.doc.toString());
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              fontSize: "12px",
              backgroundColor: "var(--bg)",
              color: "var(--fg)",
            },
            ".cm-scroller": { overflow: "auto", fontFamily: "var(--mono)" },
            ".cm-gutters": {
              backgroundColor: "var(--subtle)",
              color: "var(--muted)",
              border: "none",
            },
            ".cm-activeLine": { backgroundColor: "var(--hover)" },
            ".cm-activeLineGutter": { backgroundColor: "var(--hover)" },
            ".cm-content": { padding: "12px 0" },
            ".cm-cursor": { borderLeftColor: "var(--fg)" },
          }),
        ],
      }),
    });
    return () => editor.destroy();
  }, [path]);
  return <div className="code-editor" ref={parent} />;
}
