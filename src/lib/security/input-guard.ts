/**
 * Structural validation for request bodies.
 *
 * A JSON body reaches the database layer through parameterised SQL, so the
 * classic SQL-injection vector is already closed. What remains is everything a
 * *parser* and the surrounding JavaScript will do with the value before it gets
 * there:
 *
 *  - `__proto__`, `constructor` and `prototype` keys, which turn an ordinary
 *    object into a prototype-pollution gadget if any code ever merges it;
 *  - unbounded depth, array length, key count or string length, which let a
 *    single request exhaust memory or stack;
 *  - raw control characters in strings, which can smuggle a newline into a log
 *    line or a header.
 *
 * This module is pure and dependency-free so it can be unit tested in isolation.
 * It fails closed: a body that exceeds a bound or carries a poisoned key is
 * rejected with a code, never silently truncated.
 */

export class InputValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface InputLimits {
  maxDepth: number;
  maxArrayLength: number;
  maxKeys: number;
  maxStringLength: number;
  maxNodes: number;
}

/**
 * Defaults sized for the largest legitimate body (a KYC submission carries a
 * few base64 images) while still bounding a hostile one.
 */
export const DEFAULT_INPUT_LIMITS: InputLimits = {
  maxDepth: 12,
  maxArrayLength: 50_000,
  maxKeys: 2_000,
  maxStringLength: 16_000_000,
  maxNodes: 200_000,
};

/** Keys that must never appear in a parsed body. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Control characters allowed inside a JSON string: tab, newline, carriage return. */
function hasIllegalControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true;
  }
  return false;
}

/**
 * Validate a parsed JSON value against the limits.
 *
 * Throws `InputValidationError` on the first violation. `limits` may be a
 * partial override; missing fields fall back to the defaults.
 */
export function validateJsonInput(value: unknown, overrides: Partial<InputLimits> = {}): void {
  const limits: InputLimits = { ...DEFAULT_INPUT_LIMITS, ...overrides };
  let nodes = 0;

  const walk = (node: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > limits.maxNodes) {
      throw new InputValidationError('INPUT_TOO_LARGE', 'The request body has too many values');
    }
    if (depth > limits.maxDepth) {
      throw new InputValidationError('INPUT_TOO_DEEP', 'The request body is nested too deeply');
    }

    if (node === null || node === undefined) return;
    const type = typeof node;
    if (type === 'boolean' || type === 'number') {
      if (type === 'number' && !Number.isFinite(node as number)) {
        throw new InputValidationError('INPUT_INVALID_NUMBER', 'The request body contains a non-finite number');
      }
      return;
    }
    if (type === 'string') {
      const text = node as string;
      if (text.length > limits.maxStringLength) {
        throw new InputValidationError('INPUT_STRING_TOO_LONG', 'A value in the request body is too long');
      }
      if (hasIllegalControlChar(text)) {
        throw new InputValidationError('INPUT_CONTROL_CHAR', 'A value in the request body contains a control character');
      }
      return;
    }
    if (type === 'function' || type === 'symbol' || type === 'bigint') {
      throw new InputValidationError('INPUT_INVALID_TYPE', 'The request body contains an unsupported value');
    }

    if (Array.isArray(node)) {
      if (node.length > limits.maxArrayLength) {
        throw new InputValidationError('INPUT_ARRAY_TOO_LONG', 'A list in the request body is too long');
      }
      for (const item of node) walk(item, depth + 1);
      return;
    }

    // A plain object. Reject a poisoned key before recursing into its value so a
    // gadget cannot be smuggled in even if some later code merges this object.
    const record = node as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length > limits.maxKeys) {
      throw new InputValidationError('INPUT_TOO_MANY_KEYS', 'The request body has too many fields');
    }
    for (const key of keys) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new InputValidationError('INPUT_FORBIDDEN_KEY', 'The request body contains a forbidden field name');
      }
      walk(record[key], depth + 1);
    }
  };

  walk(value, 0);
}

/** Whether a parsed value passes validation (convenience, non-throwing). */
export function isJsonInputValid(value: unknown, overrides: Partial<InputLimits> = {}): boolean {
  try {
    validateJsonInput(value, overrides);
    return true;
  } catch {
    return false;
  }
}
