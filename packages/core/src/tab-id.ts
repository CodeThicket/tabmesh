/**
 * Tab ID generation and storage.
 *
 * 8 hex characters from `crypto.getRandomValues()`, stored in `sessionStorage`.
 * Survives page reloads (same tab session), regenerated on new tab.
 */

const SESSION_KEY_PREFIX = 'tabmesh:tabId:';

/** Generate a random 8-character hex string. */
function generateId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Get or create a stable tab ID scoped to the channel name.
 * Stored in sessionStorage so it survives reloads but not tab close.
 */
export function getTabId(channelName: string): string {
  const key = `${SESSION_KEY_PREFIX}${channelName}`;

  try {
    const existing = sessionStorage.getItem(key);
    if (existing) {
      return existing;
    }
  } catch {
    // sessionStorage unavailable - generate a volatile ID
  }

  const id = generateId();

  try {
    sessionStorage.setItem(key, id);
  } catch {
    // sessionStorage unavailable - ID won't survive reloads
  }

  return id;
}

/**
 * Monotonic counter for generating event IDs within a tab.
 * Format: `{tabId}-{counter}`
 */
export class EventIdGenerator {
  private counter = 0;

  constructor(private readonly tabId: string) {}

  next(): string {
    return `${this.tabId}-${++this.counter}`;
  }
}
