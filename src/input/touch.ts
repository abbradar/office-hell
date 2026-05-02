const pointers = new Map<number, number>();

window.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, e.clientX);
});
window.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e.clientX);
});
const release = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
};
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);

export function touchDirection(): number {
  if (pointers.size === 0) return 0;
  const half = window.innerWidth / 2;
  let dir = 0;
  for (const x of pointers.values()) {
    dir += x < half ? -1 : 1;
  }
  return Math.sign(dir);
}
