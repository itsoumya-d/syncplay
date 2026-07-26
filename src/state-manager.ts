import { StatePatch } from './types';
import { EventEmitter } from './events';

export class StateManager extends EventEmitter {
  private state: any = {};

  setState(path: string, value: any) {}

  getState(path?: string): any {
    return this.state;
  }
}
