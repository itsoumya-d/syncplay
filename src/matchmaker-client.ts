// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com | +91 7031648617

export class MatchmakerClient {
  constructor(private url: string) {}

  async createRoom(): Promise<string> {
    const res = await fetch(`${this.url}/api/rooms`, { method: 'POST' });
    const data = await res.json();
    return data.roomId;
  }
}
