import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { ConfirmModal } from '../../components/common/ConfirmModal';
import {
  AboutAnswersEditor,
  AboutAnswerMap,
  ABOUT_QUESTIONS,
  aboutAnswersFromProfile,
  emptyAboutAnswers,
  unansweredAboutQuestions,
} from '../../components/profile/AboutAnswersEditor';
import {
  GENDER_OPTIONS,
  GENDER_VALUES,
  GenderOption,
  DATING_CATEGORIES,
  DatingCategoryValue,
  genderOptionFor,
  isDatingCategoryValue,
} from '../../components/profile/profileOptions';
import { formatDob, validateDob, dobToIso, isoToDob } from '../../utils/dob';
import { BIO_MAX_CHARS, BIO_MAX_WORDS, countWords, sanitizeBio, validateBio } from '../../utils/bio';
import { useToast } from '../../hooks/useToast';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../services/api';
import { colors, typography, spacing, radius } from '../../theme';

// Same limits as the profile endpoint (api-core routes/users.ts)
const NAME_MAX = 100;
const PRONOUNS_MAX = 50;
const OCCUPATION_MAX = 100;
const EDUCATION_MAX = 255;

/** Everything on the form, held the way the inputs show it */
interface FormState {
  displayName: string;
  /** DD/MM/YYYY */
  dob: string;
  gender: GenderOption | null;
  pronouns: string;
  datingCategory: DatingCategoryValue | null;
  bio: string;
  occupation: string;
  education: string;
  aboutAnswers: AboutAnswerMap;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** One-line text as it is saved: trimmed, inner runs of spaces collapsed */
const tidy = (s: string): string => s.trim().replace(/\s+/g, ' ');

function formFromProfile(p: any): FormState {
  return {
    displayName: str(p?.displayName),
    dob: isoToDob(p?.dateOfBirth),
    gender: genderOptionFor(p?.gender),
    pronouns: str(p?.pronouns),
    datingCategory: isDatingCategoryValue(p?.datingCategory) ? p.datingCategory : null,
    // A bio saved before the plain-text rule may hold emoji: shown stripped, saved only if edited
    bio: sanitizeBio(str(p?.bio)),
    occupation: str(p?.occupation),
    education: str(p?.education),
    aboutAnswers: aboutAnswersFromProfile(p?.aboutAnswers) ?? emptyAboutAnswers(),
  };
}

function sameAnswers(a: AboutAnswerMap, b: AboutAnswerMap): boolean {
  return ABOUT_QUESTIONS.every((q) => {
    const x = a[q.key];
    const y = b[q.key];
    return x.length === y.length && x.every((v, i) => v === y[i]);
  });
}

/**
 * Only what changed, as the profile endpoint takes it. An untouched field is
 * never sent, so a save can't overwrite it with a reformatted copy.
 */
function changesBetween(initial: FormState, current: FormState): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (tidy(current.displayName) !== tidy(initial.displayName)) changes.displayName = tidy(current.displayName);
  if (current.dob !== initial.dob) changes.dateOfBirth = dobToIso(current.dob);
  if (current.gender && current.gender !== initial.gender) changes.gender = GENDER_VALUES[current.gender];
  if (tidy(current.pronouns) !== tidy(initial.pronouns)) changes.pronouns = tidy(current.pronouns);
  if (current.datingCategory && current.datingCategory !== initial.datingCategory) {
    changes.datingCategory = current.datingCategory;
  }
  if (current.bio.trim() !== initial.bio.trim()) changes.bio = current.bio.trim();
  if (tidy(current.occupation) !== tidy(initial.occupation)) changes.occupation = tidy(current.occupation);
  if (tidy(current.education) !== tidy(initial.education)) changes.education = tidy(current.education);
  if (!sameAnswers(current.aboutAnswers, initial.aboutAnswers)) changes.aboutAnswers = current.aboutAnswers;
  return changes;
}

/** The first thing stopping a save, as a toast title and message; null when the form is complete. */
function firstProblem(form: FormState): [string, string] | null {
  if (!tidy(form.displayName)) return ['Name missing', 'Add the name people see.'];
  if (form.dob.length < 10) return ['Date of birth incomplete', 'Enter it as DD/MM/YYYY.'];
  const dob = validateDob(form.dob);
  if (!dob.valid) return ['Invalid date of birth', dob.error || 'Check the date.'];
  const bio = validateBio(form.bio);
  if (!bio.valid) return ['Check your bio', bio.error || 'Plain text, up to 120 words.'];
  if (!form.gender) return ['Gender missing', 'Pick one to continue.'];
  if (!form.datingCategory) return ['Looking for?', 'Pick what you are here for.'];
  if (!tidy(form.pronouns)) return ['Pronouns missing', 'Add how people should refer to you.'];
  if (unansweredAboutQuestions(form.aboutAnswers).length > 0) {
    return ['Incomplete', 'Pick at least one answer in every "More about you" section.'];
  }
  return null;
}

/**
 * Everything a member told us about themselves at sign-up, editable in one
 * place: name, date of birth, gender, pronouns, what they are looking for,
 * bio, work and studies, and the five 'Knowing more about you' answers.
 * Photos and the feed location stay on the profile page itself.
 */
export const EditProfileScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [status, setStatus] = useState<'loading' | 'failed' | 'ready'>('loading');
  // What the server had when the form opened; a save sends only the difference
  const [initial, setInitial] = useState<FormState | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [bioFocused, setBioFocused] = useState(false);
  const [discardVisible, setDiscardVisible] = useState(false);

  // For the leave guard, which must read the latest form without resubscribing
  const formRef = useRef(form);
  formRef.current = form;
  const initialRef = useRef(initial);
  initialRef.current = initial;
  // Set once a save went through or a discard was confirmed: leave without asking
  const leaveFreelyRef = useRef(false);
  const pendingLeaveRef = useRef<any>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await api.getProfile();
      if (res.success && res.data) {
        const loaded = formFromProfile(res.data);
        setInitial(loaded);
        setForm(loaded);
        setStatus('ready');
      } else {
        setStatus('failed');
      }
    } catch {
      setStatus('failed');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Going back with unsaved edits asks first. Both the back button here and
  // the Android back button pop the screen, so the guard sits on the pop.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      const type = e?.data?.action?.type;
      if (type !== 'GO_BACK' && type !== 'POP') return;
      if (leaveFreelyRef.current) return;
      const current = formRef.current;
      const base = initialRef.current;
      if (!current || !base || Object.keys(changesBetween(base, current)).length === 0) return;
      e.preventDefault();
      pendingLeaveRef.current = e.data.action;
      setDiscardVisible(true);
    });
    return unsubscribe;
  }, [navigation]);

  const confirmDiscard = useCallback(() => {
    setDiscardVisible(false);
    leaveFreelyRef.current = true;
    const action = pendingLeaveRef.current;
    pendingLeaveRef.current = null;
    if (action) navigation.dispatch(action);
    else navigation.goBack();
  }, [navigation]);

  // One stable handler per text field: the Input never re-renders for a new
  // callback, only for its value, which is how the onboarding forms use it
  const handlers = useMemo(() => ({
    displayName: (v: string) => setForm((p) => (p ? { ...p, displayName: v } : p)),
    dob: (v: string) => setForm((p) => (p ? { ...p, dob: formatDob(v) } : p)),
    pronouns: (v: string) => setForm((p) => (p ? { ...p, pronouns: v } : p)),
    bio: (v: string) => setForm((p) => (p ? { ...p, bio: sanitizeBio(v) } : p)),
    occupation: (v: string) => setForm((p) => (p ? { ...p, occupation: v } : p)),
    education: (v: string) => setForm((p) => (p ? { ...p, education: v } : p)),
    gender: (g: GenderOption) => setForm((p) => (p ? { ...p, gender: g } : p)),
    datingCategory: (c: DatingCategoryValue) => setForm((p) => (p ? { ...p, datingCategory: c } : p)),
    aboutAnswers: (a: AboutAnswerMap) => setForm((p) => (p ? { ...p, aboutAnswers: a } : p)),
  }), []);

  const handleSave = useCallback(async () => {
    if (!form || !initial) return;
    setAttempted(true);
    const problem = firstProblem(form);
    if (problem) {
      toast.showGlass(problem[0], problem[1]);
      return;
    }

    const changes = changesBetween(initial, form);
    if (Object.keys(changes).length === 0) {
      leaveFreelyRef.current = true;
      navigation.goBack();
      return;
    }

    setSaving(true);
    try {
      const res = await api.updateProfile(changes);
      if (res.success) {
        if (typeof changes.displayName === 'string') {
          // The name the rest of the app already holds for this session
          const user = useAuthStore.getState().user;
          if (user) useAuthStore.getState().setUser({ ...user, displayName: changes.displayName });
        }
        toast.showSuccess('Profile updated', 'Your changes are live.');
        leaveFreelyRef.current = true;
        navigation.goBack();
      } else {
        toast.showError('Could not save', res.error?.message || 'Try again.');
      }
    } catch {
      toast.showError('Could not save', 'Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }, [form, initial, navigation, toast]);

  const showGenderError = attempted && form !== null && !form.gender;
  const showCategoryError = attempted && form !== null && !form.datingCategory;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            hitSlop={8}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit profile</Text>
        </View>

        {status === 'loading' || !form ? (
          <View style={styles.centered}>
            {status === 'failed' ? (
              <>
                <Ionicons name="cloud-offline-outline" size={28} color={colors.textSecondary} />
                <Text style={styles.noticeText}>Couldn't load your profile.</Text>
                <Button title="Try again" onPress={load} variant="outline" size="sm" />
              </>
            ) : (
              <ActivityIndicator size="large" color={colors.textPrimary} />
            )}
          </View>
        ) : (
          <>
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* ─── Basics (identity step) ─────────────────── */}
              <Text style={styles.sectionTitle}>Basics</Text>
              <Input
                label="Name"
                value={form.displayName}
                onChangeText={handlers.displayName}
                placeholder="Your first name"
                autoCapitalize="words"
                maxLength={NAME_MAX}
                required
              />
              <Input
                label="Date of Birth"
                value={form.dob}
                onChangeText={handlers.dob}
                placeholder="DD/MM/YYYY"
                keyboardType="numeric"
                maxLength={10}
                required
                syncOnChange
              />
              <Input
                label="Pronouns"
                value={form.pronouns}
                onChangeText={handlers.pronouns}
                placeholder="they/them, she/her, he/him"
                maxLength={PRONOUNS_MAX}
                required
              />

              <Text style={styles.fieldLabel}>Gender *</Text>
              <View style={styles.genderGrid}>
                {GENDER_OPTIONS.map((g) => (
                  <TouchableOpacity
                    key={g}
                    activeOpacity={0.7}
                    style={[styles.genderChip, form.gender === g && styles.genderChipActive]}
                    onPress={() => handlers.gender(g)}
                  >
                    <Text style={[styles.genderChipText, form.gender === g && styles.genderChipTextActive]}>
                      {g}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {showGenderError && <Text style={styles.fieldError}>Please select your gender</Text>}

              <Text style={styles.fieldLabel}>What are you looking for? *</Text>
              <View style={styles.categoryGrid}>
                {DATING_CATEGORIES.map((cat) => {
                  const active = form.datingCategory === cat.value;
                  return (
                    <TouchableOpacity
                      key={cat.value}
                      activeOpacity={0.7}
                      style={[styles.categoryChip, active && styles.categoryChipActive]}
                      onPress={() => handlers.datingCategory(cat.value)}
                    >
                      <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                        {cat.label}
                      </Text>
                      <Text style={[styles.categoryChipDesc, active && styles.categoryChipDescActive]}>
                        {cat.description}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {showCategoryError && <Text style={styles.fieldError}>Please select your dating preference</Text>}

              {/* ─── About you (shown on the card) ──────────── */}
              <Text style={styles.sectionTitle}>About you</Text>
              <Text style={styles.sectionHint}>Optional. All of it shows on your profile card.</Text>

              <Text style={styles.fieldLabel}>Bio</Text>
              <TextInput
                style={[styles.bioInput, bioFocused && styles.bioInputFocused]}
                value={form.bio}
                onChangeText={handlers.bio}
                placeholder="A few lines about you, in plain text"
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={BIO_MAX_CHARS}
                textAlignVertical="top"
                autoCapitalize="sentences"
                onFocus={() => setBioFocused(true)}
                onBlur={() => setBioFocused(false)}
              />
              <Text style={styles.counter}>{countWords(form.bio)} / {BIO_MAX_WORDS} words</Text>

              <Input
                label="Work"
                value={form.occupation}
                onChangeText={handlers.occupation}
                placeholder="What you do"
                autoCapitalize="sentences"
                maxLength={OCCUPATION_MAX}
              />
              <Input
                label="Education"
                value={form.education}
                onChangeText={handlers.education}
                placeholder="Where you studied"
                autoCapitalize="sentences"
                maxLength={EDUCATION_MAX}
              />

              {/* ─── Knowing more about you (about step) ────── */}
              <Text style={styles.sectionTitle}>More about you</Text>
              <Text style={styles.sectionHint}>Pick at least one in each section.</Text>
              <AboutAnswersEditor answers={form.aboutAnswers} onChange={handlers.aboutAnswers} showErrors={attempted} />
            </ScrollView>

            {/* Save is pinned below the scroll area. The SafeAreaView only
                covers the top edge, so the footer pads past the bottom inset itself. */}
            <View style={[styles.footer, { paddingBottom: Math.max(spacing.lg, insets.bottom + spacing.sm) }]}>
              <Button title="Save changes" onPress={handleSave} loading={saving} fullWidth />
            </View>
          </>
        )}
      </KeyboardAvoidingView>

      <ConfirmModal
        visible={discardVisible}
        title="Discard changes?"
        message="What you edited here has not been saved."
        keepLabel="Keep editing"
        confirmLabel="Discard"
        onDismiss={() => {
          pendingLeaveRef.current = null;
          setDiscardVisible(false);
        }}
        onConfirm={confirmDiscard}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { ...typography.h2, color: colors.textPrimary, flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl },
  noticeText: { ...typography.body2, color: colors.textSecondary, textAlign: 'center' },
  content: { paddingHorizontal: spacing.xxl, paddingTop: spacing.sm, paddingBottom: spacing.xxl },

  sectionTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.lg },
  sectionHint: { ...typography.caption, color: colors.textMuted, marginTop: -spacing.md, marginBottom: spacing.lg },
  fieldLabel: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
  fieldError: { ...typography.caption, color: colors.error, marginBottom: spacing.lg, marginTop: -spacing.sm },

  // Gender chips and the looking-for cards, as the identity step draws them
  genderGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  genderChip: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderRadius: radius.full, backgroundColor: colors.inputBg,
    borderWidth: 1, borderColor: colors.inputBorder,
  },
  genderChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  genderChipText: { ...typography.body2, color: colors.textSecondary },
  genderChipTextActive: { color: colors.textInverse },
  categoryGrid: { flexDirection: 'column', gap: spacing.sm, marginBottom: spacing.lg },
  categoryChip: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  categoryChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  categoryChipText: { ...typography.body1, color: colors.textPrimary, fontWeight: '600' },
  categoryChipTextActive: { color: colors.textInverse },
  categoryChipDesc: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  categoryChipDescActive: { color: 'rgba(255,255,255,0.7)' },

  // The bio box: the Input's look, taller, and focused the same way (black on white)
  bioInput: {
    ...typography.body1,
    color: colors.textPrimary,
    backgroundColor: colors.inputBg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    minHeight: 100,
    maxHeight: 180,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  bioInputFocused: {
    borderColor: colors.inputFocusBorder,
    backgroundColor: '#000000',
    color: '#FFFFFF',
  },
  counter: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },

  footer: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceHighlight,
    backgroundColor: colors.background,
  },
});
