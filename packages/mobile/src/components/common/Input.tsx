import React, { useState, useRef, useEffect } from 'react';
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
 * Uncontrolled TextInput wrapper.
 *
 * Uses `defaultValue` + `setNativeProps` instead of a `value` prop to prevent
 * React Native 0.85+ (Fabric/New Architecture) from tearing down and
 * recreating the native TextInput view on every parent re-render. This
 * eliminates the "keyboard closes immediately on tap" bug common with
 * controlled TextInputs in the new architecture.
 *
 * The parent's `value` is still kept in sync:
 *   - `onChangeText` propagates user input to the parent.
 *   - `setNativeProps({ text })` updates the native view directly when the
 *     parent resets the value externally (e.g. form clear), but ONLY when the
 *     input is not actively focused, preventing focus loss.
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

  // Keep callback ref current (handler identity changes don't affect native text)
  useEffect(() => {
    onChangeTextRef.current = onChangeText;
  }, [onChangeText]);

  // Track latest controlled value for blur-sync
  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  // Sync parent value to native input when NOT focused (form reset, prefill)
  useEffect(() => {
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
          defaultValue={value}
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
