// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com | +91 7031648617

import { EventEmitter } from './events';

export class NetworkManager extends EventEmitter {
  connect(roomId: string, playerId: string) {}
  broadcastUnreliable(data: any) {}
  broadcastReliable(data: any) {}
}
