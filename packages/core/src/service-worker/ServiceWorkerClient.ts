/**
 * Client-side Service Worker coordinator.
 *
 * Registers the TabMesh Service Worker and sets up Background Sync
 * for outbox drain when all tabs close.
 */

import type { ServiceWorkerConfig } from '../types.js';

const SYNC_TAG_PREFIX = 'tabmesh-sync:';

/** Default Service Worker configuration. */
const SW_DEFAULTS: ServiceWorkerConfig = {
  enabled: false,
  scriptUrl: '/tabmesh-sw.js',
};

/**
 * Manages the TabMesh Service Worker lifecycle.
 *
 * @example
 * ```typescript
 * const swClient = new ServiceWorkerClient('my-app', { enabled: true });
 * await swClient.register();
 * // Later, request a sync before the tab closes:
 * await swClient.requestSync();
 * ```
 */
export class ServiceWorkerClient {
  private readonly channelName: string;
  private readonly config: ServiceWorkerConfig;
  private readonly dbName: string;
  private registration: ServiceWorkerRegistration | null = null;

  constructor(channelName: string, config?: Partial<ServiceWorkerConfig>, dbName?: string) {
    this.channelName = channelName;
    this.config = { ...SW_DEFAULTS, ...config };
    this.dbName = dbName ?? `tabmesh:${channelName}`;
  }

  /**
   * Register the Service Worker and send configuration.
   * No-ops if Service Worker API is unavailable or config.enabled is false.
   */
  async register(): Promise<boolean> {
    if (!this.config.enabled) return false;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;

    try {
      this.registration = await navigator.serviceWorker.register(this.config.scriptUrl, {
        scope: '/',
      });

      // Wait for the SW to be ready
      const ready = await navigator.serviceWorker.ready;

      // Send configuration to the SW
      ready.active?.postMessage({
        kind: 'tabmesh-sw-config',
        config: {
          channelName: this.channelName,
          dbName: this.dbName,
        },
      });

      return true;
    } catch {
      // Registration failed — no-op
      return false;
    }
  }

  /**
   * Request a Background Sync to drain pending outbox events.
   * Call this during `beforeunload` or `pagehide` for best-effort cleanup.
   */
  async requestSync(): Promise<boolean> {
    if (!this.registration) return false;

    try {
      // Background Sync API
      const reg = this.registration as ServiceWorkerRegistration & {
        sync?: { register(tag: string): Promise<void> };
      };
      if (reg.sync) {
        await reg.sync.register(`${SYNC_TAG_PREFIX}${this.channelName}`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Unregister the Service Worker.
   */
  async unregister(): Promise<boolean> {
    if (!this.registration) return false;
    try {
      const result = await this.registration.unregister();
      this.registration = null;
      return result;
    } catch {
      return false;
    }
  }
}
