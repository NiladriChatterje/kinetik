import { useCallback } from 'react';
import Toast from 'react-native-toast-message';

export function useToast() {
  const showError = useCallback((title: string, message?: string) => {
    Toast.show({ type: 'error', text1: title, text2: message });
  }, []);

  const showSuccess = useCallback((title: string, message?: string) => {
    Toast.show({ type: 'success', text1: title, text2: message });
  }, []);

  const showInfo = useCallback((title: string, message?: string) => {
    Toast.show({ type: 'info', text1: title, text2: message });
  }, []);

  /**
   * Show a glassmorphic black toast that slides in from the bottom.
   * Used for transient feedback like conflict errors (e.g. "Phone already exists!").
   */
  const showGlass = useCallback((title: string, message?: string) => {
    Toast.show({ type: 'glass', text1: title, text2: message, visibilityTime: 3000 });
  }, []);

  return { showError, showSuccess, showInfo, showGlass };
}
