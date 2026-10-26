import { useEffect, useState } from "react";
import { get, rpc, onEvent } from "./store";
import {
  createSummaryTranslator,
  translateWithCodex,
} from "./summary-translator";

const translator = createSummaryTranslator((texts) => {
  const state = get();
  const model =
    state.models.find((entry) => entry.model === "gpt-6-luna")?.model ||
    state.model;
  return translateWithCodex(texts, { rpc, onEvent, model, cwd: state.cwd });
}, localStorage);

export function useSummaryTranslation(text, enabled = true) {
  const [result, setResult] = useState({}),
    [attempt, retry] = useState(0);
  const cached = translator.cached(text);
  useEffect(() => {
    if (!enabled || cached !== undefined) return;
    let active = true;
    // 等待流式文本短暂停顿，避免翻译尚未完成的标题。
    const timer = setTimeout(() => {
      translator.translate(text).then(
        (value) => {
          if (active) setResult({ source: text, value });
        },
        (error) => {
          if (active) setResult({ source: text, error: error.message });
        },
      );
    }, 900);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [text, enabled, attempt, cached]);
  const current = result.source === text ? result : {};
  return {
    text: cached ?? current.value ?? text,
    pending:
      enabled && cached === undefined && !current.value && !current.error,
    error: current.error,
    retry: () => {
      setResult({});
      retry((value) => value + 1);
    },
  };
}
