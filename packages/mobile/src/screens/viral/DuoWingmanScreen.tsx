import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, radius } from '../../theme';

export const DuoWingmanScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [inviteCode, setInviteCode] = useState('KTNK-A8X3');
  const [friendJoined, setFriendJoined] = useState(false);

  const handleShare = async () => {
    await Share.share({ message: `Join my Duo Crew on Kinetik! Use code: ${inviteCode}` });
    setTimeout(() => setFriendJoined(true), 3000);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Ionicons name={friendJoined ? 'sparkles-outline' : 'people-outline'} size={64} color={friendJoined ? colors.textPrimary : colors.textPrimary} />
        <Text style={styles.title}>{friendJoined ? 'Duo Crew Ready!' : 'Duo Wingman'}</Text>
        <Text style={styles.subtitle}>
          {friendJoined ? 'You and your friend are ready for a double date!' : 'Invite a single friend and double your match power'}
        </Text>

        <Card style={styles.inviteCard}>
          <Text style={styles.inviteLabel}>Your Invite Code</Text>
          <Text style={styles.inviteCode}>{inviteCode}</Text>
          <Text style={styles.inviteHint}>Share this code with a single friend</Text>
        </Card>

        {friendJoined && (
          <View style={styles.friendCard}>
            <Ionicons name="person-outline" size={28} color={colors.textPrimary} />
            <Text style={styles.friendName}>Your friend has joined!</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        {!friendJoined ? (
          <Button title="Share Invite" onPress={handleShare} fullWidth icon={<Ionicons name="share-outline" size={20} color={colors.textPrimary} />} />
        ) : (
          <Button title="Enter Double Date Queue" onPress={() => navigation.navigate('DoubleDate', { roomId: 'dd-123' })} fullWidth size="lg" icon={<Ionicons name="enter-outline" size={20} color={colors.textPrimary} />} />
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm, marginTop: spacing.lg },
  subtitle: { ...typography.body1, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xxl },
  inviteCard: { alignItems: 'center', padding: spacing.xl, marginBottom: spacing.lg, width: '100%' },
  inviteLabel: { ...typography.label, color: colors.textMuted, marginBottom: spacing.sm },
  inviteCode: { ...typography.h1, color: colors.textPrimary, letterSpacing: 4, marginBottom: spacing.sm },
  inviteHint: { ...typography.caption, color: colors.textMuted },
  friendCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceHighlight, padding: spacing.lg, borderRadius: radius.md, width: '100%' },
  friendName: { ...typography.body1, color: colors.textPrimary },
  footer: { padding: spacing.xxl, paddingBottom: spacing.huge },
});
