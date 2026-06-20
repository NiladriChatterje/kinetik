import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/common/Button';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../services/api';
import { colors, typography, spacing, radius } from '../../theme';

const DOC_TYPES = [
  { id: 'passport', icon: 'id-card-outline' as const, name: 'Passport' },
  { id: 'license', icon: 'car-outline' as const, name: "Driver's License" },
  { id: 'national_id', icon: 'card-outline' as const, name: 'National ID' },
];

export const KYCScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [docType, setDocType] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);

  const handleFinish = async () => {
    await api.updateOnboardingStep('complete', { kycCompleted: true });
    // Update local store so RootStack registers Main screen
    useAuthStore.getState().setOnboardingStep('complete');
    // Navigate to Main via the RootStack (parent navigator)
    navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.step}>Final Step</Text>
        <Text style={styles.title}>Verify Your Identity</Text>
        <Text style={styles.subtitle}>Government ID required for secure verification (KYC)</Text>

        <Text style={styles.fieldLabel}>Select Document Type</Text>
        <View style={styles.docOptions}>
          {DOC_TYPES.map((doc) => (
            <TouchableOpacity
              key={doc.id}
              style={[styles.docOption, docType === doc.id && styles.docOptionActive]}
              onPress={() => setDocType(doc.id)}
            >
              <Ionicons name={doc.icon} size={28} color={docType === doc.id ? colors.textPrimary : colors.textSecondary} />
              <Text style={[styles.docName, docType === doc.id && styles.docNameActive]}>{doc.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {docType && (
          <TouchableOpacity style={styles.uploadArea} onPress={() => setUploaded(true)}>
            <Ionicons name={uploaded ? 'checkmark-circle-outline' : 'document-outline'} size={32} color={uploaded ? colors.textPrimary : colors.textSecondary} />
            <Text style={[styles.uploadText, uploaded && { color: colors.textPrimary }]}>
              {uploaded ? 'Document uploaded' : 'Tap to upload document'}
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.securityNote}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
          <Text style={styles.securityText}>Your documents are encrypted and verified securely</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Button title="Complete Setup" onPress={handleFinish} disabled={!uploaded} fullWidth size="lg" />
        <Text style={styles.skipText}>or skip for now</Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: spacing.xxl },
  step: { ...typography.label, color: colors.textPrimary, marginBottom: spacing.sm },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl },
  fieldLabel: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
  docOptions: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xxl },
  docOption: { flex: 1, padding: spacing.lg, backgroundColor: colors.surfaceHighlight, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.cardBorder },
  docOptionActive: { borderColor: colors.textPrimary },
  docName: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },
  docNameActive: { color: colors.textPrimary },
  uploadArea: { padding: spacing.xxl, backgroundColor: colors.surfaceHighlight, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.cardBorder, borderStyle: 'dashed', marginBottom: spacing.xxl },
  uploadText: { ...typography.body1, color: colors.textSecondary, marginTop: spacing.sm },
  securityNote: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  securityText: { ...typography.caption, color: colors.textMuted, flex: 1 },
  footer: { padding: spacing.xxl, paddingBottom: spacing.huge },
  skipText: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
});
