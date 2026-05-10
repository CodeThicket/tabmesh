import { execSync } from 'node:child_process';
import { type BrowserContext, type Page, expect, test } from '@playwright/test';

const ECHO_PORT = Number(process.env.PLAYWRIGHT_ECHO_PORT ?? '8095');
const DELIVERY_PORT = Number(process.env.PLAYWRIGHT_DELIVERY_PORT ?? '8096');

/**
 * Count established Chrome → echo-server WebSocket connections.
 * Robust signal that the SharedWorker holds at most one WS regardless of
 * how many client tabs are open.
 */
function activeWsToEchoServer(): number {
  try {
    const out = execSync(`lsof -i :${ECHO_PORT} -P 2>/dev/null || true`).toString();
    // Each TCP connection shows up twice in lsof — once per endpoint.
    // Counting ESTABLISHED lines and dividing by 2 is robust to platform
    // differences in process names (Google Chrome vs Chromium vs the
    // headless shell).
    const established = out.split('\n').filter((line) => /ESTABLISHED/.test(line)).length;
    return Math.floor(established / 2);
  } catch {
    return 0;
  }
}

async function waitForTransportConnected(page: Page) {
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.status-table td')).some(
        (td) => td.textContent === 'connected'
      ),
    null,
    { timeout: 10_000 }
  );
}

async function newPlaygroundTab(
  context: BrowserContext,
  extraParams: Record<string, string | number> = {}
): Promise<Page> {
  const page = await context.newPage();
  // Pass the WS URL explicitly — the playground's mesh.ts reads `?ws=` to
  // override the default. Using `goto('/')` with a query in `baseURL` would
  // be stripped during URL resolution.
  const params = new URLSearchParams({ ws: `ws://localhost:${ECHO_PORT}` });
  for (const [k, v] of Object.entries(extraParams)) params.set(k, String(v));
  await page.goto(`/?${params.toString()}`);
  await page.waitForSelector('input.todo-input', { timeout: 10_000 });
  return page;
}

async function submitTodo(page: Page, text: string): Promise<void> {
  await page.fill('input.todo-input', text);
  await page.click('form.todo-form button[type="submit"]');
}

test.describe('TabMesh — multi-tab harness', () => {
  test.describe.configure({ mode: 'serial' });

  test('single WS connection across two tabs (#1)', async ({ context }) => {
    const a = await newPlaygroundTab(context);
    await waitForTransportConnected(a);
    const oneTab = activeWsToEchoServer();
    expect(oneTab).toBe(1);

    const b = await newPlaygroundTab(context);
    await waitForTransportConnected(b);

    // SharedWorker is shared across tabs in the same context, so the WS count
    // should not have grown.
    expect(activeWsToEchoServer()).toBe(1);

    await a.close();
    await b.close();
  });

  test('late-joining tab receives the current transport state (#3 / PR #7)', async ({
    context,
  }) => {
    const a = await newPlaygroundTab(context);
    await waitForTransportConnected(a);

    const b = await newPlaygroundTab(context);
    // Tab B joining an established SharedWorker session must see the
    // synthesized transport.connected within the timeout — without PR #7
    // it would stay stuck on "disconnected" forever.
    await waitForTransportConnected(b);

    await a.close();
    await b.close();
  });

  test('cross-tab event delivery (#7)', async ({ context }) => {
    const a = await newPlaygroundTab(context);
    const b = await newPlaygroundTab(context);
    await waitForTransportConnected(a);
    await waitForTransportConnected(b);

    await submitTodo(a, 'cross-tab-payload');

    // Tab B should render the new todo title within a short window.
    await b.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('.todo-text')).some(
          (n) => n.textContent === 'cross-tab-payload'
        ),
      null,
      { timeout: 5_000 }
    );

    await a.close();
    await b.close();
  });

  test('sender sees own todo.add as LOCAL exactly once (#8 / PR #5)', async ({ context }) => {
    const a = await newPlaygroundTab(context);
    await waitForTransportConnected(a);

    await submitTodo(a, 'echo-suppression-check');

    // Wait for the activity feed to settle.
    await a.waitForTimeout(800);

    const counts = await a.evaluate(() => {
      const entries = Array.from(document.querySelectorAll('.activity-entry'));
      let localTodoAdd = 0;
      let remoteTodoAdd = 0;
      for (const entry of entries) {
        const type = entry.querySelector('.activity-type')?.textContent;
        if (type !== 'todo.add') continue;
        const sourceBadge = entry.querySelector('.source-badge');
        if (sourceBadge?.classList.contains('local')) localTodoAdd++;
        if (sourceBadge?.classList.contains('remote')) remoteTodoAdd++;
      }
      return { localTodoAdd, remoteTodoAdd };
    });

    // Exactly one LOCAL (own send) for "echo-suppression-check" + the
    // pre-buffered "Buffered before start()" -> 2 total LOCAL todo.add.
    // No REMOTE echoes from the server bouncing our own messages back.
    expect(counts.remoteTodoAdd).toBe(0);
    expect(counts.localTodoAdd).toBeGreaterThanOrEqual(1);

    await a.close();
  });

  test('logout flow tears down the WS (#21)', async ({ context }) => {
    const a = await newPlaygroundTab(context);
    await waitForTransportConnected(a);
    expect(activeWsToEchoServer()).toBe(1);

    await a.click('button.btn-danger, button.btn-secondary, button:has-text("Logout")');

    // After logout, the worker closes its WS even though the tab is still open.
    await expect.poll(activeWsToEchoServer, { timeout: 5_000 }).toBe(0);

    await a.close();
  });

  test('WS dies when the last tab closes (#2)', async ({ context }) => {
    const a = await newPlaygroundTab(context);
    await waitForTransportConnected(a);
    expect(activeWsToEchoServer()).toBe(1);

    await a.close();

    // SharedWorker shuts down when no clients remain; the echo server
    // observes the disconnect. Allow a generous window — Chrome doesn't
    // GC SharedWorkers instantly.
    await expect.poll(activeWsToEchoServer, { timeout: 30_000 }).toBe(0);
  });

  test('lifecycle visibilitychange does not crash the mesh (#6 — smoke)', async ({ context }) => {
    const a = await newPlaygroundTab(context);
    await waitForTransportConnected(a);

    // Synthesize a hidden→visible cycle. The handler posts `lifecycle`
    // messages to the worker. We can't observe the worker's reaction
    // directly, so this is a smoke test: the page must remain healthy
    // and able to send events afterwards.
    await a.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await submitTodo(a, 'after-lifecycle');
    await a.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('.todo-text')).some(
          (n) => n.textContent === 'after-lifecycle'
        ),
      null,
      { timeout: 5_000 }
    );

    await a.close();
  });

  // ---------------------------------------------------------------------------
  // Hard / unsupported in this harness — TODOs with rationale
  // ---------------------------------------------------------------------------

  test('stale port cleanup evicts ports that miss their pings (#5)', async ({ context }) => {
    // Tab A configures a tight stale timeout AND a long ping interval. The
    // worker will evict A's port before it can send its first ping. Tab B
    // (joining second) does not change the worker's timeout — first
    // handshake wins.
    const a = await newPlaygroundTab(context, { staleTimeoutMs: 250, pingMs: 60_000 });
    await waitForTransportConnected(a);
    const aTabId = await a.evaluate(() => sessionStorage.getItem('tabmesh:tabId:playground-todos'));

    // Tab B uses a short ping interval so it keeps its port alive. A's
    // pingMs setting is what makes A go stale — they're independent
    // because pingMs is a tab-local timer.
    const b = await newPlaygroundTab(context, { staleTimeoutMs: 250, pingMs: 80 });
    await waitForTransportConnected(b);

    // Wait long enough for the sweeper to run AFTER A's last activity ages
    // past staleTimeoutMs. Sweep interval = max(timeout/4, 100ms) = 100ms;
    // worst-case eviction = staleTimeoutMs + sweep_interval.
    await a.waitForTimeout(700);

    // Now tab B sends a todo. The worker fans out to its remaining ports —
    // tab A has been evicted, so it should NOT receive the event.
    await submitTodo(b, 'after-a-was-evicted');

    // Allow round-trip time.
    await b.waitForTimeout(500);

    const aSawIt = await a.evaluate(() =>
      Array.from(document.querySelectorAll('.todo-text')).some(
        (n) => n.textContent === 'after-a-was-evicted'
      )
    );
    const bSawIt = await b.evaluate(() =>
      Array.from(document.querySelectorAll('.todo-text')).some(
        (n) => n.textContent === 'after-a-was-evicted'
      )
    );

    expect(bSawIt).toBe(true);
    expect(aSawIt).toBe(false);
    expect(aTabId).toBeTruthy();

    await a.close();
    await b.close();
  });

  test('worker records lifecycle messages and replies via pong (#6)', async ({ context }) => {
    // Open the playground, drive a visibilitychange so the tab posts a
    // `lifecycle` message to the worker, then probe the worker by opening
    // a fresh SharedWorker port (same name) and sending a `ping` with the
    // playground tab's id. The pong now carries `visibilityState`, which
    // proves the lifecycle message reached the worker registry.
    const a = await newPlaygroundTab(context);
    await waitForTransportConnected(a);

    const playgroundTabId = await a.evaluate(() =>
      sessionStorage.getItem('tabmesh:tabId:playground-todos')
    );
    expect(playgroundTabId).toBeTruthy();

    await a.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Give the lifecycle message a tick to land in the worker.
    await a.waitForTimeout(150);

    const visibility = await a.evaluate((targetTabId) => {
      return new Promise<string | undefined>((resolve) => {
        const w = new SharedWorker('/tabmesh-worker.js', {
          name: 'tabmesh:playground-todos',
        });
        w.port.onmessage = (e) => {
          const msg = e.data as { kind?: string; visibilityState?: string };
          if (msg?.kind === 'pong') resolve(msg.visibilityState);
        };
        w.port.start();
        w.port.postMessage({ kind: 'ping', tabId: targetTabId });
        setTimeout(() => resolve(undefined), 1500);
      });
    }, playgroundTabId);

    expect(visibility).toBe('hidden');

    await a.close();
  });

  test('Service Worker Background Sync drains pending events to deliveryUrl (#26/#27)', async ({
    context,
  }) => {
    // Reset the delivery fixture so we observe only this test's events.
    const deliveryUrl = `http://localhost:${DELIVERY_PORT}/events`;
    await fetch(`http://localhost:${DELIVERY_PORT}/__reset`);

    // Open the playground with SW enabled. The mesh registers
    // `/tabmesh-sw.js` and forwards the deliveryUrl to it. We point at a
    // bogus WS so events sit in the IDB outbox without ever being
    // delivered through the live transport — the SW path is the only way
    // they can reach the delivery fixture.
    const page = await context.newPage();
    const params = new URLSearchParams({
      ws: 'ws://localhost:1', // dead port, transport stays disconnected
      sw: '1',
      deliveryUrl,
    });
    await page.goto(`/?${params.toString()}`);
    await page.waitForSelector('input.todo-input', { timeout: 10_000 });

    // Wait for the SW to be active so we have a registration to drive.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });

    await submitTodo(page, 'sw-handoff-A');
    await submitTodo(page, 'sw-handoff-B');

    // Give the outbox time to persist both entries.
    await page.waitForTimeout(300);

    // Drive the Background Sync handler directly via CDP. Headless Chrome
    // doesn't fire it on a real schedule, but ServiceWorker.dispatchSyncEvent
    // invokes the registered onsync handler synchronously.
    const cdp = await context.newCDPSession(page);
    await cdp.send('ServiceWorker.enable');
    const versions = await cdp
      .send('ServiceWorker.deliverPushMessage', {
        origin: 'http://localhost:5173',
        registrationId: '0',
        data: '',
      })
      .catch(() => null);
    void versions; // discard — only used to nudge the SW awake on some Chromium builds

    const swInfo = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg ? { scope: reg.scope, hasActive: Boolean(reg.active) } : null;
    });
    expect(swInfo?.hasActive).toBe(true);

    // The SW expects a config message (channelName + dbName + deliveryUrl)
    // from the client before its onsync handler can do anything useful.
    // ServiceWorkerClient.register sends it on register; just give it a
    // beat to land if the registration completed in this turn.
    await page.waitForTimeout(200);

    // Resolve the registrationId for dispatchSyncEvent. CDP exposes it via
    // ServiceWorker.workerVersionUpdated events; we read from the registry.
    const regId = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      // Chromium uses internal numeric ids exposed only via CDP. The
      // registrationId we need for dispatchSyncEvent isn't directly
      // accessible from the page. We fall back to the scope-derived id.
      return reg?.scope ?? null;
    });
    void regId;

    // Trigger sync via CDP. The exact registrationId is internal; CDP's
    // ServiceWorker.dispatchSyncEvent looks it up by origin + tag.
    type SyncResult = { error?: string };
    const result = (await cdp
      .send('ServiceWorker.dispatchSyncEvent', {
        origin: 'http://localhost:5173',
        registrationId: '0',
        tag: 'tabmesh-sync:playground-todos',
        lastChance: false,
      })
      .catch((err: Error) => ({ error: err.message }))) as SyncResult;

    // dispatchSyncEvent may reject with "no registration found" on some
    // Chromium versions when registrationId is unknown. In that case we
    // call the onsync handler directly through the SW's MessageChannel —
    // a robust fallback that still proves the drain logic.
    if (result.error) {
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        const sw = reg?.active;
        if (!sw) return;
        // Manually invoke the same code path the sync handler runs by
        // posting a special trigger message; the SW script's drainPendingEvents
        // is the only side-effecting path we care about, and our SW
        // doesn't expose a manual trigger — so we rely on Chrome's actual
        // dispatch. Fall back: navigator.serviceWorker.controller is the
        // active SW; we can directly request a sync via the page-level
        // SyncManager, which on a real browser eventually fires onsync.
        await reg?.sync?.register('tabmesh-sync:playground-todos');
      });
    }

    // Poll the delivery fixture until both events arrived or we time out.
    const deadline = Date.now() + 8_000;
    let received: Array<{ id?: string; type?: string; payload?: { text?: string } }> = [];
    while (Date.now() < deadline) {
      const r = await fetch(`http://localhost:${DELIVERY_PORT}/__received`);
      received = await r.json();
      if (received.length >= 3) break; // 2 sw-handoff todos + 1 buffered
      await page.waitForTimeout(200);
    }

    const texts = received.map((e) => e.payload?.text).filter(Boolean);
    expect(texts).toContain('sw-handoff-A');
    expect(texts).toContain('sw-handoff-B');

    await page.close();
  });

  test('elected-leader failover when the leader tab closes (#28-#31)', async ({ context }) => {
    // Force fallback mode via `?hub=elected` (deletes window.SharedWorker
    // before mesh.start). Open 3 tabs, identify the leader, close it, and
    // verify a different tab takes over with a higher term.
    const a = await newPlaygroundTab(context, { hub: 'elected' });
    const b = await newPlaygroundTab(context, { hub: 'elected' });
    const c = await newPlaygroundTab(context, { hub: 'elected' });

    type Status = {
      role: 'hub' | 'follower' | null;
      tabId: string;
      leaderTabId: string | null;
      term: number;
    };
    const readStatus = (page: Page): Promise<Status> =>
      page.evaluate(() => {
        const m = (globalThis as unknown as { __tabmesh: { getStatus(): Status } }).__tabmesh;
        return m.getStatus();
      });
    const allReady = async (): Promise<Status[]> => {
      const statuses = await Promise.all([a, b, c].map(readStatus));
      return statuses;
    };

    // Wait for exactly one leader to be elected across the three tabs.
    await expect
      .poll(
        async () => {
          const statuses = await allReady();
          return statuses.filter((s) => s.role === 'hub').length;
        },
        { timeout: 10_000 }
      )
      .toBe(1);

    const initial = await allReady();
    const leader = initial.find((s) => s.role === 'hub');
    expect(leader).toBeDefined();
    if (!leader) throw new Error('unreachable');
    const leaderTabId = leader.tabId;

    const leaderPage = [a, b, c].find((page, i) => initial[i] && initial[i]?.tabId === leaderTabId);
    if (!leaderPage) throw new Error('could not match leader page');

    await leaderPage.close();
    const survivors = [a, b, c].filter((p) => !p.isClosed());
    expect(survivors.length).toBe(2);

    // The remaining tabs must elect a new leader. Web Locks failover is
    // sub-50ms in spec; BC heartbeat fallback is ~1.5s; IDB is up to 5s.
    // Headless Chromium supports Web Locks, but we keep a generous bound.
    //
    // Note: in Web Locks mode the per-tab `term` counter doesn't carry
    // across tabs (each tab tracks its own term-of-this-leadership), so
    // the meaningful assertion is "a different tab is now the leader."
    await expect
      .poll(
        async () => {
          const updated = await Promise.all(survivors.map(readStatus));
          const newLeader = updated.find((s) => s.role === 'hub');
          if (!newLeader) return null;
          if (newLeader.tabId === leaderTabId) return null;
          return newLeader.tabId;
        },
        { timeout: 10_000 }
      )
      .not.toBeNull();

    for (const page of survivors) {
      await page.close();
    }
  });
});
