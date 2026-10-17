export type ToastKind = 'success' | 'error' | 'info' | 'loading';

export type ToastPayload = {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  /** 0 stays up until a later update or a tap. */
  duration: number;
};

type Listener = (toast: ToastPayload) => void;

const listeners = new Set<Listener>();
let seq = 0;

const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 2400,
  info: 2800,
  error: 3800,
  loading: 0,
};

function emit(toast: ToastPayload) {
  listeners.forEach((fn) => fn(toast));
}

export function showToast(
  kind: ToastKind,
  title: string,
  message?: string,
  duration?: number,
) {
  const toast: ToastPayload = {
    id: ++seq,
    kind,
    title,
    message: message?.trim() ? message : undefined,
    duration: duration ?? DEFAULT_DURATION[kind],
  };
  emit(toast);
  return toast.id;
}

/** Replace a toast in place. A loading toast uses this to become success or error. */
export function updateToast(
  id: number,
  kind: ToastKind,
  title: string,
  message?: string,
  duration?: number,
) {
  emit({
    id,
    kind,
    title,
    message: message?.trim() ? message : undefined,
    duration: duration ?? DEFAULT_DURATION[kind],
  });
}

export const toast = {
  success: (title: string, message?: string) => showToast('success', title, message),
  error: (title: string, message?: string) => showToast('error', title, message),
  info: (title: string, message?: string) => showToast('info', title, message),
  /** Stays visible until `update`. Returns the id to update. */
  loading: (title: string, message?: string) => showToast('loading', title, message, 0),
  update: updateToast,
};

export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
