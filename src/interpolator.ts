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
