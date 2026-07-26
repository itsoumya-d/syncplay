import { EventEmitter } from './events';

export class Room extends EventEmitter {
  constructor(public id: string) {
    super();
  }
}
