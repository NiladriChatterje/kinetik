import React, { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, radius, spacing } from '../../theme';

interface InputProps {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  error?: string;
  multiline?: boolean;
  numberOfLines?: number;
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  icon?: React.ReactNode;
  style?: ViewStyle;
  editable?: boolean;
  maxLength?: number;
  required?: boolean;
  /** When true, syncs the parent's controlled value to the native input even while focused.
   *  Use for fields where the parent reformats the text (e.g. auto-formatted DOB). */
  syncOnChange?: boolean;
  /** iOS only: Sets the autocorrection and autocomplete type (e.g. 'oneTimeCode' for OTP auto-fill). */
  textContentType?: string;
}

/**
 * Zero-re-render TextInput wrapper.
 *
 * After mount, this component NEVER re-renders due to user interaction. Focus
 * styling is applied directly to the container View via setNativeProps instead
 * of React state. Text is managed via setNativeProps (no value/defaultValue
 * props on the native TextInput). This prevents Fabric from ever reconciling
 * the native TextInput view during typing, eliminating the focus-loss bug
 * on React Native 0.85+ / New Architecture.
 */
export const Input: React.FC<InputProps> = React.memo(({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  error,
  multiline,
  numberOfLines,
  keyboardType,
  autoCapitalize = 'none',
  icon,
  style,
  editable = true,
  maxLength,
  required,
  syncOnChange,
  textContentType,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const containerRef = useRef<View>(null);
  const isFocusedRef = useRef(false);
  const onChangeTextRef = useRef(onChangeText);
  const latestValueRef = useRef(value);
  const valueRef = useRef(value);

  // Keep callback ref current
  useEffect(() => {
    onChangeTextRef.current = onChangeText;
  }, [onChangeText]);

  // Track latest controlled value for blur-sync
  useEffect(() => {
    latestValueRef.current = value;
    valueRef.current = value;
  }, [value]);

  // Set initial text before paint
  useLayoutEffect(() => {
    if (inputRef.current) {
      inputRef.current.setNativeProps({ text: value });
    }
  }, []);

  // Sync parent value to native input when NOT focused (form reset, prefill),
  // or always when syncOnChange is true (for auto-formatted fields like DOB)
  useEffect(() => {
    if (inputRef.current && (!isFocusedRef.current || syncOnChange)) {
      inputRef.current.setNativeProps({ text: value });
    }
  }, [value, syncOnChange]);

  const handleFocus = useCallback(() => {
    isFocusedRef.current = true;
    containerRef.current?.setNativeProps({
      style: {
        borderColor: colors.inputFocusBorder,
        backgroundColor: '#000000',
      },
    });
    inputRef.current?.setNativeProps({
      style: {
        color: '#FFFFFF',
      },
    });
  }, []);

  const handleBlur = useCallback(() => {
    isFocusedRef.current = false;
    containerRef.current?.setNativeProps({
      style: {
        borderColor: colors.inputBorder,
        backgroundColor: colors.inputBg,
      },
    });
    inputRef.current?.setNativeProps({
      style: {
        color: colors.textPrimary,
      },
    });
    // Ensure native text matches controlled value on blur
    // Use the parent's formatted value (not raw input) for fields with syncOnChange
    if (inputRef.current) {
      inputRef.current.setNativeProps({ text: syncOnChange ? valueRef.current : latestValueRef.current });
    }
  }, []);

  const handleChangeText = useCallback((text: string) => {
    latestValueRef.current = text;
    onChangeTextRef.current(text);
  }, []);

  // Memoize style so Fabric never sees a new reference on re-render
  const inputStyle = useMemo(
    () =>
      [styles.input, multiline ? styles.multiline : undefined, icon ? { marginLeft: spacing.sm } : undefined].filter(Boolean) as any,
    [multiline, icon],
  );

  return (
    <View style={[styles.container, style]} collapsable={false}>
      {label && <Text style={styles.label}>{label}{required ? <Text style={styles.required}> *</Text> : null}</Text>}
      <View
        ref={containerRef}
        style={[
          styles.inputContainer,
          error ? styles.inputError : undefined,
          !editable ? styles.inputDisabled : undefined,
        ]}
      >
        {icon && <View style={styles.icon}>{icon}</View>}
        <TextInput
          ref={inputRef}
          onChangeText={handleChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={secureTextEntry && !showPassword}
          multiline={multiline}
          numberOfLines={numberOfLines}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          editable={editable}
          maxLength={maxLength}
          style={inputStyle}
          textContentType={textContentType}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
        {secureTextEntry && (
          <TouchableOpacity
            onPress={() => setShowPassword(!showPassword)}
            style={styles.eyeButton}
          >
            <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
});
Input.displayName = 'Input';

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  required: {
    color: colors.textPrimary,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: spacing.lg,
    minHeight: 50,
  },
  inputError: {
    borderColor: colors.error,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  icon: {
    marginRight: spacing.xs,
  },
  input: {
    flex: 1,
    ...typography.body1,
    color: colors.textPrimary,
    paddingVertical: spacing.md,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  eyeButton: {
    padding: spacing.sm,
  },
  error: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.xs,
  },
});
