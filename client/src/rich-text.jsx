import React, { createContext, useContext } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css";
import { Copy } from "lucide-react";
import { copy } from "./store";
import { MermaidBlock } from "./mermaid-block";
import { MessageImage } from "./message-image";
import { MessageLink } from "./message-link";
import { messageUrlTransform } from "./image-source";
import { remarkAnnotations } from "./annotations";
import { AnnotationReference, AnnotationContext } from "./message-annotations";

const DirectoryContext = createContext(undefined);

function MarkdownImage(props) {
  const cwd = useContext(DirectoryContext);
  return <MessageImage {...props} cwd={cwd} />;
}

function MarkdownLink(props) {
  const cwd = useContext(DirectoryContext);
  return <MessageLink {...props} cwd={cwd} />;
}

function mathDelimiters(text) {
  return (text || "")
    .split(
      /(\x60\x60\x60[\s\S]*?\x60\x60\x60|~~~[\s\S]*?~~~|\x60[^\x60]*\x60)/g,
    )
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => "$" + math + "$")
            .replace(
              /\\\[([\s\S]*?)\\\]/g,
              (_, math) => "\n$$\n" + math + "\n$$\n",
            ),
    )
    .join("");
}

export function RichText({ text, annotations = [], cwd }) {
  return (
    <div className="markdown">
      <DirectoryContext.Provider value={cwd}>
        <AnnotationContext.Provider value={annotations}>
          <Markdown
            urlTransform={messageUrlTransform}
            remarkPlugins={[remarkGfm, remarkMath, remarkAnnotations]}
            rehypePlugins={[
              rehypeKatex,
              [rehypeHighlight, { plainText: ["mermaid"] }],
            ]}
            components={{
              a: MarkdownLink,
              pre: CodeBlock,
              img: MarkdownImage,
              "annotation-ref": AnnotationReference,
            }}
          >
            {mathDelimiters(text)}
          </Markdown>
        </AnnotationContext.Provider>
      </DirectoryContext.Provider>
    </div>
  );
}

function CodeBlock({ children }) {
  const language = children?.props?.className?.match(/language-([\w-]+)/)?.[1];
  const source = extractText(children);
  if (language === "mermaid") return <MermaidBlock source={source} />;
  return (
    <div className="code-block">
      <div className="code-heading">
        <span>{language || "代码"}</span>
        <button
          className="icon-button"
          title="复制代码"
          aria-label="复制代码"
          onClick={() => copy(source)}
        >
          <Copy size={17} />
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function extractText(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  return node?.props ? extractText(node.props.children) : "";
}
