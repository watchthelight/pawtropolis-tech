/**
 * Minimal toast notification store.
 * Reactive Svelte 5 state — import { toasts, addToast, dismissToast } from this module.
 */

type ToastType = "success" | "error" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

let _toasts = $state<Toast[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function getToasts(): Toast[] {
  return _toasts;
}

let nextId = 0;

export function addToast(message: string, type: ToastType = "info", durationMs = 3000): string {
  const id = `toast-${++nextId}`;
  _toasts = [..._toasts, { id, message, type }];

  if (durationMs > 0) {
    const timer = setTimeout(() => dismissToast(id), durationMs);
    timers.set(id, timer);
  }

  return id;
}

export function dismissToast(id: string): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  _toasts = _toasts.filter((t) => t.id !== id);
}
