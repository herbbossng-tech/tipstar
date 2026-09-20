/**
 * A Result type used across Tipstar packages instead of throwing for
 * expected/business-logic failures. Reserve thrown exceptions for truly
 * exceptional/programmer-error conditions.
 */
export type Result<T, E = TipstarErrorShape> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface TipstarErrorShape {
  readonly code: string;
  readonly message: string;
}

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E extends TipstarErrorShape>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}

export function unwrap<T, E extends TipstarErrorShape>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw new Error(`Unwrap called on error result: ${result.error.code} - ${result.error.message}`);
}
