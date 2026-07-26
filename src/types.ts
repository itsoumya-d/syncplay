export interface StatePatch {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: any;
  from?: string;
}

export interface SyncPlayOptions {
  maxPlayers?: number;
  tickRate?: number;
}
