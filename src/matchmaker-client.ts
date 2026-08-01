// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com

/** Default budget for the room-creation HTTP call. */
export const DEFAULT_MATCHMAKER_TIMEOUT_MS = 10000;

export class MatchmakerClient {
  constructor(
    private url: string,
    private timeoutMs: number = DEFAULT_MATCHMAKER_TIMEOUT_MS
  ) {}

  async createRoom(): Promise<string> {
    // The matchmaker URL is documented as wss://… for the signalling socket, but
    // fetch() cannot speak ws/wss. Normalise so a documented URL still works.
    const httpUrl = this.url.replace(/^ws(s?):\/\//, 'http$1://');

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

    let res: Response;
    try {
      res = await fetch(`${httpUrl}/api/rooms`, {
        method: 'POST',
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === 'AbortError') {
        throw new Error(`SyncPlay: matchmaker at ${httpUrl} did not respond within ${this.timeoutMs}ms`);
      }
      throw new Error(`SyncPlay: matchmaker at ${httpUrl} is unreachable — ${e.message}`);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }

    // Previously unchecked: a 4xx/5xx HTML error page reached res.json() and
    // surfaced as an opaque JSON syntax error.
    if (!res.ok) {
      throw new Error(
        `SyncPlay: matchmaker returned HTTP ${res.status} ${res.statusText} for POST ${httpUrl}/api/rooms`
      );
    }

    let data: any;
    try {
      data = await res.json();
    } catch (err) {
      throw new Error(`SyncPlay: matchmaker response was not JSON — ${(err as Error).message}`);
    }

    // Previously unchecked: a 200 with no roomId returned undefined, which then
    // produced a signalling URL containing the literal string "undefined".
    if (data === null || typeof data !== 'object' ||
        typeof data.roomId !== 'string' || data.roomId.length === 0) {
      throw new Error(
        `SyncPlay: matchmaker response is missing a non-empty string "roomId" (got ${JSON.stringify(data)})`
      );
    }
    return data.roomId;
  }
}
