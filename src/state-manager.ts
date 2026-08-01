// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com

import { StatePatch } from './types';
import { EventEmitter } from './events';

/** JSON-Pointer segments that must never be used as object keys. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** Ops this implementation actually supports. */
const SUPPORTED_OPS = new Set(['add', 'replace', 'remove']);

/**
 * Decode a JSON Pointer segment per RFC 6901: `~1` -> `/`, then `~0` -> `~`.
 * Order matters so that `~01` decodes to `~1` rather than `/`.
 */
function decodeSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

export class StateManager extends EventEmitter {
  private state: any = {};

  /**
   * Split and validate a JSON Pointer path. Returns null when the path is
   * unusable (wrong type, empty, or containing a prototype-polluting segment).
   * Never throws.
   */
  private parsePath(path: unknown): string[] | null {
    if (typeof path !== 'string') return null;
    const keys = path.split('/').filter(Boolean).map(decodeSegment);
    if (keys.length === 0) return null;
    for (const k of keys) {
      if (FORBIDDEN_KEYS.has(k)) return null;
    }
    return keys;
  }

  /**
   * Apply a single patch to the local state tree.
   *
   * Returns true when the patch was applied and false when it was rejected.
   * Rejections are reported via the `patch_rejected` event instead of throwing,
   * so a single bad patch cannot abort the remainder of an inbound batch.
   */
  applyPatch(patch: StatePatch): boolean {
    if (patch === null || typeof patch !== 'object') {
      this.emit('patch_rejected', { patch, reason: 'not-an-object' });
      return false;
    }

    if (!SUPPORTED_OPS.has((patch as any).op)) {
      // 'move' / 'copy' / 'test' appear in the StatePatch type but are not
      // implemented. They used to be silently swallowed while still emitting
      // 'state_changed', which made a no-op look like a successful mutation.
      this.emit('patch_rejected', { patch, reason: `unsupported-op:${String((patch as any).op)}` });
      return false;
    }

    const keys = this.parsePath(patch.path);
    if (!keys) {
      this.emit('patch_rejected', { patch, reason: 'invalid-or-unsafe-path' });
      return false;
    }

    let current = this.state;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      const next = current[k];
      if (next === undefined || next === null) {
        current[k] = {};
      } else if (typeof next !== 'object') {
        this.emit('patch_rejected', { patch, reason: `path-traverses-non-object-at:${k}` });
        return false;
      }
      current = current[k];
    }

    const lastKey = keys[keys.length - 1];
    if (patch.op === 'replace' || patch.op === 'add') {
      current[lastKey] = patch.value;
    } else {
      delete current[lastKey];
    }
    this.emit('state_changed', this.state);
    return true;
  }

  /** Returns true when the value was stored, false when the path was rejected. */
  setState(path: string, value: any): boolean {
    const patch: StatePatch = { op: 'replace', path, value };
    if (!this.applyPatch(patch)) return false;
    this.emit('patch_generated', patch);
    return true;
  }

  getState(path?: string): any {
    if (!path) return this.state;
    const keys = this.parsePath(path);
    if (!keys) return undefined;
    let current = this.state;
    for (const key of keys) {
      if (current === undefined || current === null) return undefined;
      current = current[key];
    }
    return current;
  }
}
