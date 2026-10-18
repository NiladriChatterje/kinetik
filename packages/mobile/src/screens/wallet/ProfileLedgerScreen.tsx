import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Modal, Animated, Dimensions, Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Card } from '../../components/common/Card';
import { Avatar } from '../../components/common/Avatar';
import { Button } from '../../components/common/Button';
import { LocationPicker, LocationSelection } from '../../components/common/LocationPicker';
import { DatingCategoryBadge, DatingCategory } from '../../components/common/DatingCategoryBadge';
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
  datingCategory?: DatingCategory | null;
  city?: string;
  county?: string;
  /** "Search from here" city; null = feed centred on the user's own location */
  preferredLocation?: { countryCode: string; city: string } | null;
  isVerified: boolean;
  primaryPhoto?: { url: string; thumbnailUrl?: string } | null;
}

interface ProfileStats {
  matches: number;
  dates: number;
}

// Metric cards — labels/icons only; values come from the live stats endpoint.
const METRIC_DEFS: {
  key: keyof ProfileStats;
  label: string;
  icon: 'heart-outline' | 'calendar-outline';
  suffix?: string;
}[] = [
  { key: 'matches', label: 'Matches', icon: 'heart-outline' },
  { key: 'dates', label: 'Dates', icon: 'calendar-outline' },
];

const SETTINGS = [
  { icon: 'notifications-outline' as const, label: 'Notifications', screen: 'NotificationPreferences' as const },
  { icon: 'shield-checkmark-outline' as const, label: 'KYC Verification', screen: 'KYCVerify' as const },
  { icon: 'lock-closed-outline' as const, label: 'Privacy', screen: 'Privacy' as const },
  { icon: 'card-outline' as const, label: 'Subscription', screen: 'SubscriptionCheckout' as const },
  { icon: 'mail-outline' as const, label: 'Support', screen: undefined, action: 'support' as const },
];

const SUPPORT_EMAIL = 'kinetik.dating@gmail.com';

/** Cross on the Face Unverified badge, matching the delete confirmations */
const UNVERIFIED_RED = '#E53935';

export const ProfileLedgerScreen: React.FC = () => {
  const authUser = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const navigation = useNavigation();
  const toast = useToast();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [photos, setPhotos] = useState<ProfilePhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [mutatingPhotoId, setMutatingPhotoId] = useState<string | null>(null);
  const [modalPhoto, setModalPhoto] = useState<ProfilePhoto | null>(null);
  const [kycStatus, setKycStatus] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [preferredLocation, setPreferredLocation] = useState<LocationSelection | null>(null);
  const [savingLocation, setSavingLocation] = useState(false);

  // Save the "search from here" city (or null to go back to own location).
  // The picker only reports a full selection, so nothing is saved mid-typing.
  const savePreferredLocation = useCallback(async (sel: LocationSelection | null) => {
    setSavingLocation(true);
    try {
      const res = await api.updateProfile({
        preferredLocation: sel ? { countryCode: sel.countryCode, city: sel.city, stateCode: sel.stateCode } : null,
      });
      if (res.success) {
        setPreferredLocation(sel);
        toast.showSuccess(
          sel ? 'Location updated' : 'Back to your location',
          sel ? `Showing people near ${sel.city}.` : 'Showing people near you.',
        );
      } else {
        toast.showError('Could not save', res.error?.message || 'Try again.');
      }
    } catch {
      toast.showError('Could not save', 'Check your connection and try again.');
    } finally {
      setSavingLocation(false);
    }
  }, [toast]);
  const [stats, setStats] = useState<ProfileStats | null>(null);

  // ─── Delete modal animations ─────────────────────────────
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const sheetY = useRef(new Animated.Value(1)).current;
  const contentScale = useRef(new Animated.Value(1)).current;
  const { height: SCREEN_HEIGHT } = Dimensions.get('window');

  const openDeleteModal = () => {
    setDeleteModalVisible(true);
    Animated.parallel([
      Animated.timing(overlayOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.spring(sheetY, { toValue: 0, speed: 50, bounciness: 4, useNativeDriver: true }),
      Animated.timing(contentScale, { toValue: 0.85, duration: 250, useNativeDriver: true }),
    ]).start();
  };

  const closeDeleteModal = (cb?: () => void) => {
    Animated.parallel([
      Animated.timing(overlayOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(sheetY, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(contentScale, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setDeleteModalVisible(false);
      cb?.();
    });
  };

  const fetchProfileAndPhotos = useCallback(async () => {
    try {
      const [profileRes, photosRes, kycRes, statsRes] = await Promise.all([
        api.getProfile(),
        api.getPhotos(),
        api.getKycStatus().catch(() => null),
        api.getProfileStats().catch(() => null),
      ]);
      if (profileRes.success && profileRes.data) {
        const data = profileRes.data as ProfileData;
        setProfile(data);
        setPreferredLocation(
          data.preferredLocation ? { countryCode: data.preferredLocation.countryCode, city: data.preferredLocation.city } : null,
        );
      }
      if (photosRes.success && Array.isArray(photosRes.data)) {
        setPhotos(photosRes.data as ProfilePhoto[]);
      }
      if (kycRes && kycRes.kycStatus) {
        setKycStatus(kycRes.kycStatus);
      }
      if (statsRes?.success && statsRes.data) {
        setStats(statsRes.data as ProfileStats);
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

  // Refresh KYC status when returning from KYC Verification screen
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchProfileAndPhotos();
    });
    return unsubscribe;
  }, [navigation, fetchProfileAndPhotos]);

  const openSupportMail = useCallback(() => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Kinetik%20support`).catch(() => {
      toast.showGlass('Support', `Write to ${SUPPORT_EMAIL}`);
    });
  }, [toast]);

  const handleSettingPress = useCallback(
    (screen: string | undefined, action?: 'support') => {
      if (action === 'support') {
        openSupportMail();
        return;
      }
      if (screen) {
        navigation.navigate(screen as never);
      }
    },
    [navigation, openSupportMail],
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
  // A profile keeps at least this many photos: deleting is disabled at this
  // count and enabled again once a third photo is added. The server enforces
  // the same rule, so this is only the visible side of it.
  const MIN_PHOTOS = 2;
  const canDeletePhoto = photos.length > MIN_PHOTOS;
  const deleteDisabledReason = `Keep at least ${MIN_PHOTOS} photos. Add another to delete this one.`;

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
      await compressAndUploadPhoto(uri);
      toast.showSuccess('Photo added', 'Uploaded successfully.');
      await fetchProfileAndPhotos();
    } catch (err: any) {
      toast.showError('Upload failed', err?.message || 'Try again.');
    } finally {
      setMutatingPhotoId(null);
    }
  }, [toast, fetchProfileAndPhotos]);

  // The primary photo is the face others see first, so it is only set after
  // a selfie check (PrimaryPhotoSelfieScreen). The profile refetches on focus.
  const handleSetPrimary = (photo: ProfilePhoto) => {
    (navigation as any).navigate('PrimaryPhotoSelfie', { photoId: photo.id, photoUrl: photo.url });
  };

  // ─── Account Deletion ──────────────────────────────────
  // Destructive action with an explicit confirmation. The server requires
  // { confirm: true } as well, so this is double-guarded against accidents.
  const handleDeleteAccount = useCallback(() => {
    openDeleteModal();
  }, []);

  const confirmDeleteAccount = useCallback(() => {
    closeDeleteModal(async () => {
      setDeletingAccount(true);
      const result = await deleteAccount();
      setDeletingAccount(false);
      if (result.success) {
        toast.showSuccess('Account deleted', 'Permanently removed.');
      } else {
        toast.showError('Delete failed', result.error || 'Try again.');
      }
    });
  }, [deleteAccount, toast]);

  // Confirmed inside PhotoOptionsModal, which waits for this before closing
  const handleDeletePhoto = async (photoId: string) => {
    if (!canDeletePhoto) {
      toast.showGlass(`Keep at least ${MIN_PHOTOS} photos`, 'Add another photo before deleting this one.');
      return;
    }
    setMutatingPhotoId(photoId);
    try {
      await api.deletePhoto(photoId);
      toast.showSuccess('Photo removed', 'Deleted.');
      await fetchProfileAndPhotos();
    } catch (e: any) {
      toast.showError('Failed', e?.message || 'Try again.');
    } finally {
      setMutatingPhotoId(null);
    }
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
      <Animated.View style={[styles.contentWrap, { transform: [{ scale: contentScale }] }]}>  
      {/* keyboardShouldPersistTaps: a tap on a LocationPicker suggestion must
          register while the keyboard is up, not just dismiss it */}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
          {/* Verified while the latest selfie matched the photos; a selfie the
              user chose to skip past (primary photo check) shows Unverified */}
          {profile && (
            <View style={styles.verifiedBadge}>
              <Ionicons
                name={profile.isVerified ? 'checkmark-circle' : 'close-circle'}
                size={14}
                color={profile.isVerified ? colors.textPrimary : UNVERIFIED_RED}
                style={{ marginRight: 4 }}
              />
              <Text style={styles.verifiedText}>
                {profile.isVerified ? 'Face Verified' : 'Face Unverified'}
              </Text>
            </View>
          )}
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
        {((profile?.bio) || (profile?.occupation) || (profile?.education) || (profile?.datingCategory)) && (
          <Card style={styles.infoCard}>
            {profile?.datingCategory && (
              <View style={styles.infoRow}>
                <Text style={styles.infoText}>Here for</Text>
                <DatingCategoryBadge category={profile.datingCategory} />
              </View>
            )}
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

        {/* Preferred location — where the feed is centred. Default is the
            user's own location; picking a country + city overrides it. */}
        <Text style={styles.sectionTitle}>Preferred location</Text>
        <Card style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.infoText}>
              {preferredLocation
                ? `Showing people near ${preferredLocation.city}`
                : `Default: people near your current location${profile?.city ? ` (${profile.city})` : ''}`}
            </Text>
          </View>
          <LocationPicker
            // Remount on every saved change so "Use my current location"
            // clears the inputs instead of leaving the old city text behind
            key={preferredLocation ? `${preferredLocation.countryCode}:${preferredLocation.city}` : 'default'}
            value={preferredLocation}
            onChange={(sel) => { if (sel) savePreferredLocation(sel); }}
          />
          {preferredLocation && (
            <Button
              title="Use my current location"
              variant="outline"
              size="sm"
              onPress={() => savePreferredLocation(null)}
              loading={savingLocation}
            />
          )}
        </Card>

        {/* Metrics — live values from the stats endpoint; '—' until loaded */}
        <View style={styles.metricsRow}>
          {METRIC_DEFS.map((m) => {
            const value = stats ? stats[m.key] : null;
            const display = value === null || value === undefined
              ? '—'
              : `${value}${m.suffix || ''}`;
            return (
              <Card key={m.label} style={styles.metricCard}>
                <Ionicons name={m.icon} size={24} color={colors.textPrimary} />
                <Text style={styles.metricValue}>{display}</Text>
                <Text style={styles.metricLabel}>{m.label}</Text>
              </Card>
            );
          })}
        </View>

        {/* Settings */}
        <Card style={styles.settingsCard}>
          {SETTINGS.map((s, i) => {
            const isKycRow = s.screen === 'KYCVerify';
            return (
              <React.Fragment key={s.label}>
                <TouchableOpacity
                  style={styles.settingRow}
                  onPress={() => handleSettingPress(s.screen, 'action' in s ? s.action : undefined)}
                  disabled={!s.screen && !('action' in s)}
                >
                  <Ionicons name={s.icon} size={20} color={colors.textSecondary} />
                  <Text style={styles.settingText}>{s.label}</Text>
                  {isKycRow && kycStatus && (
                    <View style={[
                      styles.kycStatusBadge,
                      kycStatus === 'verified' && styles.kycBadgeVerified,
                      kycStatus === 'pending' && styles.kycBadgePending,
                      kycStatus === 'unverified' && styles.kycBadgeUnverified,
                    ]}>
                      <Ionicons
                        name={
                          kycStatus === 'verified' ? 'checkmark-circle' :
                          kycStatus === 'pending' ? 'time-outline' :
                          'close-circle-outline'
                        }
                        size={12}
                        color={
                          kycStatus === 'verified' ? colors.textInverse :
                          kycStatus === 'pending' ? '#FFA500' :
                          colors.textMuted
                        }
                      />
                      <Text style={[
                        styles.kycStatusText,
                        kycStatus === 'verified' && styles.kycStatusTextVerified,
                        kycStatus === 'pending' && styles.kycStatusTextPending,
                        kycStatus === 'unverified' && styles.kycStatusTextUnverified,
                      ]}>
                        {kycStatus === 'verified' ? 'Verified' :
                         kycStatus === 'pending' ? 'Pending' :
                         'Not Verified'}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
                {i < SETTINGS.length - 1 && <View style={styles.settingDivider} />}
              </React.Fragment>
            );
          })}
        </Card>

        {/* Support */}
        <Text style={styles.sectionTitle}>Support</Text>
        <Card style={styles.infoCard}>
          <Text style={styles.supportText}>
            Questions, problems or ideas to make Kinetik better? Drop a line.
          </Text>
          <TouchableOpacity style={styles.infoRow} onPress={openSupportMail} activeOpacity={0.7}>
            <Ionicons name="mail-outline" size={16} color={colors.textPrimary} />
            <Text style={styles.supportEmail}>{SUPPORT_EMAIL}</Text>
          </TouchableOpacity>
        </Card>

        <Button title="Sign Out" onPress={logout} variant="outline" fullWidth />

        {/* Delete Account — destructive, bottom of screen */}
        <View style={styles.deleteSection}>
          <TouchableOpacity
            style={styles.deleteRow}
            onPress={handleDeleteAccount}
            disabled={deletingAccount}
            activeOpacity={0.7}
          >
            {deletingAccount ? (
              <ActivityIndicator size="small" color="#E53935" />
            ) : (
              <Ionicons name="trash-outline" size={20} color="#E53935" />
            )}
            <Text style={styles.deleteText}>
              {deletingAccount ? 'Deleting…' : 'Delete Account'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.deleteNote}>
            Permanently removes your profile, photos, matches and all chats. This cannot be undone.
          </Text>
        </View>

        <Text style={styles.footerNote}>
          Kinetik is built by a solo college developer as a project and runs on a free server. Rough edges and the odd slow moment are expected.
        </Text>
      </ScrollView>
      </Animated.View>

      {/* Photo Options Modal */}
      <PhotoOptionsModal
        visible={modalPhoto !== null}
        photoUrl={modalPhoto?.thumbnail_url || modalPhoto?.url || ''}
        isPrimary={modalPhoto?.is_primary ?? false}
        onSetPrimary={() => {
          if (modalPhoto) handleSetPrimary(modalPhoto);
        }}
        onDelete={async () => {
          if (modalPhoto) await handleDeletePhoto(modalPhoto.id);
        }}
        canDelete={canDeletePhoto}
        deleteDisabledReason={deleteDisabledReason}
        onClose={() => setModalPhoto(null)}
      />

      {/* Delete Account Confirmation Modal */}
      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="none"
        onRequestClose={() => closeDeleteModal()}
      >
        <Animated.View style={[styles.modalOverlay, { opacity: overlayOpacity }]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => closeDeleteModal()}
          />
          <Animated.View style={[styles.modalSheet, { transform: [{ translateY: sheetY.interpolate({ inputRange: [0, 1], outputRange: [0, SCREEN_HEIGHT] }) }] }]}>
            <View style={styles.modalIcon}>
              <Ionicons name="warning-outline" size={28} color="#E53935" />
            </View>
            <Text style={styles.modalTitle}>Delete Account?</Text>
            <Text style={styles.modalBody}>
              This permanently deletes your profile, photos, matches and all chat history. You will not be able to log back in. This cannot be undone.
            </Text>

            <TouchableOpacity
              style={[styles.modalDeleteBtn, deletingAccount && styles.modalDeleteBtnLoading]}
              onPress={() => confirmDeleteAccount()}
              disabled={deletingAccount}
            >
              {deletingAccount && (
                <ActivityIndicator size="small" color={colors.textMuted} />
              )}
              <Text style={[styles.modalDeleteBtnText, deletingAccount && styles.modalDeleteBtnTextLoading]}>
                Delete My Account
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => closeDeleteModal()}
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
  settingText: { ...typography.body1, color: colors.textPrimary, flex: 1 },
  settingDivider: { height: 1, backgroundColor: colors.cardBorder, marginHorizontal: spacing.lg },

  // KYC status badge
  kycStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  kycBadgeVerified: {
    backgroundColor: colors.success,
  },
  kycBadgePending: {
    backgroundColor: 'rgba(255, 165, 0, 0.12)',
  },
  kycBadgeUnverified: {
    backgroundColor: colors.surfaceHighlight,
  },
  kycStatusText: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '600',
  },
  kycStatusTextVerified: {
    color: colors.textInverse,
  },
  kycStatusTextPending: {
    color: '#FFA500',
  },
  kycStatusTextUnverified: {
    color: colors.textMuted,
  },

  // Delete account
  deleteSection: {
    marginTop: spacing.xl,
    alignItems: 'center',
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  deleteText: {
    ...typography.body1,
    color: '#E53935',
    fontWeight: '600',
  },
  deleteNote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xxl,
  },
  supportText: { ...typography.body2, color: colors.textSecondary, lineHeight: 19 },
  supportEmail: { ...typography.body2, color: colors.textPrimary, fontWeight: '600' },
  footerNote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.xxl,
  },

  // ─── Delete Confirmation Modal ─────────────────────────
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
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  modalIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(229, 57, 53, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  modalTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  modalBody: {
    ...typography.body2,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.sm,
  },
  modalDeleteBtn: {
    width: '100%',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.md + 2,
    backgroundColor: '#E53935',
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  modalDeleteBtnLoading: {
    backgroundColor: colors.surfaceHighlight,
  },
  modalDeleteBtnText: {
    ...typography.button,
    color: colors.textInverse,
  },
  modalDeleteBtnTextLoading: {
    color: colors.textMuted,
  },
  modalCancel: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  modalCancelText: {
    ...typography.body1,
    color: colors.textMuted,
    fontWeight: '500',
  },
});