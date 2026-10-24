import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, Keyboard, Animated, LayoutAnimation,
} from 'react-native';
import { useToast } from '../../hooks/useToast';
import { hapticLight } from '../../utils/haptics';
import { colors, typography, spacing, radius } from '../../theme';

// ─── Question Definitions ─────────────────────────────────
// Each question maps to a key in the AboutAnswers JSON shape.
// Suggestions are shown as tappable chips; users can also add
// their own custom entries via the inline input.

export interface AboutQuestion {
  key: 'nature' | 'hobbies' | 'movieGenres' | 'music' | 'dateStyle';
  number: string;
  title: string;
  hint: string;
  max: number;
  suggestions: string[];
}

export const ABOUT_QUESTIONS: AboutQuestion[] = [
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

export type AboutAnswerKey = AboutQuestion['key'];
export type AboutAnswerMap = Record<AboutAnswerKey, string[]>;

export const emptyAboutAnswers = (): AboutAnswerMap => ({
  nature: [], hobbies: [], movieGenres: [], music: [], dateStyle: [],
});

/**
 * The saved answers from the profile endpoint as the editor holds them: only
 * strings, no more per question than it allows. null when nothing is saved.
 */
export function aboutAnswersFromProfile(saved: unknown): AboutAnswerMap | null {
  if (!saved || typeof saved !== 'object') return null;
  const loaded = emptyAboutAnswers();
  for (const q of ABOUT_QUESTIONS) {
    const values = (saved as Record<string, unknown>)[q.key];
    if (Array.isArray(values)) {
      loaded[q.key] = values.filter((v: unknown): v is string => typeof v === 'string').slice(0, q.max);
    }
  }
  return loaded;
}

/** The questions with no answer picked; empty when the set is complete. */
export function unansweredAboutQuestions(answers: AboutAnswerMap): AboutQuestion[] {
  return ABOUT_QUESTIONS.filter((q) => answers[q.key].length === 0);
}

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

const animateLayout = () => {
  LayoutAnimation.configureNext(LayoutAnimation.create(
    250,
    LayoutAnimation.Types.easeInEaseOut,
    LayoutAnimation.Properties.opacity,
  ));
};

interface AboutAnswersEditorProps {
  answers: AboutAnswerMap;
  onChange: (next: AboutAnswerMap) => void;
  /** Marks the sections still without an answer, after a submit was tried. */
  showErrors?: boolean;
}

/**
 * The five 'Knowing more about you' questions as chip pickers, with an
 * opt-in box to type an answer of one's own. Used by the onboarding step
 * and by Edit profile; the screen around it owns the answers.
 */
export const AboutAnswersEditor: React.FC<AboutAnswersEditorProps> = ({ answers, onChange, showErrors = false }) => {
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Which sections currently show the optional manual-typing input.
  // Chips are the primary quick-select path — typing is an opt-in secondary action.
  const [typingOpen, setTypingOpen] = useState<Record<string, boolean>>({});

  const toggle = useCallback((key: AboutAnswerKey, value: string) => {
    animateLayout();
    const current = answers[key];
    if (current.includes(value)) {
      onChange({ ...answers, [key]: current.filter((v) => v !== value) });
      return;
    }
    const question = ABOUT_QUESTIONS.find((q) => q.key === key);
    if (question && current.length >= question.max) {
      toast.showGlass('Limit reached', `Max ${question.max} selections.`);
      return;
    }
    onChange({ ...answers, [key]: [...current, value] });
  }, [answers, onChange, toast]);

  const addCustom = useCallback((key: AboutAnswerKey) => {
    const question = ABOUT_QUESTIONS.find((q) => q.key === key);
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

    animateLayout();
    onChange({ ...answers, [key]: [...current, draft] });
    setDrafts((prev) => ({ ...prev, [key]: '' }));
    // Typing is an opt-in secondary action — collapse back to the pill
    // after a successful add so the chips stay the primary path.
    setTypingOpen((prev) => ({ ...prev, [key]: false }));
    Keyboard.dismiss();
  }, [answers, drafts, onChange, toast]);

  return (
    <>
      {ABOUT_QUESTIONS.map((q, idx) => {
        const selected = answers[q.key];
        const customChips = selected.filter((v) => !q.suggestions.includes(v));
        const allChips = [...q.suggestions, ...customChips];
        const missing = showErrors && selected.length === 0;

        return (
          <View key={q.key} style={[styles.section, idx < ABOUT_QUESTIONS.length - 1 && styles.sectionDivider]}>
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
                  animateLayout();
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
    </>
  );
};

const styles = StyleSheet.create({
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
});
