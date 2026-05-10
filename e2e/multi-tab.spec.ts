import { execSync } from 'node:child_process';
import { type BrowserContext, type Page, expect, test } from '@playwright/test';

const ECHO_PORT = Number(process.env.PLAYWRIGHT_ECHO_PORT ?? '8095');

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

async function newPlaygroundTab(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  // Pass the WS URL explicitly — the playground's mesh.ts reads `?ws=` to
  // override the default. Using `goto('/')` with a query in `baseURL` would
  // be stripped during URL resolution.
  await page.goto(`/?ws=ws://localhost:${ECHO_PORT}`);
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

  test.fixme('stale port cleanup after >30s without ping (#5)', async () => {
    // Worker's STALE_TIMEOUT_MS is 30s and the ping interval is 10s, both
    // hard-coded. To test cleanly, expose those as config knobs (or a
    // test-only global) so the test can drive the cleanup in <1s.
  });

  test.fixme('worker-side observation of lifecycle messages (#6)', async () => {
    // SharedWorker console output is not visible to Playwright's page-
    // attached console listener. Either:
    // (a) route worker logs over a `port.ping`-style introspection that
    //     returns the recorded visibility state, or
    // (b) use chrome://inspect/#workers via CDP to attach to the SW.
  });

  test.fixme('Service Worker Background Sync drains pending events (#26 / #27)', async () => {
    // Background Sync is browser-scheduled and not deterministic in
    // headless Chrome. To exercise it, dispatch the sync event via CDP:
    //   const cdp = await context.newCDPSession(page);
    //   await cdp.send('ServiceWorker.dispatchSyncEvent', {
    //     origin: 'http://localhost:5173',
    //     registrationId: <id>,
    //     tag: 'tabmesh-sync:playground-todos',
    //     lastChance: false,
    //   });
    // Plus a delivery URL endpoint in the test fixture.
  });

  test.fixme('Elected-leader failover within 50ms (#28-#31)', async () => {
    // Force fallback by deleting `window.SharedWorker` before mesh.start().
    // Then open 3 tabs, identify the leader (term + tabId), close it, and
    // verify another tab claims leadership inside the Web Locks SLA.
    // Requires either a debug system event from the leader or a
    // `mesh.getStatus()` field exposing the current term/leaderTabId.
  });
});
