/**
 * Custom error class for TabMesh programmer mistakes.
 *
 * Thrown synchronously for invalid usage: calling methods after `stop()`,
 * invalid config, etc. Runtime conditions (transport errors, disconnections)
 * are emitted as system events, not thrown.
 */
export class TabMeshError extends Error {
  /** Machine-readable error code. */
  readonly code: string;
  /** Additional context about the error. */
  readonly details: Record<string, unknown>;

  constructor(message: string, code: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'TabMeshError';
    this.code = code;
    this.details = details;
  }
}

/** Error codes used by TabMeshError. */
export const ErrorCode = {
  NOT_STARTED: 'NOT_STARTED',
  ALREADY_STARTED: 'ALREADY_STARTED',
  ALREADY_STOPPED: 'ALREADY_STOPPED',
  INVALID_CONFIG: 'INVALID_CONFIG',
  PROTOCOL_MISMATCH: 'PROTOCOL_MISMATCH',
  HUB_UNREACHABLE: 'HUB_UNREACHABLE',
  OUTBOX_FULL: 'OUTBOX_FULL',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];
