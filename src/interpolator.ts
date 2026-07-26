// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1661@gmail.com | +91 7031648617

export class Interpolator {
  static lerp(start: number, end: number, t: number): number {
    return start + (end - start) * Math.max(0, Math.min(1, t));
  }

  interpolatePosition(currentPos: {x: number, y: number}, targetPos: {x: number, y: number}, t: number) {
    return {
      x: Interpolator.lerp(currentPos.x, targetPos.x, t),
      y: Interpolator.lerp(currentPos.y, targetPos.y, t)
    };
  }
}
