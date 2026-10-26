export const threadTime = (thread) =>
  thread.completedAt ?? thread.createdAt ?? 0;

export function sortThreads(threads) {
  return threads
    .slice()
    .sort((a, b) => threadTime(b) - threadTime(a) || a.id.localeCompare(b.id));
}

export function projectGroups(threads, projects, pins, cwd) {
  const groups = new Map(projects.map((path) => [path, []]));
  const times = new Map();
  for (const thread of sortThreads(threads)) {
    const path = thread.cwd || cwd;
    if (!groups.has(path)) groups.set(path, []);
    times.set(path, Math.max(times.get(path) || 0, threadTime(thread)));
    if (!pins.includes(thread.id)) groups.get(path).push(thread);
  }
  return [...groups].sort(
    ([a], [b]) =>
      (times.get(b) || 0) - (times.get(a) || 0) || a.localeCompare(b),
  );
}

// 先读取所有对话元数据再排序，确保最近完成的对话能进入第一页。
export function createThreadOrdering(rpc) {
  const cache = new Map();
  const observed = new Map();

  function completed(threadId, turn) {
    if (turn.status === "inProgress" || !Number.isFinite(turn.completedAt))
      return;
    observed.set(
      threadId,
      Math.max(observed.get(threadId) ?? 0, turn.completedAt),
    );
    cache.delete(threadId);
  }

  async function completion(thread) {
    const existing = cache.get(thread.id);
    if (existing?.updatedAt === thread.updatedAt) return existing.promise;
    const entry = { updatedAt: thread.updatedAt };
    entry.promise = (async () => {
      let cursor;
      let latest = null;
      do {
        const page = await rpc("thread/turns/list", {
          threadId: thread.id,
          limit: 100,
          sortDirection: "desc",
          itemsView: "notLoaded",
          ...(cursor ? { cursor } : {}),
        });
        for (const turn of page.data) {
          if (turn.status !== "inProgress" && Number.isFinite(turn.completedAt))
            latest = Math.max(latest ?? 0, turn.completedAt);
        }
        cursor = page.nextCursor;
      } while (cursor);
      return latest;
    })();
    cache.set(thread.id, entry);
    try {
      return await entry.promise;
    } catch (error) {
      if (cache.get(thread.id) === entry) cache.delete(thread.id);
      throw error;
    }
  }

  async function hydrate(threads) {
    const result = new Array(threads.length);
    let index = 0;
    await Promise.all(
      Array.from({ length: Math.min(6, threads.length) }, async () => {
        while (index < threads.length) {
          const position = index++;
          const thread = threads[position];
          const time = await completion(thread).catch(
            () => thread.completedAt ?? null,
          );
          if (time != null)
            observed.set(
              thread.id,
              Math.max(observed.get(thread.id) ?? 0, time),
            );
          result[position] = {
            ...thread,
            completedAt: time,
          };
        }
      }),
    );
    return sortThreads(
      result.map((thread) => ({
        ...thread,
        completedAt: observed.get(thread.id) ?? thread.completedAt,
      })),
    );
  }

  async function list(params) {
    const threads = new Map();
    let cursor;
    do {
      const page = await rpc("thread/list", {
        ...params,
        limit: 100,
        sortKey: "created_at",
        sortDirection: "desc",
        ...(cursor ? { cursor } : {}),
      });
      for (const thread of page.data) threads.set(thread.id, thread);
      cursor = page.nextCursor;
    } while (cursor);
    return hydrate([...threads.values()]);
  }

  function forget(id) {
    cache.delete(id);
    observed.delete(id);
  }

  return { list, hydrate, completed, forget };
}
