// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com

export * from './syncplay';
export * from './types';

// Previously missing from the public surface even though README.md, llms.txt and
// llms-full.txt all documented them. `import { Interpolator } from 'syncplay'`
// resolved to undefined and every published example threw a TypeError.
export * from './interpolator';
export * from './state-manager';
export * from './room';
export * from './events';
export { NetworkManager, SyncPlayNetworkError } from './network-manager';
export { MatchmakerClient } from './matchmaker-client';
