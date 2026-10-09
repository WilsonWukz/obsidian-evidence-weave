/* Pure presentation geometry; renderer physics remain entirely native. */
'use strict';
function safePositive(v, fallback) { return Number.isFinite(v) && v > 0 ? v : fallback; }
function graphScaleFactor(renderer, baseScale) {
  return safePositive(renderer?.scale, 1) / safePositive(baseScale, 1);
}
function worldToScreen(point, camera) {
  if (!point || !camera) return null;
  const dpr = safePositive(camera.dpr, 1);
  const scale = safePositive(camera.scale, 1);
  return { x:(point.x * scale + camera.panX)/dpr, y:(point.y * scale + camera.panY)/dpr };
}
function screenToWorld(point, camera) {
  if (!point || !camera) return null;
  const dpr = safePositive(camera.dpr, 1);
  const scale = safePositive(camera.scale, 1);
  return { x:(point.x * dpr - camera.panX)/scale, y:(point.y * dpr - camera.panY)/scale };
}
function pdfOriginForNode(point, viewport, desiredWidth=495, desiredHeight=810, padding=12) {
  if (!point || !viewport || viewport.width<220 || viewport.height<180) return null;
  const width = Math.max(300, desiredWidth), height = Math.max(320, desiredHeight), gap=28;
  const roomRight = viewport.width-point.x-gap-padding;
  const roomLeft = point.x-gap-padding;
  const side = roomRight >= width || roomRight >= roomLeft ? 'right' : 'left';
  // Only INITIAL placement is kept on screen when possible. The PDF remains a
  // world-space object thereafter: we never shrink or re-side-switch it on zoom.
  const idealX = side==='right' ? point.x+gap : point.x-gap-width;
  const x = Math.max(padding,Math.min(Math.max(padding,viewport.width-width-padding),idealX));
  const idealY = point.y-50;
  const y = Math.max(padding,Math.min(Math.max(padding,viewport.height-height-padding),idealY));
  return {x,y,width,height,side};
}
// Backwards-compatible alias for geometric contract tests, not used to keep
// resizing the panel after its initial placement.
const placePdfByNode=pdfOriginForNode;
function readableEdgeAngle(dx,dy) {
  let a=Math.atan2(dy,dx);
  if(a>Math.PI/2)a-=Math.PI;
  if(a< -Math.PI/2)a+=Math.PI;
  return a;
}
function labelPosition(a,b,ratio=.52) {
  if(!a||!b)return null;
  return {x:a.x+(b.x-a.x)*ratio,y:a.y+(b.y-a.y)*ratio,
    angle:readableEdgeAngle(b.x-a.x,b.y-a.y),length:Math.hypot(b.x-a.x,b.y-a.y)};
}
function rotatedRect(point,width,height,angle) {
  const c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
  const halfW=(width*c+height*s)/2,halfH=(width*s+height*c)/2;
  return {left:point.x-halfW,right:point.x+halfW,top:point.y-halfH,bottom:point.y+halfH};
}
function rectsIntersect(a,b,padding=6) {
  return a.left<b.right+padding && a.right>b.left-padding && a.top<b.bottom+padding && a.bottom>b.top-padding;
}
function avoidLabelCollisions(items,popupRect=null){
  // Items are in priority order (e.g. strongest reviewed relation first).
  // Moving labels ALONG real graph edges is less disruptive than a separate UI.
  const placed=[];
  for(const item of items){
    const {a,b,width,height,zoom=1}=item;
    if(!a||!b||!Number.isFinite(a.x)||!Number.isFinite(b.x))continue;
    const len=Math.hypot(b.x-a.x,b.y-a.y);
    const span=Math.max(0,len-2*17);
    const scaledWidth=width*zoom,scaledHeight=height*zoom;
    if(span<Math.min(scaledWidth+8,24))continue;
    for(const t of [.52,.38,.65,.28,.75]){
      const p=labelPosition(a,b,t);
      if(Math.min(t,1-t)*len<Math.min(scaledWidth*.46+12,span*.5+1))continue;
      const rect=rotatedRect(p,scaledWidth,scaledHeight,p.angle);
      if(popupRect&&rectsIntersect(rect,popupRect,4))continue;
      if(placed.some(q=>rectsIntersect(q.rect,rect,7)))continue;
      placed.push({id:item.id, ...p,rect});
      break;
    }
  }
  return placed;
}
function resizedWorldPanel(original,drag,camera,zoom){
  const factor=safePositive(zoom,1);
  const dx=(drag.x||0)/factor,dy=(drag.y||0)/factor;
  const sx=drag.corner.includes('w')?-1:1,sy=drag.corner.includes('n')?-1:1;
  const newWidth=Math.max(320,Math.min(1800,original.width+sx*dx));
  const newHeight=Math.max(360,Math.min(2200,original.height+sy*dy));
  // Changes to the LEFT/TOP corner move the world-space origin; right/bottom
  // corner changes leave it anchored. Clamp correctly even beyond min/max.
  const xShift=drag.corner.includes('w')? original.width-newWidth:0;
  const yShift=drag.corner.includes('n')? original.height-newHeight:0;
  const worldScale=safePositive(camera?.dpr,1)/safePositive(camera?.scale,1);
  return {width:newWidth,height:newHeight,
    x:original.x + xShift*factor*worldScale,
    y:original.y + yShift*factor*worldScale};
}
/** Translate the PDF in the native graph's WORLD coordinates. Pointer deltas
 * are CSS pixels, so use the inverse native camera transform, not CSS `left`.
 * Width and height remain unchanged and zoom/pan still affect the whole PDF. */
function movedWorldPanel(original, drag, camera) {
  const ratio=safePositive(camera?.dpr,1)/safePositive(camera?.scale,1);
  return {x:original.x+(drag.x||0)*ratio,
    y:original.y+(drag.y||0)*ratio,
    width:original.width,height:original.height};
}
