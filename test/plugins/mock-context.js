// Shared fake opencode plugin context for the node:test suites.
//
// Mirrors only the V2 plugin API surface the plugins actually use:
// ctx.location, ctx.event.subscribe (server-wide async stream),
// ctx.session.{get, prompt, hook}, ctx.tool.hook, ctx.agent.get.
//
// The event stream is driven by the test: pushEvent() feeds events to
// every subscriber; the stream ends when the plugin's teardown aborts
// its AbortSignal (the same lifecycle as the real server).

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function flush(times = 10) {
  for (let i = 0; i < times; i++) await sleep(0);
}

// Poll until predicate() is true or the timeout fires; throws on timeout
// so a stuck event loop fails loudly instead of passing vacuously.
export async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() >= deadline) {
      throw new Error("waitFor timed out");
    }
    await sleep(5);
  }
}

export function topSession(id, directory, extra = {}) {
  return { id, location: { directory }, ...extra };
}

export function childSession(id, directory, extra = {}) {
  return { id, parentID: "parent-1", location: { directory }, ...extra };
}

export function createMockContext({
  directory = "/proj",
  sessions = {},
  agents = {},
} = {}) {
  const sessionMap = new Map(Object.entries(sessions));
  const agentMap = new Map(Object.entries(agents));
  const queue = [];
  let waiters = [];
  let subscribeCalls = 0;

  const wake = () => {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
  };

  const ctx = {
    location: { directory },
    prompts: [],
    hooks: { session: new Map(), tool: new Map() },
    get subscribeCalls() {
      return subscribeCalls;
    },
    pushEvent(event) {
      queue.push(event);
      wake();
    },
    event: {
      subscribe({ signal } = {}) {
        subscribeCalls += 1;
        return (async function* stream() {
          for (;;) {
            if (queue.length > 0) {
              yield queue.shift();
              continue;
            }
            if (signal?.aborted) return;
            await new Promise((resolve) => {
              waiters.push(resolve);
              signal?.addEventListener("abort", resolve, { once: true });
            });
            if (signal?.aborted) return;
          }
        })();
      },
    },
    session: {
      async get({ path }) {
        const info = sessionMap.get(path.id);
        if (info instanceof Error) throw info;
        return { data: info ?? null };
      },
      async prompt({ path, body }) {
        ctx.prompts.push({ sessionID: path.id, text: body.text });
      },
      async hook(name, fn) {
        ctx.hooks.session.set(name, fn);
        return { dispose() {} };
      },
      // Test-only helpers: inspect and mutate the fake session registry.
      _set(id, info) {
        sessionMap.set(id, info);
      },
    },
    tool: {
      async hook(name, fn) {
        ctx.hooks.tool.set(name, fn);
        return { dispose() {} };
      },
    },
    agent: {
      async get({ agentID }) {
        return { data: agentMap.get(agentID) ?? null };
      },
    },
  };

  return ctx;
}
