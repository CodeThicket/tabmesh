# SharedWorker as the primary Hub implementation

The Hub — the single point that holds the Transport connection and relays events between tabs — is implemented as a SharedWorker. An elected-Leader-tab approach (using Web Locks API / BroadcastChannel / IndexedDB heartbeat) is the fallback for browsers without SharedWorker support.

SharedWorker eliminates three hard distributed-systems problems by construction: leader election (there's one worker instance), split-brain (mutual exclusion is guaranteed by the browser), and the interregnum (the worker lives as long as any tab is connected). Safari re-added SharedWorker support in Safari 16 (September 2022), making it available in all modern browsers.

## Considered Options

- **SharedWorker primary + elected Leader fallback (chosen)**: SharedWorker handles ~95%+ of users. Fallback covers legacy browsers. Two Hub implementations behind a shared interface.
- **Elected Leader only**: Works everywhere without a fallback path. But simulates what SharedWorker provides natively — leader election, split-brain detection, and interregnum handling are complex and have edge cases that SharedWorker avoids entirely.
- **SharedWorker only, no fallback**: Simplest codebase. But drops support for browsers without SharedWorker, which is a binary adoption blocker for teams that need full browser coverage.

## Consequences

- Two Hub implementations to maintain and test, behind a Hub interface abstraction. The interface must be kept tight to avoid divergence.
- Tabs communicate via MessagePort (SharedWorker) or BroadcastChannel (fallback). Code above the Hub interface doesn't need to know which.
- SharedWorker dies when all tabs close. Service Worker handoff handles this — same as the fallback path.
