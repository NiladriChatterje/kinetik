import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Card } from '../../components/common/Card';
import { Avatar } from '../../components/common/Avatar';
import { Button } from '../../components/common/Button';
import { PhotoOptionsModal } from '../../components/profile/PhotoOptionsModal';
import { useToast } from '../../hooks/useToast';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../services/api';
import { compressAndUploadPhoto } from '../../services/photoService';
import { resolveUrl } from '../../config';
import { colors, typography, spacing, radius } from '../../theme';

interface ProfilePhoto {
  id: string;
  url: string;
  thumbnail_url?: string;
  is_primary: boolean;
  order_index: number;
}

interface ProfileData {
  id: string;
  displayName?: string;
  dateOfBirth?: string;
  gender?: string;
  pronouns?: string;
  bio?: string;
  occupation?: string;
  education?: string;
  city?: string;
  county?: string;
  isVerified: boolean;
  primaryPhoto?: { url: string; thumbnailUrl?: string } | null;
}

const METRICS = [
  { label: 'Vibe Checks', value: '23', icon: 'mic-outline' as const },
  { label: 'Matches', value: '8', icon: 'heart-outline' as const },
  { label: 'Lock Rate', value: '35%', icon: 'lock-closed-outline' as const },
  { label: 'Dates', value: '3', icon: 'calendar-outline' as const },
];

const SETTINGS = [
  { icon: 'notifications-outline' as const, label: 'Notifications', screen: 'NotificationPreferences' as const },
  { icon: 'people-outline' as const, label: 'Duo Wingman', screen: 'DuoWingman' as const },
  { icon: 'wallet-outline' as const, label: 'Wallet', screen: 'TokenVault' as const },
  { icon: 'lock-closed-outline' as const, label: 'Privacy', screen: undefined },
  { icon: 'card-outline' as const, label: 'Subscription', screen: undefined },
  { icon: 'call-outline' as const, label: 'Support', screen: undefined },
];

export const ProfileLedgerScreen: React.FC = () => {
  const authUser = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigation = useNavigation();
  const toast = useToast();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [photos, setPhotos] = useState<ProfilePhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [mutatingPhotoId, setMutatingPhotoId] = useState<string | null>(null);
  const [modalPhoto, setModalPhoto] = useState<ProfilePhoto | null>(null);

  const fetchProfileAndPhotos = useCallback(async () => {
    try {
      const [profileRes, photosRes] = await Promise.all([
        api.getProfile(),
        api.getPhotos(),
      ]);
      if (profileRes.success && profileRes.data) {
        setProfile(profileRes.data as ProfileData);
      }
      if (photosRes.success && Array.isArray(photosRes.data)) {
        setPhotos(photosRes.data as ProfilePhoto[]);
      }
    } catch {
      // Silently fail — fall back to auth store data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfileAndPhotos();
  }, [fetchProfileAndPhotos]);

  const handleSettingPress = useCallback(
    (screen: string | undefined) => {
      if (screen) {
        navigation.navigate(screen as never);
      }
    },
    [navigation],
  );

  // Primary photo for the avatar
  const primaryPhoto = photos.find((p) => p.is_primary);
  const avatarUri = primaryPhoto?.url
    ? resolveUrl(primaryPhoto.url)
    : profile?.primaryPhoto?.url
      ? resolveUrl(profile.primaryPhoto.url)
      : undefined;

  // Build location string
  const locationParts = [profile?.city, profile?.county].filter(Boolean);
  const locationStr = locationParts.length > 0 ? locationParts.join(', ') : null;

  const MAX_PHOTOS = 6;

  // ─── Photo Handlers ──────────────────────────────────────

  const handleAddPhoto = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1.0,
    });
    if (result.canceled || !result.assets[0]) return;

    const uri = result.assets[0].uri;
    setMutatingPhotoId(`upload-${Date.now()}`);

    try {
      const saved = await compressAndUploadPhoto(uri);
      toast.showSuccess('Photo Added', 'Your photo has been uploaded.');
      await fetchProfileAndPhotos();
    } catch (err: any) {
      toast.showError('Upload Failed', err?.message || 'Could not upload photo.');
    } finally {
      setMutatingPhotoId(null);
    }
  }, [toast, fetchProfileAndPhotos]);

  const handleSetPrimary = async (photoId: string) => {
    setMutatingPhotoId(photoId);
    try {
      const res = await api.setPrimaryPhoto(photoId);
      if (!res.success) {
        throw new Error(res.error?.message || 'Could not update primary photo.');
      }
      toast.showSuccess('Primary Photo Updated', 'This photo is now your profile picture.');
      await fetchProfileAndPhotos();
    } catch (e: any) {
      toast.showError('Failed', e?.message || 'Could not update primary photo.');
    } finally {
      setMutatingPhotoId(null);
    }
  };

  const handleDeletePhoto = (photoId: string) => {
    Alert.alert(
      'Remove Photo',
      'Are you sure you want to delete this photo? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setMutatingPhotoId(photoId);
            try {
              await api.deletePhoto(photoId);
              toast.showSuccess('Photo Removed', 'The photo has been deleted.');
              await fetchProfileAndPhotos();
            } catch (e: any) {
              toast.showError('Failed', e?.message || 'Could not delete photo.');
            } finally {
              setMutatingPhotoId(null);
            }
          },
        },
      ],
    );
  };

  const handlePhotoPress = (photo: ProfilePhoto) => {
    if (mutatingPhotoId) return; // Already performing an action
    setModalPhoto(photo);
  };

  // Compute display name
  const displayName = profile?.displayName || authUser?.displayName || 'Your Profile';

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.textPrimary} />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <Avatar uri={avatarUri} size={80} isOnline />
          <Text style={styles.name}>{displayName}</Text>
          {locationStr && (
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.locationText}>{locationStr}</Text>
            </View>
          )}
          <View style={styles.verifiedBadge}>
            <Ionicons
              name="checkmark-circle"
              size={14}
              color={colors.textPrimary}
              style={{ marginRight: 4 }}
            />
            <Text style={styles.verifiedText}>Identity Verified</Text>
          </View>
        </View>

        {/* Photos Grid — always visible with empty slots up to MAX_PHOTOS */}
        <View style={styles.photosSection}>
          <View style={styles.photosHeader}>
            <Text style={styles.sectionTitle}>Photos</Text>
            <Text style={styles.photoCount}>{photos.length} / {MAX_PHOTOS}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photosRow}>
            {/* Existing photos */}
            {photos
              .sort((a, b) => a.order_index - b.order_index)
              .map((photo) => {
                const isMutating = mutatingPhotoId === photo.id;
                return (
                  <TouchableOpacity
                    key={photo.id}
                    activeOpacity={0.7}
                    onPress={() => handlePhotoPress(photo)}
                    style={styles.photoThumb}
                  >
                    <Image
                      source={{ uri: resolveUrl(photo.thumbnail_url || photo.url) }}
                      style={[styles.photoImage, isMutating && styles.photoMutating]}
                    />
                    {isMutating && (
                      <View style={styles.photoOverlay}>
                        <ActivityIndicator size="small" color={colors.textInverse} />
                      </View>
                    )}
                    {photo.is_primary ? (
                      <View style={styles.primaryBadge}>
                        <Ionicons name="star" size={10} color={colors.textInverse} />
                      </View>
                    ) : (
                      <View style={styles.setPrimaryHint}>
                        <Ionicons name="ellipse-outline" size={10} color={colors.textInverse} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            {/* Empty slots for remaining capacity */}
            {Array.from({ length: MAX_PHOTOS - photos.length }).map((_, i) => {
              const isUploading = mutatingPhotoId?.startsWith('upload-');
              return (
                <TouchableOpacity
                  key={`empty-${i}`}
                  style={[styles.emptySlot, isUploading && styles.emptySlotUploading]}
                  activeOpacity={0.6}
                  onPress={handleAddPhoto}
                  disabled={!!mutatingPhotoId}
                >
                  {isUploading ? (
                    <ActivityIndicator size="small" color={colors.textMuted} />
                  ) : (
                    <Ionicons name="add" size={28} color={colors.textMuted} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Profile Info */}
        {((profile?.bio) || (profile?.occupation) || (profile?.education)) && (
          <Card style={styles.infoCard}>
            {profile?.bio && <Text style={styles.bioText}>{profile.bio}</Text>}
            {profile?.occupation && (
              <View style={styles.infoRow}>
                <Ionicons name="briefcase-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.infoText}>{profile.occupation}</Text>
              </View>
            )}
            {profile?.education && (
              <View style={styles.infoRow}>
                <Ionicons name="school-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.infoText}>{profile.education}</Text>
              </View>
            )}
          </Card>
        )}

        {/* Metrics */}
        <View style={styles.metricsRow}>
          {METRICS.map((m) => (
            <Card key={m.label} style={styles.metricCard}>
              <Ionicons name={m.icon} size={24} color={colors.textPrimary} />
              <Text style={styles.metricValue}>{m.value}</Text>
              <Text style={styles.metricLabel}>{m.label}</Text>
            </Card>
          ))}
        </View>

        {/* Settings */}
        <Card style={styles.settingsCard}>
          {SETTINGS.map((s, i) => (
            <React.Fragment key={s.label}>
              <TouchableOpacity
                style={styles.settingRow}
                onPress={() => handleSettingPress(s.screen)}
                disabled={!s.screen}
              >
                <Ionicons name={s.icon} size={20} color={colors.textSecondary} />
                <Text style={styles.settingText}>{s.label}</Text>
              </TouchableOpacity>
              {i < SETTINGS.length - 1 && <View style={styles.settingDivider} />}
            </React.Fragment>
          ))}
        </Card>

        <Button title="Sign Out" onPress={logout} variant="outline" fullWidth />
      </ScrollView>

      {/* Photo Options Modal */}
      <PhotoOptionsModal
        visible={modalPhoto !== null}
        photoUrl={modalPhoto?.thumbnail_url || modalPhoto?.url || ''}
        isPrimary={modalPhoto?.is_primary ?? false}
        onSetPrimary={() => {
          if (modalPhoto) handleSetPrimary(modalPhoto.id);
        }}
        onDelete={() => {
          if (modalPhoto) handleDeletePhoto(modalPhoto.id);
        }}
        onClose={() => setModalPhoto(null)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xxl, paddingBottom: 100 },
  profileHeader: { alignItems: 'center', marginBottom: spacing.xxl },
  name: { ...typography.h2, color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.xs },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.sm },
  locationText: { ...typography.caption, color: colors.textSecondary },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceHighlight, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderRadius: radius.full },
  verifiedText: { ...typography.caption, color: colors.textPrimary },
  photosSection: { marginBottom: spacing.lg },
  sectionTitle: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
  photosRow: { gap: spacing.sm },
  photoThumb: { position: 'relative' },
  photoImage: { width: 80, height: 80, borderRadius: radius.md, backgroundColor: colors.surfaceHighlight },
  photoMutating: { opacity: 0.5 },
  photoOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photosHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  photoCount: { ...typography.caption, color: colors.textMuted },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { ...typography.body2, color: colors.textMuted, marginTop: spacing.md },
  primaryBadge: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: colors.primary, borderRadius: radius.full,
    width: 18, height: 18, alignItems: 'center', justifyContent: 'center',
  },
  setPrimaryHint: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: radius.full,
    width: 18, height: 18, alignItems: 'center', justifyContent: 'center',
  },
  emptySlot: {
    width: 80, height: 80,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.cardBorder,
    borderStyle: 'dashed',
  },
  emptySlotUploading: {
    opacity: 0.5,
  },
  infoCard: { padding: spacing.lg, marginBottom: spacing.lg, gap: spacing.sm },
  bioText: { ...typography.body2, color: colors.textPrimary, lineHeight: 20 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  infoText: { ...typography.body2, color: colors.textSecondary },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xxl },
  metricCard: { width: '47%', alignItems: 'center', padding: spacing.md },
  metricValue: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.sm },
  metricLabel: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  settingsCard: { padding: 0, marginBottom: spacing.xxl },
  settingRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  settingText: { ...typography.body1, color: colors.textPrimary },
  settingDivider: { height: 1, backgroundColor: colors.cardBorder, marginHorizontal: spacing.lg },
});