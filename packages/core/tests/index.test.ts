import { describe, expect, it } from 'vitest';
import { version } from '../src/index';

describe('TabMesh Core', () => {
  it('should export version', () => {
    expect(version).toBe('0.0.1');
  });
});
