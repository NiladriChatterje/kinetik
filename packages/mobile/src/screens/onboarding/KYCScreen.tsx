import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/common/Button';
import { colors, typography, spacing, radius } from '../../theme';

export const KYCScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [docType, setDocType] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);

  const handleFinish = async () => {
    await (await import('../../services/api')).api.updateOnboardingStep('complete', { kycCompleted: true });
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.step}>Final Step</Text>
        <Text style={styles.title}>Verify Your Identity</Text>
        <Text style={styles.subtitle}>Government ID required for secure verification (KYC)</Text>

        <Text style={styles.fieldLabel}>Select Document Type</Text>
        <View style={styles.docOptions}>
          {[
            { id: 'passport', emoji: '🛂', name: 'Passport' },
            { id: 'license', emoji: '🚗', name: "Driver's License" },
            { id: 'national_id', emoji: '🆔', name: 'National ID' },
          ].map((doc) => (
            <TouchableOpacity
              key={doc.id}
              style={[styles.docOption, docType === doc.id && styles.docOptionActive]}
              onPress={() => setDocType(doc.id)}
            >
              <Text style={styles.docEmoji}>{doc.emoji}</Text>
              <Text style={styles.docName}>{doc.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {docType && (
          <TouchableOpacity style={styles.uploadArea} onPress={() => setUploaded(true)}>
            <Text style={styles.uploadEmoji}>{uploaded ? '✅' : '📄'}</Text>
            <Text style={styles.uploadText}>{uploaded ? 'Document uploaded' : 'Tap to upload document'}</Text>
          </TouchableOpacity>
        )}

        <View style={styles.securityNote}>
          <Text style={styles.securityEmoji}>🔒</Text>
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
  step: { ...typography.label, color: colors.primary, marginBottom: spacing.sm },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl },
  fieldLabel: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
  docOptions: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xxl },
  docOption: { flex: 1, padding: spacing.lg, backgroundColor: colors.surfaceHighlight, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.cardBorder },
  docOptionActive: { borderColor: colors.primary },
  docEmoji: { fontSize: 32, marginBottom: spacing.sm },
  docName: { ...typography.caption, color: colors.textPrimary },
  uploadArea: { padding: spacing.xxl, backgroundColor: colors.surfaceHighlight, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.cardBorder, borderStyle: 'dashed', marginBottom: spacing.xxl },
  uploadEmoji: { fontSize: 36, marginBottom: spacing.sm },
  uploadText: { ...typography.body1, color: colors.textSecondary },
  securityNote: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  securityEmoji: { fontSize: 20 },
  securityText: { ...typography.caption, color: colors.textMuted, flex: 1 },
  footer: { padding: spacing.xxl, paddingBottom: spacing.huge },
  skipText: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
});
