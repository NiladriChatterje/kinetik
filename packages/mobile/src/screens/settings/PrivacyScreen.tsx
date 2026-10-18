import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, radius } from '../../theme';

const SUPPORT_EMAIL = 'kinetik.dating@gmail.com';
const CHILD_SAFETY_URL = 'https://kinetik-dating.vercel.app/child-safety.html';

// Every line below describes something the code actually does. If a
// behaviour changes, change the line with it.
const SECTIONS: { title: string; icon: keyof typeof Ionicons.glyphMap; points: string[] }[] = [
  {
    title: 'What we never do',
    icon: 'ban-outline',
    points: [
      'No ads. No third party trackers or analytics.',
      'Nothing is kept for future analysis or sold to anyone.',
      'Your exact location is never shown. Others see only the centre of a roughly 5 km area.',
    ],
  },
  {
    title: 'Messages and media',
    icon: 'chatbubble-ellipses-outline',
    points: [
      'Messages are encrypted before they are stored.',
      'Photos, voice notes and files in chat are encrypted at rest with AES-256.',
      'One-time photos are deleted from storage the moment they are viewed. No copy is kept.',
      'Unmatching deletes the whole conversation and its media for both sides, unless one of you reported the other. A reported chat is kept for review instead.',
    ],
  },
  {
    title: 'Photos and verification',
    icon: 'shield-checkmark-outline',
    points: [
      'Profile photos are resized and compressed on your phone. Only the compressed copy is stored.',
      'Face verification runs on your device. Your selfie never leaves the phone.',
      'Aadhaar e-KYC files are checked against UIDAI\'s signature and then discarded. We keep only a verified flag and your date of birth.',
      'Any other ID document is used only to verify you and is never shown to other users.',
    ],
  },
  {
    title: 'Safety',
    icon: 'flag-outline',
    points: [
      'Report or block anyone with the flag button on their profile card or in your chat with them.',
      'Blocking hides you from each other everywhere and closes your chat. They are not told.',
      'A blocked chat stays stored, unseen by either of you, until either account is deleted.',
      'A reported chat is kept for review even after an unmatch or an account deletion, and deleted 180 days after the report is resolved.',
      "Every report is reviewed. Reports about a child's safety are treated as urgent, and accounts that break the rules are banned and reported to the authorities as the law requires.",
      'Kinetik is for adults. Our servers refuse any date of birth under 18.',
    ],
  },
  {
    title: 'Your account',
    icon: 'person-circle-outline',
    points: [
      'Sign-in tokens are stored hashed on the server.',
      'Deleting your account permanently removes your profile, photos, matches, chats, media and ID document.',
    ],
  },
];

export const PrivacyScreen: React.FC = () => {
  const navigation = useNavigation();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Privacy</Text>
          <Text style={styles.headerSubtitle}>How Kinetik handles your data</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {SECTIONS.map((section) => (
          <Card key={section.title} style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name={section.icon} size={18} color={colors.textPrimary} />
              <Text style={styles.cardTitle}>{section.title}</Text>
            </View>
            {section.points.map((point) => (
              <View key={point} style={styles.pointRow}>
                <View style={styles.bullet} />
                <Text style={styles.pointText}>{point}</Text>
              </View>
            ))}
          </Card>
        ))}

        <TouchableOpacity
          style={styles.contactRow}
          onPress={() => Linking.openURL(CHILD_SAFETY_URL).catch(() => {})}
          activeOpacity={0.7}
          accessibilityRole="link"
        >
          <Ionicons name="shield-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.contactText}>
            Our <Text style={styles.contactEmail}>child safety standards</Text>
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.contactRow}
          onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Kinetik%20privacy`).catch(() => {})}
          activeOpacity={0.7}
        >
          <Ionicons name="mail-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.contactText}>
            Questions about your data? <Text style={styles.contactEmail}>{SUPPORT_EMAIL}</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  headerTitle: { ...typography.h2, color: colors.textPrimary },
  headerSubtitle: { ...typography.body2, color: colors.textSecondary, marginTop: 2 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.huge, gap: spacing.md },
  card: { padding: spacing.lg, gap: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  cardTitle: { ...typography.body1, color: colors.textPrimary, fontWeight: '600' },
  pointRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bullet: {
    width: 5,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.textMuted,
    marginTop: 7,
    flexShrink: 0,
  },
  pointText: { ...typography.body2, color: colors.textSecondary, lineHeight: 19, flex: 1 },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  contactText: { ...typography.caption, color: colors.textMuted, flex: 1 },
  contactEmail: { color: colors.textSecondary, fontWeight: '600' },
});
