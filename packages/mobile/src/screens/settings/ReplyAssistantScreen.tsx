import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { useReplyAssistant } from '../../hooks/useReplyAssistant';
import {
  cancelModelDownload,
  deleteModel,
  fetchModelSizeBytes,
  formatBytes,
  isOnWifi,
  pauseModelDownload,
  resumeModelDownload,
  startModelDownload,
  MIN_RAM_BYTES,
} from '../../services/replyAssistant';
import { colors, typography, spacing, radius } from '../../theme';

const POINTS: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  {
    icon: 'sparkles-outline',
    text: 'A small language model reads the last few messages and writes three reply ideas that fit the conversation.',
  },
  {
    icon: 'phone-portrait-outline',
    text: 'It runs entirely on your phone. Your chats are never sent anywhere to make suggestions.',
  },
  {
    icon: 'cloud-download-outline',
    text: 'The model is not part of the app. Download it once, here, when you want it. Delete it any time.',
  },
  {
    icon: 'hand-left-outline',
    text: 'Suggestions are only ever inserted into the input when you tap one. Nothing is sent for you.',
  },
];

/**
 * Profile → Reply assistant. Explains the on-device model, shows its size,
 * and drives the download: start, pause, resume, cancel, delete.
 */
export const ReplyAssistantScreen: React.FC = () => {
  const navigation = useNavigation();
  const state = useReplyAssistant();
  const [busy, setBusy] = useState(false);
  const [onWifi, setOnWifi] = useState<boolean | null>(null);

  useEffect(() => {
    void fetchModelSizeBytes();
    isOnWifi().then(setOnWifi).catch(() => setOnWifi(null));
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const confirmStart = () => {
    const size = formatBytes(state.totalBytes);
    const dataWarning = onWifi === false ? '\n\nYou are not on Wi-Fi — this will use mobile data.' : '';
    Alert.alert(
      'Download reply assistant?',
      `One-time download of about ${size}. It stays on your phone until you delete it.${dataWarning}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Download ${size}`, onPress: () => void run(startModelDownload) },
      ],
    );
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete the reply assistant?',
      `Frees ${formatBytes(state.totalBytes)}. Reply ideas go back to the built-in ones. You can download it again later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void run(deleteModel) },
      ],
    );
  };

  const confirmCancel = () => {
    Alert.alert('Stop the download?', 'The part already downloaded will be removed.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: () => void run(cancelModelDownload) },
    ]);
  };

  const pct = Math.round(state.progress * 100);

  const renderStatus = () => {
    switch (state.phase) {
      case 'checking':
        return <Text style={styles.statusText}>Checking…</Text>;
      case 'unsupported':
        return (
          <Text style={styles.statusText}>
            {state.error
              ? state.error
              : `This phone does not have enough memory for the assistant. It needs at least ${formatBytes(MIN_RAM_BYTES)} of RAM.`}
          </Text>
        );
      case 'ready':
        return (
          <>
            <View style={styles.statusRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.textPrimary} />
              <Text style={styles.statusStrong}>On your phone · {formatBytes(state.totalBytes)}</Text>
            </View>
            <Text style={styles.statusText}>
              Reply ideas in every chat now come from the assistant. Built-in ideas still show while it thinks.
            </Text>
            <Button title="Delete download" variant="outline" onPress={confirmDelete} disabled={busy} fullWidth />
          </>
        );
      case 'downloading':
      case 'paused':
        return (
          <>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.max(pct, 1)}%` }]} />
            </View>
            <Text style={styles.statusText}>
              {state.phase === 'paused' ? 'Paused · ' : ''}
              {formatBytes(state.bytesWritten)} of {formatBytes(state.totalBytes)} ({pct}%)
            </Text>
            <View style={styles.buttonRow}>
              {state.phase === 'downloading' ? (
                <Button title="Pause" variant="secondary" onPress={() => void run(pauseModelDownload)} disabled={busy} style={styles.flexBtn} />
              ) : (
                <Button title="Resume" onPress={() => void run(resumeModelDownload)} disabled={busy} style={styles.flexBtn} />
              )}
              <Button title="Stop" variant="outline" onPress={confirmCancel} disabled={busy} style={styles.flexBtn} />
            </View>
          </>
        );
      case 'error':
        return (
          <>
            <View style={styles.statusRow}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.statusStrong}>{state.error || 'Download failed'}</Text>
            </View>
            <View style={styles.buttonRow}>
              <Button title="Try again" onPress={() => void run(startModelDownload)} disabled={busy} style={styles.flexBtn} />
              <Button title="Remove" variant="outline" onPress={() => void run(cancelModelDownload)} disabled={busy} style={styles.flexBtn} />
            </View>
          </>
        );
      case 'not_downloaded':
      default:
        return (
          <>
            <Text style={styles.statusText}>
              One-time download of about {formatBytes(state.totalBytes)}.
              {onWifi === false ? ' You are on mobile data right now — Wi-Fi is recommended.' : ' Wi-Fi recommended.'}
            </Text>
            <Button
              title={`Download (${formatBytes(state.totalBytes)})`}
              onPress={confirmStart}
              disabled={busy}
              loading={busy}
              icon={<Ionicons name="cloud-download-outline" size={18} color={colors.textInverse} />}
              fullWidth
            />
          </>
        );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Reply assistant</Text>
          <Text style={styles.headerSubtitle}>Smarter reply ideas, generated on your phone</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card style={styles.card}>{renderStatus()}</Card>

        <Card style={styles.card}>
          {POINTS.map((p) => (
            <View key={p.text} style={styles.pointRow}>
              <Ionicons name={p.icon} size={18} color={colors.textPrimary} style={styles.pointIcon} />
              <Text style={styles.pointText}>{p.text}</Text>
            </View>
          ))}
        </Card>

        <Text style={styles.footnote}>
          Model: LFM2 1.2B (Liquid AI), 4-bit. Needs a phone with at least {formatBytes(MIN_RAM_BYTES)} of RAM.
          Without it, chats use the built-in reply ideas.
        </Text>
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
  card: { padding: spacing.lg, gap: spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusStrong: { ...typography.body1, color: colors.textPrimary, fontWeight: '600', flex: 1 },
  statusText: { ...typography.body2, color: colors.textSecondary, lineHeight: 19 },
  progressTrack: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceHighlight,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.full },
  buttonRow: { flexDirection: 'row', gap: spacing.sm },
  flexBtn: { flex: 1 },
  pointRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  pointIcon: { marginTop: 1 },
  pointText: { ...typography.body2, color: colors.textSecondary, lineHeight: 19, flex: 1 },
  footnote: { ...typography.caption, color: colors.textMuted, lineHeight: 17, paddingHorizontal: spacing.sm },
});
