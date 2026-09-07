import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, ScrollView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Button } from '../../components/common/Button';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../hooks/useToast';
import { api } from '../../services/api';
import { colors, typography, spacing, radius } from '../../theme';

const DOC_TYPES = [
  { id: 'aadhaar', icon: 'finger-print-outline' as const, name: 'Aadhaar' },
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
type VerifyPhase = 'idle' | 'verifying' | 'matched' | 'no_match' | 'error';
type AadhaarPhase = 'idle' | 'verifying' | 'verified' | 'failed';

export const KYCScreen: React.FC<{ navigation: any; route?: any }> = ({ navigation, route }) => {
  // Check if accessed from settings (KYCVerify route) vs onboarding (KYC route)
  const isFromSettings = route?.name === 'KYCVerify';

  const [docType, setDocType] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [verifyPhase, setVerifyPhase] = useState<VerifyPhase>('idle');
  const [verifyMatchConfidence, setVerifyMatchConfidence] = useState<number>(0);
  // False when the deployment intentionally runs without the face service —
  // the verify action is replaced by a "coming soon" note instead of erroring.
  const [faceVerifyAvailable, setFaceVerifyAvailable] = useState(true);
  // Aadhaar offline e-KYC: only offered once the server has UIDAI's certificate.
  const [aadhaarAvailable, setAadhaarAvailable] = useState(false);
  const [shareCode, setShareCode] = useState('');
  const [aadhaarPhase, setAadhaarPhase] = useState<AadhaarPhase>('idle');
  const [aadhaarMessage, setAadhaarMessage] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    api
      .getKycStatus()
      .then((s) => {
        if (s.faceVerificationAvailable === false) setFaceVerifyAvailable(false);
        if (s.aadhaarOfflineAvailable) setAadhaarAvailable(true);
      })
      .catch(() => {
        // Status fetch failed — keep the action visible; verify has its own errors
      });
  }, []);

  /**
   * Open the device document picker for PDF, JPG, PNG files.
   *
   * Handles both the modern Expo SDK 50+ API ({ canceled, assets[] })
   * and the legacy API ({ type: 'cancel' | 'success' }) for compatibility.
   * Also handles the edge case where assets is null/empty (common on some
   * Android devices where the file picker returns empty results).
   */
  const isAadhaar = docType === 'aadhaar';

  const handlePickDocument = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        // Android often labels the myAadhaar zip as octet-stream, so accept
        // anything for Aadhaar and check the extension below.
        type: isAadhaar
          ? ['application/zip', 'application/x-zip-compressed', 'application/octet-stream', '*/*']
          : ['application/pdf', 'image/jpeg', 'image/png'],
        copyToCacheDirectory: true,
      });

      // Handle cancellation — supports both old API ({ type: 'cancel' })
      // and new API ({ canceled: true })
      if (result.canceled === true || (result as any).type === 'cancel') {
        return;
      }

      // Guard: assets may be null, undefined, or empty array on some devices
      // (e.g. Android when the file provider fails to copy the file)
      if (!result.assets || result.assets.length === 0) {
        toast.showError('No file', 'Could not access file. Try again.');
        return;
      }

      const asset = result.assets[0];

      // Derive a proper MIME type fallback from the file extension
      // when the picker doesn't provide one (common on some Android devices).
      const extension = asset.name?.split('.').pop()?.toLowerCase() || '';
      if (isAadhaar && extension !== 'zip') {
        toast.showError('Not a zip', 'Pick the .zip downloaded from myAadhaar.');
        return;
      }
      const extToMime: Record<string, string> = {
        pdf: 'application/pdf',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
      };
      const resolvedMimeType =
        asset.mimeType && asset.mimeType !== 'application/octet-stream'
          ? asset.mimeType
          : extToMime[extension] || 'application/octet-stream';

      // Validate file size (20MB max — matches backend limit).
      // asset.size can be null on some Android devices.
      const fileSize = asset.size ?? 0;
      if (fileSize > 20 * 1024 * 1024) {
        toast.showError('File too large', 'Max 20MB allowed.');
        return;
      }

      setSelectedFile({
        uri: asset.uri,
        name: asset.name || `document.${extension || 'pdf'}`,
        size: fileSize,
        mimeType: resolvedMimeType,
      });
      setUploadPhase('idle');
      setUploadError(null);
      setAadhaarPhase('idle');
      setAadhaarMessage(null);
    } catch (err: any) {
      console.error('[KYC] Document picker error:', err);
      toast.showError('Selection failed', err?.message || 'Try again.');
    }
  }, [toast, isAadhaar]);

  /**
   * Aadhaar Paperless Offline e-KYC: send the zip and share code, get back a
   * verified flag. Nothing from the file is kept on the server.
   */
  const handleVerifyAadhaar = useCallback(async () => {
    if (!selectedFile || shareCode.length !== 4 || aadhaarPhase === 'verifying') return;
    setAadhaarPhase('verifying');
    setAadhaarMessage(null);
    try {
      const result = await api.submitAadhaarOffline(selectedFile.uri, shareCode);
      if (result.verified) {
        setAadhaarPhase('verified');
        setAadhaarMessage(
          result.faceChecked
            ? 'Your Aadhaar is signed by UIDAI and its photo matches your profile.'
            : 'Your Aadhaar is signed by UIDAI and confirms you are 18 or older.',
        );
        toast.showSuccess('Verified!', 'Aadhaar verification complete.');
      } else {
        setAadhaarPhase('failed');
        setAadhaarMessage(result.reason || 'Your Aadhaar photo did not match your profile photos.');
      }
    } catch (err: any) {
      setAadhaarPhase('failed');
      setAadhaarMessage(err?.message || 'Verification failed. Please try again.');
    }
  }, [selectedFile, shareCode, aadhaarPhase, toast]);

  /**
   * Upload the selected document to the backend.
   */
  const handleUpload = useCallback(async () => {
    if (!docType || !selectedFile) {
      toast.showGlass('Missing info', 'Select doc type and file.');
      return;
    }

    setUploadPhase('uploading');
    setUploadError(null);

    try {
      await api.submitKycDocument(
        selectedFile.uri,
        docType,
        selectedFile.mimeType,
      );
      setUploadPhase('success');
      toast.showSuccess('Submitted', 'Document uploaded for review.');
    } catch (err: any) {
      setUploadPhase('error');
      setUploadError(err?.message || 'Upload failed. Please try again.');
      toast.showError('Upload failed', err?.message || 'Try again.');
    }
  }, [docType, selectedFile, toast]);

  /**
   * Verify the face on the uploaded KYC document against profile photos.
   */
  const handleVerifyFace = useCallback(async () => {
    if (verifyPhase === 'verifying') return;

    setVerifyPhase('verifying');
    setVerifyMatchConfidence(0);

    try {
      const result = await api.verifyKycFace();
      if (result.match) {
        setVerifyPhase('matched');
        setVerifyMatchConfidence(result.confidence);
        toast.showSuccess('Verified!', `${(result.confidence * 100).toFixed(0)}% match confidence.`);
      } else {
        setVerifyPhase('no_match');
        setVerifyMatchConfidence(result.confidence);
        const reason = result.rejectionReasons?.[0] || 'Face could not be matched';
        toast.showGlass('No match', `${reason}. Try again later.`);
      }
    } catch (err: any) {
      setVerifyPhase('error');
      toast.showError('Verification failed', err?.message || 'Try again.');
    }
  }, [verifyPhase, toast]);

  /**
   * Complete onboarding (skip or after successful upload).
   */
  const handleFinish = useCallback(async () => {
    if (!isFromSettings) {
      // Onboarding flow — update step and navigate to main
      await api.updateOnboardingStep('complete', {
        kycCompleted: uploadPhase === 'success' || verifyPhase === 'matched' || aadhaarPhase === 'verified',
        kycDocumentType: docType,
      });
      toast.showSuccess('Welcome!', 'Profile ready. Start matching!');
      useAuthStore.getState().setOnboardingStep('complete');
      navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Main' }] });
    } else {
      // Settings flow — just go back
      navigation.goBack();
      toast.showSuccess('Settings saved', 'KYC settings updated.');
    }
  }, [isFromSettings, uploadPhase, verifyPhase, aadhaarPhase, docType, navigation, toast]);

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
          {DOC_TYPES.filter((doc) => doc.id !== 'aadhaar' || aadhaarAvailable).map((doc) => (
            <TouchableOpacity
              key={doc.id}
              style={[styles.docOption, docType === doc.id && styles.docOptionActive]}
              onPress={() => {
                setDocType(doc.id);
                setSelectedFile(null);
                setUploadPhase('idle');
                setAadhaarPhase('idle');
                setAadhaarMessage(null);
              }}
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

        {/* Aadhaar Paperless Offline e-KYC */}
        {isAadhaar && (
          <>
            <View style={styles.aadhaarSteps}>
              <Text style={styles.aadhaarStep}>1. On myaadhaar.uidai.gov.in choose Offline eKYC.</Text>
              <Text style={styles.aadhaarStep}>2. Set a 4 digit share code and download the zip.</Text>
              <Text style={styles.aadhaarStep}>3. Pick that zip here and enter the same code.</Text>
            </View>

            <Text style={styles.fieldLabel}>e-KYC file</Text>
            <TouchableOpacity
              style={[
                styles.uploadArea,
                selectedFile && styles.uploadAreaSelected,
                aadhaarPhase === 'verifying' && styles.uploadAreaDisabled,
              ]}
              onPress={handlePickDocument}
              disabled={aadhaarPhase === 'verifying'}
            >
              {selectedFile ? (
                <>
                  <Ionicons name="checkmark-circle" size={36} color={colors.success} />
                  <Text style={styles.fileName}>{selectedFile.name}</Text>
                  <Text style={styles.fileSize}>{formatSize(selectedFile.size)}</Text>
                  <Text style={styles.changeFileText}>Tap to change file</Text>
                </>
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={36} color={colors.textSecondary} />
                  <Text style={styles.uploadPrompt}>Tap to select the zip</Text>
                  <Text style={styles.uploadFormats}>Downloaded from myAadhaar</Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={styles.fieldLabel}>Share code</Text>
            <TextInput
              style={styles.shareCodeInput}
              value={shareCode}
              onChangeText={(t) => setShareCode(t.replace(/[^0-9]/g, '').slice(0, 4))}
              placeholder="4 digits"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              editable={aadhaarPhase !== 'verifying'}
            />

            {aadhaarPhase !== 'verified' && (
              <Button
                title="Verify with Aadhaar"
                onPress={handleVerifyAadhaar}
                fullWidth
                size="lg"
                loading={aadhaarPhase === 'verifying'}
                disabled={!selectedFile || shareCode.length !== 4}
              />
            )}

            {aadhaarPhase === 'verified' && (
              <View style={styles.matchResult}>
                <Ionicons name="checkmark-circle" size={32} color={colors.success} />
                <Text style={styles.matchTitle}>Aadhaar Verified</Text>
                <Text style={styles.matchDetail}>{aadhaarMessage}</Text>
              </View>
            )}

            {aadhaarPhase === 'failed' && aadhaarMessage && (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
                <Text style={styles.errorText}>{aadhaarMessage}</Text>
              </View>
            )}

            <Text style={styles.aadhaarNote}>
              The file is checked against UIDAI's signature and then discarded. We keep only that you are verified.
            </Text>
          </>
        )}

        {/* Document Picker Area */}
        {docType && !isAadhaar && (
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
              <>
                <View style={styles.successContainer}>
                  <Ionicons name="shield-checkmark-outline" size={24} color={colors.success} />
                  <Text style={styles.successText}>
                    Document submitted successfully! Now verify your face matches the one on your ID.
                  </Text>
                </View>

                {/* Face Verification Section */}
                <View style={styles.verifySection}>
                  {!faceVerifyAvailable ? (
                    <View style={styles.comingSoonBox}>
                      <Ionicons name="time-outline" size={22} color={colors.textMuted} />
                      <Text style={styles.comingSoonText}>
                        ID face verification is coming soon. Your document is saved —
                        you can finish setup now and verify later from settings.
                      </Text>
                    </View>
                  ) : verifyPhase === 'idle' && (
                    <Button
                      title="Verify Face on Document"
                      onPress={handleVerifyFace}
                      fullWidth
                      size="lg"
                    />
                  )}

                  {verifyPhase === 'verifying' && (
                    <View style={styles.verifyingContainer}>
                      <ActivityIndicator size="large" color={colors.textPrimary} />
                      <Text style={styles.verifyingText}>
                        Comparing face on document with your profile photos...
                      </Text>
                    </View>
                  )}

                  {verifyPhase === 'matched' && (
                    <View style={styles.matchResult}>
                      <Ionicons name="checkmark-circle" size={32} color={colors.success} />
                      <Text style={styles.matchTitle}>Face Verified!</Text>
                      <Text style={styles.matchDetail}>
                        Your face on the document matches your profile photos.
                      </Text>
                      <Text style={styles.matchConfidence}>
                        Confidence: {(verifyMatchConfidence * 100).toFixed(0)}%
                      </Text>
                    </View>
                  )}

                  {verifyPhase === 'no_match' && (
                    <View style={styles.noMatchResult}>
                      <Ionicons name="alert-circle-outline" size={32} color="#FFA500" />
                      <Text style={styles.noMatchTitle}>Could Not Verify</Text>
                      <Text style={styles.noMatchDetail}>
                        The face on your document could not be confidently matched.
                        You can try again or skip for now and try later from settings.
                      </Text>
                      <View style={styles.verifyRetryRow}>
                        <Button
                          title="Try Again"
                          onPress={handleVerifyFace}
                          size="md"
                          style={{ flex: 1 }}
                        />
                      </View>
                    </View>
                  )}

                  {verifyPhase === 'error' && (
                    <View style={styles.noMatchResult}>
                      <Ionicons name="alert-circle-outline" size={32} color={colors.error} />
                      <Text style={styles.noMatchTitle}>Verification Failed</Text>
                      <Text style={styles.noMatchDetail}>
                        Could not complete verification. Please try again.
                      </Text>
                      <View style={styles.verifyRetryRow}>
                        <Button
                          title="Try Again"
                          onPress={handleVerifyFace}
                          size="md"
                          style={{ flex: 1 }}
                        />
                      </View>
                    </View>
                  )}
                </View>
              </>
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

  // Aadhaar offline e-KYC
  aadhaarSteps: {
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  aadhaarStep: { ...typography.body2, color: colors.textSecondary, lineHeight: 19 },
  shareCodeInput: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.body1,
    color: colors.textPrimary,
    letterSpacing: 6,
    marginBottom: spacing.lg,
  },
  aadhaarNote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },

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

  // Face verification section
  verifySection: { marginTop: spacing.md, marginBottom: spacing.lg },
  comingSoonBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHighlight,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  comingSoonText: { ...typography.caption, color: colors.textSecondary, flex: 1, lineHeight: 17 },
  verifyingContainer: {
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  verifyingText: { ...typography.body2, color: colors.textSecondary, textAlign: 'center' },
  matchResult: {
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(78, 205, 196, 0.1)',
    borderRadius: radius.lg,
    gap: spacing.sm,
  },
  matchTitle: { ...typography.h3, color: colors.success },
  matchDetail: { ...typography.body2, color: colors.textSecondary, textAlign: 'center' },
  matchConfidence: { ...typography.caption, color: colors.textMuted },
  noMatchResult: {
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(255, 165, 0, 0.08)',
    borderRadius: radius.lg,
    gap: spacing.sm,
  },
  noMatchTitle: { ...typography.h3, color: '#FFA500' },
  noMatchDetail: { ...typography.body2, color: colors.textSecondary, textAlign: 'center' },
  verifyRetryRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
});
