import { describe, expect, it } from 'vitest';
import { ErrorCode, TabMeshError } from '../src/errors';

describe('TabMeshError', () => {
  it('should create an error with message, code, and details', () => {
    const err = new TabMeshError('Something failed', 'TEST_CODE', { key: 'value' });
    expect(err.message).toBe('Something failed');
    expect(err.code).toBe('TEST_CODE');
    expect(err.details).toEqual({ key: 'value' });
  });

  it('should have name TabMeshError', () => {
    const err = new TabMeshError('test', 'CODE');
    expect(err.name).toBe('TabMeshError');
  });

  it('should extend Error', () => {
    const err = new TabMeshError('test', 'CODE');
    expect(err).toBeInstanceOf(Error);
  });

  it('should default details to empty object', () => {
    const err = new TabMeshError('test', 'CODE');
    expect(err.details).toEqual({});
  });

  it('should have a stack trace', () => {
    const err = new TabMeshError('test', 'CODE');
    expect(err.stack).toBeDefined();
  });
});

describe('ErrorCode', () => {
  it('should contain all expected error codes', () => {
    expect(ErrorCode.NOT_STARTED).toBe('NOT_STARTED');
    expect(ErrorCode.ALREADY_STARTED).toBe('ALREADY_STARTED');
    expect(ErrorCode.ALREADY_STOPPED).toBe('ALREADY_STOPPED');
    expect(ErrorCode.INVALID_CONFIG).toBe('INVALID_CONFIG');
    expect(ErrorCode.PROTOCOL_MISMATCH).toBe('PROTOCOL_MISMATCH');
    expect(ErrorCode.HUB_UNREACHABLE).toBe('HUB_UNREACHABLE');
    expect(ErrorCode.OUTBOX_FULL).toBe('OUTBOX_FULL');
    expect(ErrorCode.STORAGE_UNAVAILABLE).toBe('STORAGE_UNAVAILABLE');
  });
});
