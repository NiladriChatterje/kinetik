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

  return { showError, showSuccess, showInfo };
}
