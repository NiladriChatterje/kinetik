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

export const Input: React.FC<InputProps> = React.memo(({
  label,
  value: controlledValue,
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
  const [localValue, setLocalValue] = useState(controlledValue);
  const isFocusedRef = useRef(false);

  // Sync from parent when NOT focused (e.g., form reset)
  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalValue(controlledValue);
    }
  }, [controlledValue]);

  const handleChangeText = (text: string) => {
    setLocalValue(text);
    onChangeText(text);
  };

  const handleFocus = () => {
    isFocusedRef.current = true;
    setIsFocused(true);
  };

  const handleBlur = () => {
    isFocusedRef.current = false;
    setIsFocused(false);
    // Sync local value back to parent on blur
    setLocalValue(controlledValue);
  };

  return (
    <View style={[styles.container, style as any]}>
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
          value={localValue}
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
