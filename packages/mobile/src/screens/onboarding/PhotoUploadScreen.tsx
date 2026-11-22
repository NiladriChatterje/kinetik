import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView, ActivityIndicator, Modal, Animated, Dimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/common/Button';
import { StepLabel } from '../../components/common/StepLabel';
import { useNavigationBarInset } from '../../components/common/SystemBars';
import { useToast } from '../../hooks/useToast';
import {
  compressPhoto, uploadPhoto, requireOneFace, requireFaceAtUrl, PhotoFaceError, PHOTO_FACE_MESSAGES, PhotoFaceProblem,
} from '../../services/photoService';
import { api } from '../../services/api';
import { resolveUrl } from '../../config';
import { colors, typography, spacing, radius } from '../../theme';

/**
 * Where a tile is. Every photo must show exactly one face, checked on the
 * device before upload (services/photoService.ts requireOneFace). A refused
 * photo stays in the grid, marked, until the user removes it; tapping it
 * runs the check again. Continue is blocked while any tile is refused.
 */
type PhotoStatus = 'checking' | 'uploading' | 'ok' | PhotoFaceProblem;

interface UploadedPhoto {
  /** Stable grid key: the server id for saved photos, pending-… for new ones */
  key: string;
  /** Server id once uploaded, '' for a photo that never left the phone */
  id: string;
  url: string;
  thumbnailUrl: string;
  /** Local URI shown while checking / uploading, and kept for a retry */
  localUri: string;
  status: PhotoStatus;
}

const isBusy = (p: UploadedPhoto) => p.status === 'checking' || p.status === 'uploading';
const isRefused = (p: UploadedPhoto) =>
  p.status === 'no_face' || p.status === 'multiple_faces' || p.status === 'check_failed';

/** Short label on a refused tile */
const REFUSED_LABEL: Record<PhotoFaceProblem, string> = {
  no_face: 'No face',
  multiple_faces: '2+ faces',
  check_failed: 'Retry',
};

/** The line over Continue while a refused photo is in the grid */
function refusedBanner(photos: UploadedPhoto[]): string | null {
  if (photos.some((p) => p.status === 'no_face')) {
    return 'No face detected in your photos! Remove the marked photo and add one of you.';
  }
  if (photos.some((p) => p.status === 'multiple_faces')) {
    return 'Only you should be in each photo. Remove the marked photo.';
  }
  if (photos.some((p) => p.status === 'check_failed')) {
    return "A photo couldn't be checked. Tap it to retry.";
  }
  return null;
}

export const PhotoUploadScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [sourceModalVisible, setSourceModalVisible] = useState(false);
  const toast = useToast();

  // The latest grid, for the one-time load below (picks may land first)
  const photosRef = useRef<UploadedPhoto[]>([]);
  photosRef.current = photos;

  // ─── Modal animations ────────────────────────────────────
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const sheetY = useRef(new Animated.Value(1)).current;
  const contentScale = useRef(new Animated.Value(1)).current;
  // The modal's own window runs under the Android navigation bar
  const navBarInset = useNavigationBarInset();

  const { height: SCREEN_HEIGHT } = Dimensions.get('window');

  const setStatus = (key: string, patch: Partial<UploadedPhoto>) =>
    setPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  /**
   * Check a photo that is already on the server (saved earlier in this step,
   * or before the face rule existed). It is downloaded and scanned the same
   * way, so nobody resumes past this step with a photo that has no face.
   */
  const checkSavedPhoto = async (photo: UploadedPhoto) => {
    setStatus(photo.key, { status: 'checking' });
    try {
      await requireFaceAtUrl(resolveUrl(photo.url) || photo.url, 'one');
      setStatus(photo.key, { status: 'ok' });
    } catch (err) {
      setStatus(photo.key, { status: err instanceof PhotoFaceError ? err.problem : 'check_failed' });
    }
  };

  // Show photos already uploaded in this step, so returning here to change
  // them starts from what was saved instead of an empty grid. Each one is
  // checked for a face like a new photo.
  useEffect(() => {
    let cancelled = false;
    api.getPhotos().then(async (res: any) => {
      if (cancelled || !res?.success || !Array.isArray(res.data)) return;
      const saved: UploadedPhoto[] = res.data.map((p: any) => ({
        key: p.id,
        id: p.id,
        url: p.url,
        thumbnailUrl: p.thumbnail_url ?? '',
        localUri: '',
        status: 'checking' as const,
      }));
      // Keep anything added meanwhile; skip ids already in the grid
      const fresh = saved.filter((s) => !photosRef.current.some((p) => p.id === s.id));
      setPhotos((prev) => [...fresh, ...prev]);
      // One at a time: each scan decodes a whole photo
      for (const photo of fresh) {
        if (cancelled) return;
        await checkSavedPhoto(photo);
      }
    }).catch(() => {
      // Grid starts empty — the user can still add photos
    });
    return () => { cancelled = true; };
  }, []);

  const openModal = () => {
    setSourceModalVisible(true);
    Animated.parallel([
      Animated.timing(overlayOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.spring(sheetY, { toValue: 0, speed: 50, bounciness: 4, useNativeDriver: true }),
      Animated.timing(contentScale, { toValue: 0.85, duration: 250, useNativeDriver: true }),
    ]).start();
  };

  const closeModal = (cb?: () => void) => {
    Animated.parallel([
      Animated.timing(overlayOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(sheetY, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(contentScale, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setSourceModalVisible(false);
      cb?.();
    });
  };

  const pickFromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1.0,
    });
    if (!result.canceled && result.assets[0]) {
      await processPhoto(result.assets[0].uri);
    }
  };

  const takeWithCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      toast.showGlass('Permission needed', 'Allow camera access in Settings.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 1.0 });
    if (!result.canceled && result.assets[0]) {
      await processPhoto(result.assets[0].uri);
    }
  };

  const promptSource = () => openModal();

  /**
   * Full pipeline: compress → exactly one face (on the device) → upload.
   * A photo that fails the face check is never uploaded; it stays in the
   * grid, marked, until removed. `retryKey` re-runs a refused new photo.
   */
  const processPhoto = async (uri: string, retryKey?: string) => {
    const key = retryKey ?? `pending-${Date.now()}`;
    if (retryKey) {
      setStatus(key, { status: 'checking' });
    } else {
      setPhotos((prev) => [
        ...prev,
        { key, id: '', url: '', thumbnailUrl: '', localUri: uri, status: 'checking' },
      ]);
    }

    try {
      const compressed = await compressPhoto(uri);
      try {
        await requireOneFace(compressed.uri);
      } catch (err) {
        LegacyFileSystem.deleteAsync(compressed.uri, { idempotent: true }).catch(() => {});
        throw err;
      }

      setStatus(key, { status: 'uploading' });
      const result = await uploadPhoto(compressed);
      setStatus(key, { id: result.id, url: result.url, thumbnailUrl: result.thumbnailUrl, status: 'ok' });
      console.log('[photos] Uploaded:', result.id);
    } catch (error: any) {
      if (error instanceof PhotoFaceError) {
        // Kept in the grid, marked: Continue stays blocked until it is removed
        setStatus(key, { status: error.problem });
        const { title, message } = PHOTO_FACE_MESSAGES[error.problem];
        toast.showError(title, error.problem === 'check_failed' ? 'Tap the photo to retry.' : message);
        return;
      }
      // The upload itself failed: drop the tile, as before
      setPhotos((prev) => prev.filter((p) => p.key !== key));
      toast.showError('Upload failed', error.message || 'Try again.');
      console.error('[photos] Upload error:', error);
    }
  };

  /** Tapping a refused tile checks it again */
  const retryPhoto = (photo: UploadedPhoto) => {
    if (photo.id) checkSavedPhoto(photo);
    else if (photo.localUri) processPhoto(photo.localUri, photo.key);
  };

  const removePhoto = async (photo: UploadedPhoto) => {
    if (isBusy(photo)) return; // Don't allow removing during a check or upload

    setPhotos((prev) => prev.filter((p) => p.key !== photo.key));

    // A refused new photo never left the phone; a saved one is deleted
    if (photo.id) {
      try {
        await api.deletePhoto(photo.id);
      } catch {
        // Non-critical — photo will be orphaned on server, cleanup later
      }
    }
  };

  const busy = photos.some(isBusy);
  const okCount = photos.filter((p) => p.status === 'ok').length;
  const banner = refusedBanner(photos);

  const handleContinue = async () => {
    // Photos still being checked or uploaded — wait for them
    if (busy) {
      toast.showGlass('Checking photos', 'Please wait...');
      return;
    }

    // Every photo must show exactly one face: no way past this step until
    // each refused photo is removed (or passes a retry)
    const refused = photos.find(isRefused);
    if (refused) {
      const problem = refused.status as PhotoFaceProblem;
      toast.showError(
        PHOTO_FACE_MESSAGES[problem].title,
        problem === 'check_failed' ? 'Tap the marked photo to retry.' : 'Remove the marked photo to continue.',
      );
      return;
    }

    if (okCount < 2) {
      toast.showGlass('Need more photos', 'Add at least 2 to continue.');
      return;
    }

    toast.showSuccess('Photos saved', 'All uploaded.');
    await api.updateOnboardingStep('photos');
    navigation.navigate('FaceVerification');
  };

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.contentWrap, { transform: [{ scale: contentScale }] }]}>
        <ScrollView contentContainerStyle={styles.content}>
          <StepLabel label="Step 5 of 6" onBack={() => navigation.goBack()} />
          <Text style={styles.title}>Add Photos</Text>
          <Text style={styles.subtitle}>Add at least 2 clear photos. Your face must be in each, and only yours.</Text>

          <View style={styles.photoGrid}>
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const photo = photos[i];
              const refused = !!photo && isRefused(photo);
              return (
                <TouchableOpacity
                  key={photo?.key ?? `slot-${i}`}
                  style={[
                    styles.photoSlot,
                    photo ? styles.photoSlotFilled : undefined,
                    refused ? styles.photoSlotRefused : undefined,
                  ]}
                  onPress={photo ? (refused ? () => retryPhoto(photo) : undefined) : promptSource}
                  onLongPress={photo ? () => removePhoto(photo) : undefined}
                >
                  {photo ? (
                    <View style={styles.photoWrapper}>
                      <Image
                        source={{ uri: photo.localUri || resolveUrl(photo.url) }}
                        style={styles.photo}
                      />
                      {isBusy(photo) && (
                        <View style={styles.uploadOverlay}>
                          <ActivityIndicator size="small" color={colors.textInverse} />
                        </View>
                      )}
                      {refused && (
                        <View style={styles.refusedOverlay}>
                          <Ionicons name="refresh" size={18} color={colors.textInverse} />
                          <Text style={styles.refusedText}>
                            {REFUSED_LABEL[photo.status as PhotoFaceProblem]}
                          </Text>
                        </View>
                      )}
                      {!isBusy(photo) && (
                        <TouchableOpacity
                          style={styles.removeBadge}
                          onPress={() => removePhoto(photo)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="close-circle" size={20} color={colors.error} />
                        </TouchableOpacity>
                      )}
                    </View>
                  ) : (
                    <Ionicons name="add-outline" size={28} color={colors.textMuted} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          {banner && !busy ? (
            <Text style={styles.refusedBanner}>{banner}</Text>
          ) : (
            <Text style={styles.hintText}>
              {busy
                ? 'Checking for your face...'
                : `${okCount}/2 minimum photos required`}
            </Text>
          )}
          <Button
            title="Continue"
            onPress={handleContinue}
            loading={busy}
            fullWidth
          />
        </View>
      </Animated.View>

      <Modal
        visible={sourceModalVisible}
        transparent
        animationType="none"
        onRequestClose={() => closeModal()}
      >
        <Animated.View style={[styles.modalOverlay, { opacity: overlayOpacity, paddingBottom: spacing.xxl + navBarInset }]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => closeModal()}
          />
          <Animated.View style={[styles.modalSheet, { transform: [{ translateY: sheetY.interpolate({ inputRange: [0, 1], outputRange: [0, SCREEN_HEIGHT] }) }] }]}>
            <Text style={styles.modalTitle}>Add Photo</Text>
            <Text style={styles.modalSubtitle}>Choose a source</Text>

            <TouchableOpacity
              style={styles.modalOption}
              onPress={() => closeModal(() => pickFromGallery())}
            >
              <Ionicons name="images-outline" size={22} color={colors.textPrimary} />
              <Text style={styles.modalOptionText}>Gallery</Text>
            </TouchableOpacity>

            <View style={styles.modalDivider} />

            <TouchableOpacity
              style={styles.modalOption}
              onPress={() => closeModal(() => takeWithCamera())}
            >
              <Ionicons name="camera-outline" size={22} color={colors.textPrimary} />
              <Text style={styles.modalOptionText}>Camera</Text>
            </TouchableOpacity>

            <View style={styles.modalDivider} />

            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => closeModal()}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  contentWrap: { flex: 1 },
  content: { padding: spacing.xxl, paddingBottom: 120 },
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
  photoSlotRefused: { borderColor: colors.error, borderWidth: 2 },
  photoWrapper: { width: '100%', height: '100%', position: 'relative' },
  photo: { width: '100%', height: '100%', borderRadius: radius.md, resizeMode: 'cover' },
  uploadOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refusedOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  refusedText: { ...typography.caption, color: colors.textInverse, fontWeight: '700' },
  removeBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: colors.background,
    borderRadius: 10,
  },

  footer: { position: 'absolute', bottom: 40, left: spacing.xxl, right: spacing.xxl },
  hintText: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.sm },
  refusedBanner: {
    ...typography.caption,
    color: colors.error,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },

  // ─── Source Picker Modal ──────────────────────────────
  modalOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
    paddingBottom: spacing.xxl,
  },
  modalSheet: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  modalTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  modalSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  modalOptionText: {
    ...typography.body1,
    color: colors.textPrimary,
  },
  modalDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.inputBorder,
    marginHorizontal: spacing.md,
  },
  modalCancel: {
    marginTop: spacing.sm,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
  },
  modalCancelText: {
    ...typography.body1,
    color: colors.textMuted,
    fontWeight: '500',
  },
});
