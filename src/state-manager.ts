// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com | +91 7031648617

import { StatePatch } from './types';
import { EventEmitter } from './events';

export class StateManager extends EventEmitter {
  private state: any = {};
  
  applyPatch(patch: StatePatch) {
    const keys = patch.path.split('/').filter(Boolean);
    if (keys.length === 0) return;
    
    let current = this.state;
    for (let i = 0; i < keys.length - 1; i++) {
      if (current[keys[i]] === undefined) current[keys[i]] = {};
      current = current[keys[i]];
    }
    const lastKey = keys[keys.length - 1];
    
    if (patch.op === 'replace' || patch.op === 'add') {
      current[lastKey] = patch.value;
    } else if (patch.op === 'remove') {
      delete current[lastKey];
    }
    this.emit('state_changed', this.state);
  }

  setState(path: string, value: any) {
    const patch: StatePatch = { op: 'replace', path, value };
    this.applyPatch(patch);
    this.emit('patch_generated', patch);
  }

  getState(path?: string): any {
    if (!path) return this.state;
    const keys = path.split('/').filter(Boolean);
    let current = this.state;
    for (const key of keys) {
      if (current === undefined) return undefined;
      current = current[key];
    }
    return current;
  }
}
