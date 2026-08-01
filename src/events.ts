// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1619@gmail.com

export type EventCallback = (...args: any[]) => void;

export class EventEmitter {
  private listeners: Map<string, Set<EventCallback>> = new Map();

  on(event: string, cb: EventCallback): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(cb);
    return this;
  }

  /** Remove a single listener. Required to unsubscribe a Room on leaveRoom(). */
  off(event: string, cb: EventCallback): this {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(cb);
      if (set.size === 0) this.listeners.delete(event);
    }
    return this;
  }

  /** Remove every listener for one event, or all events when omitted. */
  removeAllListeners(event?: string): this {
    if (event === undefined) this.listeners.clear();
    else this.listeners.delete(event);
    return this;
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  emit(event: string, ...args: any[]): boolean {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return false;
    // Iterate a snapshot so a listener that subscribes/unsubscribes during
    // dispatch cannot mutate the set we are walking.
    for (const cb of Array.from(set)) {
      try {
        cb(...args);
      } catch (err) {
        // One throwing listener must not prevent the remaining listeners from
        // running. Surface it on 'listener_error' when anyone is watching,
        // otherwise fall back to console.error so it is never swallowed.
        if (event !== 'listener_error' && this.listenerCount('listener_error') > 0) {
          this.emit('listener_error', { event, error: err });
        } else if (typeof console !== 'undefined') {
          console.error(`SyncPlay: listener for "${event}" threw:`, err);
        }
      }
    }
    return true;
  }
}
