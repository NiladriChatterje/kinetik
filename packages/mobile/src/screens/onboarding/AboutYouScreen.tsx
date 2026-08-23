import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, Keyboard, Animated, LayoutAnimation,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../components/common/Button';
import { useToast } from '../../hooks/useToast';
import { api } from '../../services/api';
import { hapticLight } from '../../utils/haptics';
import { colors, typography, spacing, radius } from '../../theme';


// ─── Question Definitions ─────────────────────────────────
// Each question maps to a key in the AboutAnswers JSON shape.
// Suggestions are shown as tappable chips; users can also add
// their own custom entries via the inline input.

interface AboutQuestion {
  key: 'nature' | 'hobbies' | 'movieGenres' | 'music' | 'dateStyle';
  number: string;
  title: string;
  hint: string;
  max: number;
  suggestions: string[];
}

const QUESTIONS: AboutQuestion[] = [
  {
    key: 'nature',
    number: '01',
    title: 'Your nature',
    hint: 'Pick up to 3 that feel like you',
    max: 3,
    suggestions: [
      'Calm', 'Outgoing', 'Ambitious', 'Creative', 'Adventurous',
      'Thoughtful', 'Playful', 'Reserved', 'Spontaneous', 'Grounded',
      'Empathetic', 'Curious',
    ],
  },
  {
    key: 'hobbies',
    number: '02',
    title: 'What you love doing',
    hint: 'Pick up to 5',
    max: 5,
    suggestions: [
      'Travel', 'Fitness', 'Cooking', 'Reading', 'Gaming', 'Photography',
      'Hiking', 'Dancing', 'Music', 'Art', 'Movies', 'Sports',
      'Board Games', 'Meditation', 'Cycling', 'Writing',
    ],
  },
  {
    key: 'movieGenres',
    number: '03',
    title: 'Movie genres you enjoy',
    hint: 'Pick up to 3',
    max: 3,
    suggestions: [
      'Action', 'Comedy', 'Romance', 'Thriller', 'Sci-Fi', 'Horror',
      'Drama', 'Documentary', 'Animation', 'Mystery',
    ],
  },
  {
    key: 'music',
    number: '04',
    title: 'Your music taste',
    hint: 'Pick up to 3',
    max: 3,
    suggestions: [
      'Pop', 'Rock', 'Indie', 'Electronic', 'Classical', 'Jazz',
      'Hip-Hop', 'R&B', 'Folk', 'Lo-Fi', 'Metal',
    ],
  },
  {
    key: 'dateStyle',
    number: '05',
    title: 'Your ideal first date',
    hint: 'Pick up to 3',
    max: 3,
    suggestions: [
      'Coffee Date', 'Fine Dining', 'Live Music', 'Long Walk', 'Road Trip',
      'Picnic', 'Museum', 'Movie Night', 'Beach Day', 'Cooking Together',
      'Stargazing',
    ],
  },
];

type AnswerKey = AboutQuestion['key'];
type AnswerMap = Record<AnswerKey, string[]>;

const emptyAnswers = (): AnswerMap => ({
  nature: [], hobbies: [], movieGenres: [], music: [], dateStyle: [],
});

// ─── Animated Chip ───────────────────────────────────────
// Each chip runs a micro scale-spring on press for tactile feedback
// without affecting layout width.
const AnimatedChip: React.FC<{
  active: boolean;
  label: string;
  onPress: () => void;
}> = ({ active, label, onPress }) => {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scale, { toValue: 0.92, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  };
  const handlePress = () => {
    hapticLight();
    onPress();
  };

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
    >
      <Animated.View style={[styles.chip, active && styles.chipActive, { transform: [{ scale }] }]}>
        <View style={[styles.check, !active && styles.checkHidden]}>
          <View style={styles.checkGlyph} />
        </View>
        <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
};

export const AboutYouScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [answers, setAnswers] = useState<AnswerMap>(emptyAnswers);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Which sections currently show the optional manual-typing input.
  // Chips are the primary quick-select path — typing is an opt-in secondary action.
  const [typingOpen, setTypingOpen] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const answeredCount = useMemo(
    () => QUESTIONS.filter((q) => answers[q.key].length > 0).length,
    [answers],
  );

  const toggle = useCallback((key: AnswerKey, value: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.create(
      250,
      LayoutAnimation.Types.easeInEaseOut,
      LayoutAnimation.Properties.opacity,
    ));
    const current = answers[key];
    if (current.includes(value)) {
      setAnswers((prev) => ({ ...prev, [key]: prev[key].filter((v) => v !== value) }));
      return;
    }
    const question = QUESTIONS.find((q) => q.key === key);
    if (question && current.length >= question.max) {
      // Checked outside the state updater — updaters must stay pure
      // (React may invoke them twice in StrictMode, which would double-fire the toast).
      toast.showGlass('Limit reached', `Max ${question.max} selections.`);
      return;
    }
    setAnswers((prev) => ({ ...prev, [key]: [...prev[key], value] }));
  }, [answers, toast]);

  const addCustom = useCallback((key: AnswerKey) => {
    const question = QUESTIONS.find((q) => q.key === key);
    if (!question) return;
    const draft = (drafts[key] || '').trim().replace(/\s+/g, ' ');
    if (!draft) return;

    const current = answers[key];
    if (current.includes(draft)) {
      toast.showGlass('Already added', `"${draft}" is in your list.`);
      return;
    }
    if (current.length >= question.max) {
      toast.showGlass('Limit reached', `Max ${question.max} selections.`);
      return;
    }

    LayoutAnimation.configureNext(LayoutAnimation.create(
      250,
      LayoutAnimation.Types.easeInEaseOut,
      LayoutAnimation.Properties.opacity,
    ));
    setAnswers((prev) => ({ ...prev, [key]: [...prev[key], draft] }));
    setDrafts((prev) => ({ ...prev, [key]: '' }));
    // Typing is an opt-in secondary action — collapse back to the pill
    // after a successful add so the chips stay the primary path.
    setTypingOpen((prev) => ({ ...prev, [key]: false }));
    Keyboard.dismiss();
  }, [answers, drafts, toast]);

  const handleSubmit = async () => {
    setAttempted(true);
    const missing = QUESTIONS.filter((q) => answers[q.key].length === 0);
    if (missing.length > 0) {
      toast.showGlass('Incomplete', 'Pick one answer per section.');
      return;
    }

    setLoading(true);
    const res = await api.updateProfile({ aboutAnswers: answers });
    if (res.success) {
      await api.updateOnboardingStep('about');
      navigation.navigate('Location');
    } else {
      toast.showError('Save failed', res.error?.message || 'Try again.');
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.step}>Step 2 of 6</Text>
            <Text style={styles.title}>Knowing more about you</Text>
            <Text style={styles.subtitle}>
              Five quick questions so your matches get the real you, before the small talk
            </Text>
          </View>

          {/* Decorative ring motif — pure geometry, no icons */}
          <View style={styles.rings} pointerEvents="none">
            <View style={styles.ringOuter} />
            <View style={styles.ringInner} />
            <View style={styles.ringDot} />
          </View>
        </View>

        {/* Progress segments */}
        <View style={styles.progressRow}>
          {QUESTIONS.map((q) => {
            const done = answers[q.key].length > 0;
            return <View key={q.key} style={[styles.progressSegment, done && styles.progressSegmentDone]} />;
          })}
        </View>
        <Text style={styles.progressLabel}>
          {answeredCount} of {QUESTIONS.length} answered
        </Text>

        {/* Questions */}
        {QUESTIONS.map((q, idx) => {
          const selected = answers[q.key];
          const customChips = selected.filter((v) => !q.suggestions.includes(v));
          const allChips = [...q.suggestions, ...customChips];
          const missing = attempted && selected.length === 0;

          return (
            <View key={q.key} style={[styles.section, idx < QUESTIONS.length - 1 && styles.sectionDivider]}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionNumber}>{q.number}</Text>
                <View style={styles.sectionHeaderCopy}>
                  <Text style={styles.sectionTitle}>{q.title}</Text>
                  <Text style={styles.sectionHint}>{q.hint}</Text>
                </View>
                <Text style={[styles.sectionCount, selected.length > 0 && styles.sectionCountActive]}>
                  {selected.length}/{q.max}
                </Text>
              </View>

              {/* Chips */}
              <View style={styles.chipWrap}>
                {allChips.map((chip) => {
                  const active = selected.includes(chip);
                  return (
                    <AnimatedChip key={chip} active={active} label={chip} onPress={() => toggle(q.key, chip)} />
                  );
                })}
              </View>

              {/* Custom typing — opt-in secondary action; chips stay the primary path.
                  Hidden once the section reaches max so the disabled pill shows instead. */}
              {typingOpen[q.key] && selected.length < q.max ? (
                <View style={styles.addRow}>
                  <TextInput
                    style={[styles.addInput, missing && styles.addInputError]}
                    value={drafts[q.key] || ''}
                    onChangeText={(t) => setDrafts((prev) => ({ ...prev, [q.key]: t }))}
                    placeholder={selected.length >= q.max ? `Max ${q.max} reached` : 'Type your own'}
                    placeholderTextColor={colors.textMuted}
                    maxLength={40}
                    autoCapitalize="sentences"
                    editable={selected.length < q.max}
                    returnKeyType="done"
                    onSubmitEditing={() => addCustom(q.key)}
                    autoFocus
                  />
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={[styles.addButton, selected.length >= q.max && styles.addButtonDisabled]}
                    onPress={() => addCustom(q.key)}
                    disabled={selected.length >= q.max}
                  >
                    <Text style={styles.addButtonText}>+</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  activeOpacity={0.7}
                  style={[styles.addOwnButton, selected.length >= q.max && styles.addOwnButtonDisabled]}
                  onPress={() => {
                    LayoutAnimation.configureNext(LayoutAnimation.create(
                      250,
                      LayoutAnimation.Types.easeInEaseOut,
                      LayoutAnimation.Properties.opacity,
                    ));
                    setTypingOpen((prev) => ({ ...prev, [q.key]: true }));
                  }}
                  disabled={selected.length >= q.max}
                >
                  <Text style={styles.addOwnButtonText}>+ Add your own</Text>
                </TouchableOpacity>
              )}

              {missing && (
                <Text style={styles.sectionError}>Pick at least one to continue</Text>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { bottom: insets.bottom + 40 }]}>
        <Button title="Continue" onPress={handleSubmit} loading={loading} fullWidth />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xxl, paddingBottom: 140, flexGrow: 1 },

  // ─── Header ─────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  headerCopy: { flex: 1, paddingRight: spacing.lg },
  step: { ...typography.label, color: colors.textPrimary, marginBottom: spacing.sm },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, lineHeight: 21 },

  // Decorative concentric rings — abstract geometry, no icons
  rings: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  ringOuter: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  ringInner: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  ringDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.textPrimary,
  },

  // ─── Progress ───────────────────────────────────────────
  progressRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.inputBg,
  },
  progressSegmentDone: {
    backgroundColor: colors.textPrimary,
  },
  progressLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.xl,
  },

  // ─── Sections ───────────────────────────────────────────
  section: { marginBottom: spacing.xl },
  sectionDivider: {
    paddingBottom: spacing.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.inputBorder,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionNumber: {
    ...typography.label,
    color: colors.textMuted,
    marginRight: spacing.md,
    width: 24,
  },
  sectionHeaderCopy: { flex: 1 },
  sectionTitle: { ...typography.h3, color: colors.textPrimary },
  sectionHint: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  sectionCount: {
    ...typography.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.inputBg,
    overflow: 'hidden',
  },
  sectionCountActive: {
    color: colors.textInverse,
    backgroundColor: colors.textPrimary,
  },

  // ─── Chips ──────────────────────────────────────────────
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.full,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  chipActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  chipText: { ...typography.body2, color: colors.textSecondary },
  chipTextActive: { color: colors.textInverse },
  check: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.textInverse,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  checkHidden: { opacity: 0 },
  checkGlyph: {
    width: 7,
    height: 4,
    borderLeftWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: colors.textPrimary,
    transform: [{ rotate: '-45deg' }],
    marginTop: -2,
  },

  // ─── Custom add row (opt-in typing) ─────────────────────
  addOwnButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.inputBorder,
    backgroundColor: 'transparent',
  },
  addOwnButtonDisabled: { opacity: 0.4 },
  addOwnButtonText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  addInput: {
    flex: 1,
    height: 46,
    borderRadius: radius.full,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: spacing.lg,
    ...typography.body2,
    color: colors.textPrimary,
  },
  addInputError: {
    borderColor: colors.textPrimary,
    borderStyle: 'dashed',
  },
  addButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonDisabled: { opacity: 0.4 },
  addButtonText: {
    color: colors.textInverse,
    fontSize: 24,
    lineHeight: 26,
    fontWeight: '300',
    marginTop: -2,
  },
  sectionError: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },

  // ─── Footer ─────────────────────────────────────────────
  footer: {
    position: 'absolute',
    left: spacing.xxl,
    right: spacing.xxl,
  },
});
