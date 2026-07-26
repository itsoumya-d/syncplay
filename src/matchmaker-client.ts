export class MatchmakerClient {
  constructor(private url: string) {}

  async createRoom(): Promise<string> {
    const res = await fetch(`${this.url}/api/rooms`, { method: 'POST' });
    const data = await res.json();
    return data.roomId;
  }
}
