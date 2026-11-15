import type { Connect } from 'vite';

/** Handles /api/picks and passes every other request on. `file` defaults to data/runtime/picks.json. */
export function picksMiddleware(options?: { file?: string }): Connect.NextHandleFunction;
export function validateRecord(record: unknown): object | string;
