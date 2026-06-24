import React, { useState } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/common/Button';
import { useToast } from '../../hooks/useToast';
import { compressAndUploadPhoto } from '../../services/photoService';
import { api } from '../../services/api';
import { resolveUrl } from '../../config';
import { colors, typography, spacing, radius } from '../../theme';

interface UploadedPhoto {
  id: string;
  url: string;
  thumbnailUrl: string;
  /** Local URI shown while uploading / for display */
  localUri: string;
  uploading: boolean;
}

export const PhotoUploadScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const toast = useToast();

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1.0, // Max quality — we'll compress losslessly ourselves
    });
    if (!result.canceled && result.assets[0]) {
      await processPhoto(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    const result = await ImagePicker.launchCameraAsync({ quality: 1.0 });
    if (!result.canceled && result.assets[0]) {
      await processPhoto(result.assets[0].uri);
    }
  };

  /**
   * Full pipeline: compress → upload → add to local state.
   */
  const processPhoto = async (uri: string) => {
    const placeholder: UploadedPhoto = {
      id: `pending-${Date.now()}`,
      url: '',
      thumbnailUrl: '',
      localUri: uri,
      uploading: true,
    };
    setPhotos((prev) => [...prev, placeholder]);
    setUploading(true);

    try {
      const result = await compressAndUploadPhoto(uri);

      // Replace placeholder with real entry
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === placeholder.id
            ? { ...p, id: result.id, url: result.url, thumbnailUrl: result.thumbnailUrl, uploading: false }
            : p,
        ),
      );

      console.log('[photos] Uploaded:', result.id);
    } catch (error: any) {
      // Remove placeholder on failure
      setPhotos((prev) => prev.filter((p) => p.id !== placeholder.id));
      toast.showError('Upload Failed', error.message || 'Could not upload photo.');
      console.error('[photos] Upload error:', error);
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async (photo: UploadedPhoto) => {
    if (photo.uploading) return; // Don't allow removing during upload

    setPhotos((prev) => prev.filter((p) => p.id !== photo.id));

    if (photo.id && !photo.id.startsWith('pending-')) {
      try {
        await api.deletePhoto(photo.id);
      } catch {
        // Non-critical — photo will be orphaned on server, cleanup later
      }
    }
  };

  const handleContinue = async () => {
    // All photos that are still uploading — wait for them
    const pendingUploads = photos.filter((p) => p.uploading);
    if (pendingUploads.length > 0) {
      toast.showInfo('Please wait', 'Photos are still uploading...');
      return;
    }

    if (photos.length < 2) {
      toast.showError('Minimum 2 Photos', 'You need at least 2 photos to continue.');
      return;
    }

    toast.showSuccess('Photos Saved', 'Your photos have been uploaded.');
    await api.updateOnboardingStep('photos');
    navigation.navigate('PoseVerification');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.step}>Step 3 of 5</Text>
        <Text style={styles.title}>Add Photos</Text>
        <Text style={styles.subtitle}>Upload at least 2 clear photos for your profile</Text>

        <View style={styles.photoGrid}>
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const photo = photos[i];
            return (
              <TouchableOpacity
                key={i}
                style={[styles.photoSlot, photo ? styles.photoSlotFilled : undefined]}
                onPress={photo ? () => removePhoto(photo) : i === 0 ? takePhoto : pickPhoto}
                onLongPress={photo ? () => removePhoto(photo) : undefined}
              >
                {photo ? (
                  <View style={styles.photoWrapper}>
                    <Image
                      source={{ uri: photo.uploading ? photo.localUri : resolveUrl(photo.url) || photo.localUri }}
                      style={styles.photo}
                    />
                    {photo.uploading && (
                      <View style={styles.uploadOverlay}>
                        <ActivityIndicator size="small" color={colors.textInverse} />
                      </View>
                    )}
                    {!photo.uploading && (
                      <View style={styles.removeBadge}>
                        <Ionicons name="close-circle" size={20} color={colors.error} />
                      </View>
                    )}
                  </View>
                ) : (
                  <Ionicons name={i === 0 ? 'camera-outline' : 'add-outline'} size={28} color={colors.textMuted} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity style={styles.uploadButton} onPress={pickPhoto} disabled={uploading}>
          <Ionicons name="images-outline" size={20} color={colors.primary} style={{ marginRight: spacing.sm }} />
          <Text style={styles.uploadText}>Upload from Gallery</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.hintText}>
          {uploading
            ? 'Compressing & uploading...'
            : `${photos.length}/2 minimum photos required`}
        </Text>
        <Button
          title="Continue"
          onPress={handleContinue}
          disabled={photos.length < 2 || uploading}
          loading={uploading}
          fullWidth
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xxl, paddingBottom: 120 },
  step: { ...typography.label, color: colors.textPrimary, marginBottom: spacing.sm },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, justifyContent: 'center' },
  photoSlot: {
    width: 100,
    height: 130,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  photoSlotFilled: { borderColor: colors.textPrimary },
  photoWrapper: { width: '100%', height: '100%', position: 'relative' },
  photo: { width: '100%', height: '100%', borderRadius: radius.md, resizeMode: 'cover' },
  uploadOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: colors.background,
    borderRadius: 10,
  },
  uploadButton: {
    marginTop: spacing.xxl,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
  },
  uploadText: { ...typography.body1, color: colors.textPrimary },
  footer: { position: 'absolute', bottom: 40, left: spacing.xxl, right: spacing.xxl },
  hintText: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.sm },
});
