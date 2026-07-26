import { EventEmitter } from './events';

export class NetworkManager extends EventEmitter {
  connect(roomId: string, playerId: string) {}
  broadcastUnreliable(data: any) {}
  broadcastReliable(data: any) {}
}
