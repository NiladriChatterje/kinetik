import { useCallback } from 'react';
import Toast, { type ToastShowParams } from 'react-native-toast-message';

/** Ensure text2 is never undefined to avoid rendering issues in React Native 0.85+ */
function safeParams(title: string, message?: string): ToastShowParams {
  return { text1: title, text2: message ?? '' };
}

export function useToast() {
  const showError = useCallback((title: string, message?: string) => {
    Toast.show({ type: 'error', ...safeParams(title, message) });
  }, []);

  const showSuccess = useCallback((title: string, message?: string) => {
    Toast.show({ type: 'success', ...safeParams(title, message) });
  }, []);

  const showInfo = useCallback((title: string, message?: string) => {
    Toast.show({ type: 'info', ...safeParams(title, message) });
  }, []);

  /**
   * Show a glassmorphic black toast that slides in from the bottom.
   * Used for transient feedback like conflict errors (e.g. "Phone already exists!").
   */
  const showGlass = useCallback((title: string, message?: string) => {
    Toast.show({ type: 'glass', ...safeParams(title, message), visibilityTime: 3000 });
  }, []);

  return { showError, showSuccess, showInfo, showGlass };
}
