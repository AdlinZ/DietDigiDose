export function calculateKeyboardInset(viewportHeight: number, keyboardTop: number) {
  if (!Number.isFinite(viewportHeight) || !Number.isFinite(keyboardTop) || viewportHeight <= 0) return 0;
  return Math.max(0, Math.min(viewportHeight, viewportHeight - keyboardTop));
}
