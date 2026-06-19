import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
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
}

/**
 * Fully uncontrolled TextInput wrapper.
 *
 * Does NOT pass `value` or `defaultValue` to the native TextInput, so Fabric
 * never reconciles the native view during parent re-renders — eliminating
 * the "keyboard closes on tap" bug in RN 0.85+ / New Architecture.
 *
 * Text management:
 *   - On mount, `setNativeProps({ text })` sets the initial text before paint.
 *   - During typing, the native TextInput manages its own text. `onChangeText`
 *     propagates changes to the parent for form state, but the native view is
 *     never touched by React.
 *   - On blur, native text is synced back to the controlled value.
 *   - On external value changes (form reset), `setNativeProps` updates the
 *     native view directly, but ONLY when NOT focused.
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
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const isFocusedRef = useRef(false);
  const onChangeTextRef = useRef(onChangeText);
  const latestValueRef = useRef(value);
  const isInitialRender = useRef(true);

  // Keep callback ref current (handler identity changes don't affect native text)
  useEffect(() => {
    onChangeTextRef.current = onChangeText;
  }, [onChangeText]);

  // Track latest controlled value for blur-sync
  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  // Set initial text before paint via setNativeProps (no defaultValue prop to trip Fabric)
  useLayoutEffect(() => {
    if (inputRef.current) {
      inputRef.current.setNativeProps({ text: value });
    }
    isInitialRender.current = false;
  }, []);

  // Sync parent value to native input when NOT focused (form reset, prefill)
  useEffect(() => {
    if (isInitialRender.current) return; // skip — handled by mount effect
    if (inputRef.current && !isFocusedRef.current) {
      inputRef.current.setNativeProps({ text: value });
    }
  }, [value]);

  const handleChangeText = (text: string) => {
    latestValueRef.current = text;
    onChangeTextRef.current(text);
  };

  const handleFocus = () => {
    isFocusedRef.current = true;
    setIsFocused(true);
  };

  const handleBlur = () => {
    isFocusedRef.current = false;
    setIsFocused(false);
    // Ensure native text matches the controlled value on blur
    if (inputRef.current) {
      inputRef.current.setNativeProps({ text: latestValueRef.current });
    }
  };

  return (
    <View style={[styles.container, style as any]} collapsable={false}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View
        style={[
          styles.inputContainer,
          isFocused ? styles.inputFocused : undefined,
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
          style={[
            styles.input,
            multiline ? styles.multiline : undefined,
            icon ? { marginLeft: spacing.sm } : undefined,
          ].filter(Boolean) as any}
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
  inputFocused: {
    borderColor: colors.inputFocusBorder,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
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
