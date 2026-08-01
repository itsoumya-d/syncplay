// Copyright (c) 2024-2026 Soumya Debnath. All Rights Reserved.
// Licensed under the Business Source License 1.1 (BSL 1.1).
// See LICENSE file for details. Production use requires a paid license.
// Contact: soumyadebnath1619@gmail.com

export interface Vec2 { x: number; y: number }

export class Interpolator {
  static lerp(start: number, end: number, t: number): number {
    return start + (end - start) * Math.max(0, Math.min(1, t));
  }

  /**
   * Static form. Every published example (README, llms.txt, llms-full.txt) calls
   * `Interpolator.interpolatePosition(...)` without constructing an instance,
   * so the static overload is the documented entry point.
   */
  static interpolatePosition(currentPos: Vec2, targetPos: Vec2, t: number): Vec2 {
    return {
      x: Interpolator.lerp(currentPos.x, targetPos.x, t),
      y: Interpolator.lerp(currentPos.y, targetPos.y, t),
    };
  }

  /** Instance form, kept so existing `new Interpolator()` callers keep working. */
  interpolatePosition(currentPos: Vec2, targetPos: Vec2, t: number): Vec2 {
    return Interpolator.interpolatePosition(currentPos, targetPos, t);
  }
}
