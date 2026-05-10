# What is TabMesh?

TabMesh is a frontend event mesh — a small library that multiplexes a single backend transport (WebSocket today, SSE / long-poll later) across every browser tab of the same origin, persists outbound events to IndexedDB, and broadcasts events across tabs in real time.

It is **hub-and-spoke**, not peer-to-peer. The hub is a `SharedWorker` (primary) or an elected leader tab (fallback). Every tab is a spoke; the hub holds the transport and the durable outbox.

## What problem it solves

Open the same web app in three tabs and you'll typically see:

- Three independent WebSockets to the same backend, tripling connection count and idle CPU.
- Three copies of the same push notification.
- Three concurrent reconnect storms when the network blips.
- Cross-tab UI state that drifts because tabs don't talk to each other.
- Lost events when a tab closes mid-send.

TabMesh collapses this into one transport, one outbox, and a documented event protocol between tabs.

## What it isn't

- **Not a state management library.** It moves events; you decide how to update state. (Tip: pair it with whatever you already use — Redux, Zustand, signals, plain `useReducer`.)
- **Not a full PubSub broker.** No history, no replay buffer for late-joining tabs. New tabs fetch state from your backend, not from TabMesh.
- **Not cross-origin.** It coordinates tabs within the same origin only. Same-protocol, same-host, same-port.
- **Not a Node library.** Browser-side only.

## When to reach for it

You probably want TabMesh if:

- Your app has long-lived backend connections (chat, presence, dashboards, collaborative tools).
- Users routinely have multiple tabs open.
- You've noticed connection multiplication, duplicate notifications, or cross-tab inconsistency.

You probably don't need it if:

- Your app is a single-tab session per user.
- Your backend connections are short request/response, not push.
- You don't have cross-tab interactions worth coordinating.

## What's next

→ [Getting started](./getting-started)
→ [Architecture](./architecture)
→ [Gotchas](./gotchas) — read this before adopting in production
