const cacheKey = "cx-summary-zh-v1";
const clientKey = `browser-codex-web-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function needsTranslation(text) {
  const prose = text.replace(/```[\s\S]*?```|`[^`]*`/g, "");
  const chinese = prose.match(/[\u3400-\u9fff]/g)?.length || 0;
  const english = prose.match(/[a-zA-Z]/g)?.length || 0;
  return english > 2 && english > chinese * 3;
}

// 合并同一时间进入的摘要，并按原文缓存，避免流式更新和重复打开产生重复请求。
export function createSummaryTranslator(requestBatch, storage) {
  let cache;
  try {
    cache = new Map(JSON.parse(storage.getItem(cacheKey) || "[]"));
  } catch {
    cache = new Map();
  }
  const pending = new Map();
  const queue = [];
  let timer,
    running = false;
  function schedule() {
    if (!running && !timer && queue.length) timer = setTimeout(flush, 300);
  }
  async function flush() {
    timer = null;
    running = true;
    const batch = queue.splice(0, 24);
    try {
      const translations = await requestBatch(batch);
      if (
        !Array.isArray(translations) ||
        translations.length !== batch.length ||
        translations.some((text) => typeof text !== "string" || !text.trim())
      )
        throw new Error("翻译结果不完整");
      batch.forEach((text, index) => {
        cache.set(text, translations[index].trim());
        pending.get(text).resolve(cache.get(text));
      });
      cache = new Map([...cache].slice(-300));
      try {
        storage.setItem(cacheKey, JSON.stringify([...cache]));
      } catch {
        // 浏览器存储已满时，当前页面仍可使用内存中的译文。
      }
    } catch (error) {
      batch.forEach((text) => pending.get(text).reject(error));
    } finally {
      batch.forEach((text) => pending.delete(text));
      running = false;
      schedule();
    }
  }
  return {
    cached(text) {
      return needsTranslation(text) ? cache.get(text) : text;
    },
    translate(text) {
      if (!needsTranslation(text)) return Promise.resolve(text);
      if (cache.has(text)) return Promise.resolve(cache.get(text));
      if (pending.has(text)) return pending.get(text).promise;
      let resolve, reject;
      const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      pending.set(text, { promise, resolve, reject });
      queue.push(text);
      schedule();
      return promise;
    },
  };
}

export async function translateWithTransmart(texts) {
  // 机器翻译只处理正文，代码、路径和 Markdown 强调标记在返回后原样恢复。
  const protectedParts = texts.map(() => []);
  const source = texts.map((text, index) =>
    text.replace(
      /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|<[^>\n]+>|https?:\/\/[^\s)]+|(?:[A-Za-z]:[\\/]|~?\/|\.{1,2}\/)[^\s`*()[\]<>]+|\b[\w.@-]+(?:\/[\w.@+-]+)+|\*\*|__/g,
      (part) => `<x${protectedParts[index].push(part) - 1}>`,
    ),
  );
  const response = await fetch("https://transmart.qq.com/api/imt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      header: {
        fn: "auto_translation",
        client_key: clientKey,
        session: "",
        user: "",
      },
      type: "plain",
      model_category: "normal",
      source: { lang: "en", text_list: source },
      target: { lang: "zh" },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("翻译服务请求失败，请重试");
  const data = await response.json();
  if (data.header?.ret_code !== "succ")
    throw new Error("翻译服务暂不可用，请重试");
  if (
    !Array.isArray(data.auto_translation) ||
    data.auto_translation.length !== texts.length ||
    data.auto_translation.some(
      (text) => typeof text !== "string" || !text.trim(),
    )
  )
    throw new Error("翻译结果不完整");
  return data.auto_translation.map((text, index) => {
    const parts = protectedParts[index];
    const restored = new Set();
    const result = text.replace(/<\s*x\s*(\d+)\s*>/gi, (match, id) => {
      if (parts[id] === undefined || restored.has(id))
        throw new Error("翻译格式异常，请重试");
      restored.add(id);
      return parts[id];
    });
    if (restored.size !== parts.length) throw new Error("翻译格式异常，请重试");
    return result;
  });
}
