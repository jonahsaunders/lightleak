// One projection for capture, the drawn viewfinder and printed thumbnails.
const tangent = degrees => Math.tan(degrees * Math.PI / 360);
export function gameViewport(width, height) {
  return { w: width, h: Math.min(height, width * 3 / 4) };
}
export function captureAngles(logicFov, fraction = 1) {
  const t = tangent(logicFov);
  return { tx: 0.96 * fraction * t, ty: 0.72 * fraction * t };
}
export function capturePixels(displayFov, logicFov, viewport) {
  const { tx, ty } = captureAngles(logicFov);
  const h = viewport.h * ty / tangent(displayFov);
  const w = viewport.h * tx / tangent(displayFov);
  return { w, h, x: (viewport.w - w) / 2, y: (viewport.h - h) / 2 };
}
