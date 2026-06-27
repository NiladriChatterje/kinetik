import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Button } from '../../components/common/Button';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../hooks/useToast';
import { api } from '../../services/api';
import { colors, typography, spacing, radius } from '../../theme';

const DOC_TYPES = [
  { id: 'passport', icon: 'id-card-outline' as const, name: 'Passport' },
  { id: 'license', icon: 'car-outline' as const, name: "Driver's License" },
  { id: 'national_id', icon: 'card-outline' as const, name: 'National ID' },
];

interface SelectedFile {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
}

type UploadPhase = 'idle' | 'uploading' | 'success' | 'error';

export const KYCScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [docType, setDocType] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const toast = useToast();

  /**
   * Open the device document picker for PDF, JPG, PNG files.
   */
  const handlePickDocument = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'image/jpeg',
          'image/png',
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset) return;

      // Validate file size (20MB max — matches backend limit)
      if (asset.size && asset.size > 20 * 1024 * 1024) {
        toast.showError('File Too Large', 'Please select a file under 20MB.');
        return;
      }

      setSelectedFile({
        uri: asset.uri,
        name: asset.name,
        size: asset.size ?? 0,
        mimeType: asset.mimeType ?? 'application/octet-stream',
      });
      setUploadPhase('idle');
      setUploadError(null);
    } catch (err: any) {
      toast.showError('Selection Failed', err?.message || 'Could not open file picker.');
    }
  }, [toast]);

  /**
   * Upload the selected document to the backend.
   */
  const handleUpload = useCallback(async () => {
    if (!docType || !selectedFile) {
      toast.showGlass('Missing Information', 'Please select a document type and file.');
      return;
    }

    setUploadPhase('uploading');
    setUploadError(null);

    try {
      const result = await api.submitKycDocument(
        selectedFile.uri,
        docType,
        selectedFile.mimeType,
      );
      setUploadPhase('success');
      toast.showSuccess(
        'Document Submitted!',
        `Your ${DOC_TYPES.find(d => d.id === docType)?.name || 'document'} has been uploaded for verification.`,
      );
    } catch (err: any) {
      setUploadPhase('error');
      setUploadError(err?.message || 'Upload failed. Please try again.');
      toast.showError('Upload Failed', err?.message || 'Could not upload document.');
    }
  }, [docType, selectedFile, toast]);

  /**
   * Complete onboarding (skip or after successful upload).
   */
  const handleFinish = useCallback(async () => {
    await api.updateOnboardingStep('complete', {
      kycCompleted: uploadPhase === 'success',
      kycDocumentType: docType,
    });
    toast.showSuccess('Welcome to Kinetik!', 'Your profile is ready. Start matching!');
    useAuthStore.getState().setOnboardingStep('complete');
    navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Main' }] });
  }, [uploadPhase, docType, navigation, toast]);

  // ─── Format file size ───────────────────────────────────
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.step}>Final Step</Text>
        <Text style={styles.title}>Verify Your Identity</Text>
        <Text style={styles.subtitle}>Government ID required for secure verification (KYC)</Text>

        {/* Document Type Selector */}
        <Text style={styles.fieldLabel}>Select Document Type</Text>
        <View style={styles.docOptions}>
          {DOC_TYPES.map((doc) => (
            <TouchableOpacity
              key={doc.id}
              style={[styles.docOption, docType === doc.id && styles.docOptionActive]}
              onPress={() => setDocType(doc.id)}
            >
              <Ionicons
                name={doc.icon}
                size={28}
                color={docType === doc.id ? colors.textPrimary : colors.textSecondary}
              />
              <Text style={[styles.docName, docType === doc.id && styles.docNameActive]}>
                {doc.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Document Picker Area */}
        {docType && (
          <>
            <Text style={styles.fieldLabel}>Upload Document</Text>
            <TouchableOpacity
              style={[
                styles.uploadArea,
                selectedFile && styles.uploadAreaSelected,
                uploadPhase === 'uploading' && styles.uploadAreaDisabled,
              ]}
              onPress={handlePickDocument}
              disabled={uploadPhase === 'uploading'}
            >
              {uploadPhase === 'uploading' ? (
                <ActivityIndicator size="large" color={colors.textPrimary} />
              ) : selectedFile ? (
                <>
                  <Ionicons name="checkmark-circle" size={36} color={colors.success} />
                  <Text style={styles.fileName}>{selectedFile.name}</Text>
                  <Text style={styles.fileSize}>{formatSize(selectedFile.size)}</Text>
                  <Text style={styles.changeFileText}>Tap to change file</Text>
                </>
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={36} color={colors.textSecondary} />
                  <Text style={styles.uploadPrompt}>Tap to select document</Text>
                  <Text style={styles.uploadFormats}>PDF, JPG, PNG (max 20MB)</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Upload Error */}
            {uploadPhase === 'error' && uploadError && (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
                <Text style={styles.errorText}>{uploadError}</Text>
              </View>
            )}

            {/* Upload / Success Actions */}
            {selectedFile && uploadPhase !== 'success' && (
              <Button
                title={uploadPhase === 'uploading' ? 'Uploading...' : 'Upload Document'}
                onPress={handleUpload}
                fullWidth
                size="lg"
                loading={uploadPhase === 'uploading'}
              />
            )}

            {uploadPhase === 'success' && (
              <View style={styles.successContainer}>
                <Ionicons name="shield-checkmark-outline" size={24} color={colors.success} />
                <Text style={styles.successText}>
                  Document submitted for verification. We'll notify you once reviewed.
                </Text>
              </View>
            )}
          </>
        )}

        <View style={styles.securityNote}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
          <Text style={styles.securityText}>
            Your documents are encrypted and verified securely. We never share your ID with other users.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title="Complete Setup"
          onPress={handleFinish}
          fullWidth
          size="lg"
        />
        <TouchableOpacity onPress={handleFinish} style={styles.skipButton}>
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  scrollContent: { padding: spacing.xxl, paddingBottom: spacing.huge },

  // Text
  step: { ...typography.label, color: colors.textPrimary, marginBottom: spacing.sm },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl },
  fieldLabel: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },

  // Document type options
  docOptions: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xxl },
  docOption: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  docOptionActive: { borderColor: colors.textPrimary },
  docName: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },
  docNameActive: { color: colors.textPrimary },

  // Upload area
  uploadArea: {
    padding: spacing.xxl,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.cardBorder,
    borderStyle: 'dashed',
    marginBottom: spacing.lg,
  },
  uploadAreaSelected: {
    borderStyle: 'solid',
    borderColor: colors.success,
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  uploadAreaDisabled: {
    opacity: 0.6,
  },
  uploadPrompt: {
    ...typography.body1,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  uploadFormats: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  fileName: {
    ...typography.body1,
    color: colors.textPrimary,
    fontWeight: '600',
    marginTop: spacing.md,
    textAlign: 'center',
  },
  fileSize: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  changeFileText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textDecorationLine: 'underline',
  },

  // Error
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,0,0,0.05)',
    marginBottom: spacing.lg,
  },
  errorText: {
    ...typography.body2,
    color: colors.error,
    flex: 1,
  },

  // Success
  successContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.03)',
    marginBottom: spacing.lg,
  },
  successText: {
    ...typography.body2,
    color: colors.textSecondary,
    flex: 1,
  },

  // Security note
  securityNote: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    marginTop: spacing.xxl,
  },
  securityText: {
    ...typography.caption,
    color: colors.textMuted,
    flex: 1,
    lineHeight: 18,
  },

  // Footer
  footer: { padding: spacing.xxl, paddingBottom: spacing.huge },
  skipButton: { marginTop: spacing.md, alignItems: 'center' },
  skipText: { ...typography.body2, color: colors.textMuted, textDecorationLine: 'underline' },
});
