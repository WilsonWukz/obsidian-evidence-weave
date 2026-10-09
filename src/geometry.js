/* Pure geometry for inline native graph annotations. */
'use strict';
function placePdfByNode(point, viewport, desiredWidth = 330, desiredHeight = 460, padding = 12) {
  const w = Math.max(0, viewport.width || 0), h = Math.max(0, viewport.height || 0);
  if (w < 300 || h < 170 || !point) return null;
  const width = Math.min(desiredWidth, Math.max(235, w - 2 * padding));
  const height = Math.min(desiredHeight, Math.max(145, h - 2 * padding));
  const gap = 28;
  const rightRoom = w - point.x - gap - padding;
  const leftRoom = point.x - gap - padding;
  const preferred = rightRoom >= width || rightRoom >= leftRoom ? 'right' : 'left';
  const x = preferred === 'right' ? point.x + gap : point.x - gap - width;
  return {
    side: preferred,
    x: Math.max(padding, Math.min(w - width - padding, x)),
    y: Math.max(padding, Math.min(h - height - padding, point.y - 42)),
    width, height,
  };
}
function readableEdgeAngle(dx,dy) {
  let angle = Math.atan2(dy,dx);
  if (angle > Math.PI/2) angle -= Math.PI;
  if (angle < -Math.PI/2) angle += Math.PI;
  return angle;
}
function labelPosition(a,b,ratio=0.52) {
  if (!a || !b) return null;
  return {x:a.x+(b.x-a.x)*ratio,y:a.y+(b.y-a.y)*ratio,
    angle:readableEdgeAngle(b.x-a.x,b.y-a.y),
    length:Math.hypot(b.x-a.x,b.y-a.y)};
}
