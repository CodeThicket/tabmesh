---
layout: home

hero:
  name: TabMesh
  text: One backend connection, every tab.
  tagline: SharedWorker-primary event mesh with elected-leader fallback. Multiplex one WebSocket across all your browser tabs, persist outbound events to IndexedDB, broadcast across tabs in real time.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Try the playground
      link: /playground
    - theme: alt
      text: View on GitHub
      link: https://github.com/CodeThicket/tabmesh

features:
  - icon: 🔌
    title: One WebSocket for N tabs
    details: A SharedWorker holds the transport. Open the same app in 10 tabs and your backend sees one connection.
  - icon: 💾
    title: Durable outbox
    details: Outbound events persist to IndexedDB before delivery. Offline events drain when the network comes back.
  - icon: 🛰️
    title: Cross-tab events
    details: mesh.send in tab A surfaces in tab B as source = 'remote'. No app code wiring needed.
  - icon: 🪪
    title: Logout flow
    details: Clear outbox, drop transport, broadcast logout, stop — in that order, in one library.
  - icon: 🧪
    title: Tested in real browsers
    details: 11 Playwright contracts cover SharedWorker primacy, late-joiner replay, leader failover, SW handoff.
  - icon: 🔬
    title: Pre-1.0, honest about it
    details: The roadmap names what's next, what's considered, and what's explicitly out of scope.
---
