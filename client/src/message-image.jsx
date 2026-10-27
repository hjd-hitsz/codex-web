import React, { useEffect, useState } from "react";
import { rpc, useStore } from "./store";
import { imageDataUrl, localImagePath } from "./image-source";
import { ImageViewer } from "./image-viewer";

export function MessageImage({ src, alt = "", title, cwd: baseDirectory }) {
  const { connected, current, cwd, defaultCwd } = useStore();
  const path = localImagePath(
    src,
    baseDirectory ?? (current?.cwd || cwd || defaultCwd),
  );
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [failedUrl, setFailedUrl] = useState(null);
  const [preview, setPreview] = useState(null);
  const loaded =
    result?.path === path && result.attempt === attempt ? result : null;
  const url = path ? loaded?.url : src;
  const failed = !src || loaded?.error || (url && failedUrl === url);
  const expanded = Boolean(
    preview && preview.src === src && preview.url === url,
  );

  useEffect(() => setPreview(null), [src, url]);

  useEffect(() => {
    if (!path || !connected) return;
    let cancelled = false;
    rpc("fs/readFile", { path }).then(
      ({ dataBase64 }) => {
        if (!cancelled)
          setResult({ path, attempt, url: imageDataUrl(path, dataBase64) });
      },
      (error) => {
        if (!cancelled) setResult({ path, attempt, error: error.message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, connected, attempt]);

  if (url && !failed)
    return (
      <>
        <button
          className="message-image-button"
          type="button"
          aria-label={"查看大图：" + (alt || "图片")}
          aria-haspopup="dialog"
          aria-expanded={expanded}
          title={title || "点击查看大图"}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setPreview({ src, url });
          }}
        >
          <img
            key={attempt}
            src={url}
            alt={alt}
            title={title}
            loading="lazy"
            onError={() => setFailedUrl(url)}
          />
        </button>
        {expanded && (
          <ImageViewer url={url} alt={alt} onClose={() => setPreview(null)} />
        )}
      </>
    );
  return (
    <span className="message-image-status" role="status" title={loaded?.error}>
      <span>
        {alt || "图片"} ·{" "}
        {failed
          ? "图片加载失败"
          : path && !connected
            ? "等待连接后加载图片"
            : "正在加载图片…"}
      </span>
      {failed && (
        <button
          type="button"
          disabled={Boolean(path && !connected)}
          aria-label="重试加载图片"
          onClick={() => {
            setFailedUrl(null);
            setAttempt(attempt + 1);
          }}
        >
          重试
        </button>
      )}
    </span>
  );
}
