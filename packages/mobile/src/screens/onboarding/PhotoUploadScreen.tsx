import React, { useState } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/common/Button';
import { api } from '../../services/api';
import { colors, typography, spacing, radius } from '../../theme';

export const PhotoUploadScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [photos, setPhotos] = useState<string[]>([]);

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotos((p) => [...p, result.assets[0].uri]);
    }
  };

  const takePhoto = async () => {
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      setPhotos((p) => [result.assets[0].uri, ...p]);
    }
  };

  const handleContinue = async () => {
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
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <TouchableOpacity
              key={i}
              style={[styles.photoSlot, photos[i] ? styles.photoSlotFilled : undefined]}
              onPress={photos[i] ? undefined : i === 0 ? takePhoto : pickPhoto}
            >
              {photos[i] ? (
                <Image source={{ uri: photos[i] }} style={styles.photo} />
              ) : (
                <Ionicons name={i === 0 ? 'camera-outline' : 'add-outline'} size={28} color={colors.textMuted} />
              )}
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.uploadButton} onPress={pickPhoto}>
          <Ionicons name="images-outline" size={20} color={colors.primary} style={{ marginRight: spacing.sm }} />
          <Text style={styles.uploadText}>Upload from Gallery</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.hintText}>{photos.length}/2 minimum photos required</Text>
        <Button title="Continue" onPress={handleContinue} disabled={photos.length < 2} fullWidth />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xxl, paddingBottom: 120 },
  step: { ...typography.label, color: colors.primary, marginBottom: spacing.sm },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, justifyContent: 'center' },
  photoSlot: { width: 100, height: 130, borderRadius: radius.md, backgroundColor: colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.cardBorder },
  photoSlotFilled: { borderColor: colors.primary },
  photo: { width: '100%', height: '100%', borderRadius: radius.md, resizeMode: 'cover' },
  uploadButton: { marginTop: spacing.xxl, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceHighlight, borderRadius: radius.md },
  uploadText: { ...typography.body1, color: colors.primary },
  footer: { position: 'absolute', bottom: 40, left: spacing.xxl, right: spacing.xxl },
  hintText: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.sm },
});
