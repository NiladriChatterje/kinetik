import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  KeyboardAvoidingView, Platform, BackHandler, ActivityIndicator, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { useToast } from '../../hooks/useToast';
import { colors, typography, spacing, radius } from '../../theme';

/**
 * Report and block another member (Google Play requires both for apps with
 * profiles and chat, and an in-app way to report child sexual abuse).
 *
 * Rendered as an overlay inside the screen, like ChatScreen's unmatch sheet,
 * not as a <Modal>: the screen's window already handles the keyboard (the
 * chat input relies on it), and a modal's own window may not under
 * edge-to-edge. Render it last in the screen so it covers everything.
 */

/** Keys match the server's REPORT_REASONS (api-core routes/safety.ts). */
const REASONS: Array<{ key: string; label: string }> = [
  { key: 'child_safety', label: 'Child sexual abuse or exploitation' },
  { key: 'underage', label: 'May be under 18' },
  { key: 'sexual_content', label: 'Nudity or sexual content' },
  { key: 'harassment', label: 'Harassment, threats or hate' },
  { key: 'scam', label: 'Scam, spam or asking for money' },
  { key: 'fake_profile', label: 'Fake profile or impersonation' },
  { key: 'other', label: 'Something else' },
];

const DANGER = '#E53935';
const CYBERCRIME_URL = 'https://cybercrime.gov.in';
const MAX_DETAILS = 1000;

type Step = 'menu' | 'report' | 'block';

interface ReportBlockSheetProps {
  visible: boolean;
  /** The member being reported or blocked */
  userId: string;
  name: string;
  /** Their match with the viewer, when there is one (links the report to the chat) */
  matchId?: string;
  onClose: () => void;
  /** Called after a block succeeds, once the sheet has closed */
  onBlocked: () => void;
}

export const ReportBlockSheet: React.FC<ReportBlockSheetProps> = ({
  visible, userId, name, matchId, onClose, onBlocked,
}) => {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [step, setStep] = useState<Step>('menu');
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [busy, setBusy] = useState(false);

  // Start fresh every time the sheet opens
  useEffect(() => {
    if (visible) {
      setStep('menu');
      setReason(null);
      setDetails('');
      setAlsoBlock(true);
      setBusy(false);
    }
  }, [visible, userId]);

  // Android back closes the sheet (or steps back to the menu) instead of
  // leaving the screen underneath
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (busy) return true;
      if (step !== 'menu') setStep('menu');
      else onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, step, busy, onClose]);

  if (!visible) return null;

  const close = () => {
    if (!busy) onClose();
  };

  const block = async (): Promise<boolean> => {
    const res = await api.blockUser(userId).catch(() => null);
    if (!res?.success) {
      toast.showError('Could not block', res?.error?.message || 'Check your connection and try again.');
      return false;
    }
    return true;
  };

  const submitReport = async () => {
    if (!reason || busy) return;
    setBusy(true);
    const res = await api
      .reportUser(userId, reason, details.trim() || undefined, matchId)
      .catch(() => null);
    if (!res?.success) {
      setBusy(false);
      toast.showError('Report not sent', res?.error?.message || 'Check your connection and try again.');
      return;
    }
    const blocked = alsoBlock ? await block() : false;
    setBusy(false);
    toast.showSuccess(
      'Report sent',
      blocked ? `Thank you. ${name} is blocked and we will review your report.` : 'Thank you. We will review your report.',
    );
    onClose();
    if (blocked) onBlocked();
  };

  const confirmBlock = async () => {
    if (busy) return;
    setBusy(true);
    const blocked = await block();
    setBusy(false);
    if (!blocked) return;
    toast.showSuccess('Blocked', `You will not see ${name} again.`);
    onClose();
    onBlocked();
  };

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} accessibilityLabel="Close" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.avoider}
        pointerEvents="box-none"
      >
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.handle} />

          {step === 'menu' && (
            <>
              <Text style={styles.title} numberOfLines={1}>{name}</Text>
              <TouchableOpacity style={styles.menuRow} onPress={() => setStep('report')} accessibilityRole="button">
                <Ionicons name="flag-outline" size={22} color={colors.textPrimary} />
                <View style={styles.menuText}>
                  <Text style={styles.menuLabel}>Report {name}</Text>
                  <Text style={styles.menuHint}>Tell us what is wrong. They will not know it was you.</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuRow} onPress={() => setStep('block')} accessibilityRole="button">
                <Ionicons name="ban-outline" size={22} color={DANGER} />
                <View style={styles.menuText}>
                  <Text style={[styles.menuLabel, { color: DANGER }]}>Block {name}</Text>
                  <Text style={styles.menuHint}>You will not see each other again.</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancel} onPress={close}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'report' && (
            <ScrollView
              style={styles.scroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.title}>Why are you reporting {name}?</Text>
              {REASONS.map((r) => {
                const selected = reason === r.key;
                return (
                  <TouchableOpacity
                    key={r.key}
                    style={styles.reasonRow}
                    onPress={() => setReason(r.key)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                  >
                    <Ionicons
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={selected ? colors.textPrimary : colors.textMuted}
                    />
                    <Text style={styles.reasonText}>{r.label}</Text>
                  </TouchableOpacity>
                );
              })}

              {(reason === 'child_safety' || reason === 'underage') && (
                <View style={styles.urgentNote}>
                  <Ionicons name="alert-circle-outline" size={18} color={DANGER} />
                  <Text style={styles.urgentText}>
                    If a child is in immediate danger, call the police on 112. You can also report
                    online at{' '}
                    <Text
                      style={styles.urgentLink}
                      onPress={() => Linking.openURL(CYBERCRIME_URL).catch(() => {})}
                      accessibilityRole="link"
                    >
                      cybercrime.gov.in
                    </Text>
                    .
                  </Text>
                </View>
              )}

              <TextInput
                style={styles.details}
                value={details}
                onChangeText={setDetails}
                placeholder="Add details (optional)"
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={MAX_DETAILS}
                textAlignVertical="top"
                editable={!busy}
              />

              <TouchableOpacity
                style={styles.toggleRow}
                onPress={() => setAlsoBlock((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: alsoBlock }}
                disabled={busy}
              >
                <Ionicons
                  name={alsoBlock ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={alsoBlock ? colors.textPrimary : colors.textMuted}
                />
                <Text style={styles.toggleText}>Also block {name}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.primaryBtn, (!reason || busy) && styles.btnDisabled]}
                onPress={submitReport}
                disabled={!reason || busy}
                accessibilityRole="button"
              >
                {busy ? (
                  <ActivityIndicator color={colors.textInverse} />
                ) : (
                  <Text style={styles.primaryText}>Send report</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancel} onPress={() => setStep('menu')} disabled={busy}>
                <Text style={styles.cancelText}>Back</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          {step === 'block' && (
            <>
              <View style={styles.blockIcon}>
                <Ionicons name="ban-outline" size={28} color={DANGER} />
              </View>
              <Text style={[styles.title, styles.center]}>Block {name}?</Text>
              <Text style={styles.body}>
                You will not see each other in Explore, Likes or Discover again, and your chat will
                close. {name} will not be told you blocked them.
              </Text>
              <TouchableOpacity
                style={[styles.dangerBtn, busy && styles.btnDisabled]}
                onPress={confirmBlock}
                disabled={busy}
                accessibilityRole="button"
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Block</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancel} onPress={() => setStep('menu')} disabled={busy}>
                <Text style={styles.cancelText}>Back</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
    zIndex: 1000,
    elevation: 1000,
  },
  avoider: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    maxHeight: '90%',
  },
  scroll: { flexGrow: 0 },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceHighlight,
    marginBottom: spacing.md,
  },
  title: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  center: { textAlign: 'center' },
  body: { ...typography.body1, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xl },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  menuText: { flex: 1 },
  menuLabel: { ...typography.h4, color: colors.textPrimary },
  menuHint: { ...typography.body2, color: colors.textMuted, marginTop: 2 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm + 2 },
  reasonText: { ...typography.body1, color: colors.textPrimary, flex: 1 },
  urgentNote: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  urgentText: { ...typography.body2, color: colors.textSecondary, flex: 1 },
  urgentLink: { color: colors.textPrimary, fontWeight: '600', textDecorationLine: 'underline' },
  details: {
    ...typography.body1,
    color: colors.textPrimary,
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    minHeight: 80,
    maxHeight: 140,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  toggleText: { ...typography.body1, color: colors.textPrimary },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  dangerBtn: {
    backgroundColor: DANGER,
    borderRadius: radius.full,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.4 },
  primaryText: { ...typography.button, color: colors.textInverse },
  blockIcon: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(229, 57, 53, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  cancel: { alignItems: 'center', paddingVertical: spacing.md },
  cancelText: { ...typography.button, color: colors.textSecondary },
});
