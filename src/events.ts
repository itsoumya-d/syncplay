// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com | +91 7031648617

export type EventCallback = (...args: any[]) => void;

export class EventEmitter {
  private listeners: Map<string, Set<EventCallback>> = new Map();

  on(event: string, cb: EventCallback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(cb);
  }

  emit(event: string, ...args: any[]) {
    this.listeners.get(event)?.forEach(cb => cb(...args));
  }
}
