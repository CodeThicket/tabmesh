import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  ServiceWorkerClient,
  TabMesh,
  TabMeshError,
  version,
} from '../src/index';

describe('TabMesh Core exports', () => {
  it('should export version', () => {
    expect(version).toBe('0.0.1');
  });

  it('should export PROTOCOL_VERSION', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('should export TabMesh class', () => {
    expect(TabMesh).toBeDefined();
    expect(typeof TabMesh).toBe('function');
  });

  it('should export ServiceWorkerClient class', () => {
    expect(ServiceWorkerClient).toBeDefined();
    expect(typeof ServiceWorkerClient).toBe('function');
  });

  it('should export TabMeshError class', () => {
    expect(TabMeshError).toBeDefined();
    const err = new TabMeshError('test', 'TEST_CODE', { foo: 'bar' });
    expect(err.message).toBe('test');
    expect(err.code).toBe('TEST_CODE');
    expect(err.details).toEqual({ foo: 'bar' });
    expect(err.name).toBe('TabMeshError');
    expect(err).toBeInstanceOf(Error);
  });
});
