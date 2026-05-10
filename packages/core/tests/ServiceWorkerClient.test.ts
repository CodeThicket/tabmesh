import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceWorkerClient } from '../src/service-worker/ServiceWorkerClient';

describe('ServiceWorkerClient', () => {
  let originalNavigator: PropertyDescriptor | undefined;
  let mockRegistration: {
    active: { postMessage: ReturnType<typeof vi.fn> } | null;
    unregister: ReturnType<typeof vi.fn>;
    sync?: { register: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    mockRegistration = {
      active: { postMessage: vi.fn() },
      unregister: vi.fn(async () => true),
      sync: { register: vi.fn(async () => {}) },
    };

    originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          register: vi.fn(async () => mockRegistration),
          ready: Promise.resolve(mockRegistration),
        },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    }
    vi.restoreAllMocks();
  });

  it('does not register when enabled is false', async () => {
    const client = new ServiceWorkerClient('test-app', { enabled: false });
    const result = await client.register();
    expect(result).toBe(false);
  });

  it('registers the service worker when enabled', async () => {
    const client = new ServiceWorkerClient('test-app', {
      enabled: true,
      scriptUrl: '/my-sw.js',
    });

    const result = await client.register();
    expect(result).toBe(true);
    expect(navigator.serviceWorker.register).toHaveBeenCalledWith('/my-sw.js', { scope: '/' });
  });

  it('sends configuration to the service worker', async () => {
    const client = new ServiceWorkerClient('test-app', { enabled: true });

    await client.register();

    expect(mockRegistration.active?.postMessage).toHaveBeenCalledWith({
      kind: 'tabmesh-sw-config',
      config: {
        channelName: 'test-app',
        dbName: 'tabmesh:test-app',
        deliveryUrl: undefined,
      },
    });
  });

  it('forwards deliveryUrl to the service worker config', async () => {
    const client = new ServiceWorkerClient('test-app', {
      enabled: true,
      deliveryUrl: 'https://api.example.com/events',
    });

    await client.register();

    expect(mockRegistration.active?.postMessage).toHaveBeenCalledWith({
      kind: 'tabmesh-sw-config',
      config: {
        channelName: 'test-app',
        dbName: 'tabmesh:test-app',
        deliveryUrl: 'https://api.example.com/events',
      },
    });
  });

  it('requests background sync', async () => {
    const client = new ServiceWorkerClient('test-app', { enabled: true });
    await client.register();

    const result = await client.requestSync();
    expect(result).toBe(true);
    expect(mockRegistration.sync?.register).toHaveBeenCalledWith('tabmesh-sync:test-app');
  });

  it('returns false for requestSync when not registered', async () => {
    const client = new ServiceWorkerClient('test-app', { enabled: true });
    const result = await client.requestSync();
    expect(result).toBe(false);
  });

  it('unregisters the service worker', async () => {
    const client = new ServiceWorkerClient('test-app', { enabled: true });
    await client.register();

    const result = await client.unregister();
    expect(result).toBe(true);
    expect(mockRegistration.unregister).toHaveBeenCalled();
  });

  it('uses default scriptUrl when not specified', async () => {
    const client = new ServiceWorkerClient('test-app', { enabled: true });
    await client.register();
    expect(navigator.serviceWorker.register).toHaveBeenCalledWith('/tabmesh-sw.js', { scope: '/' });
  });

  it('returns false when Service Worker API is unavailable', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      writable: true,
      configurable: true,
    });

    const client = new ServiceWorkerClient('test-app', { enabled: true });
    const result = await client.register();
    expect(result).toBe(false);
  });
});
