import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Button } from '../../components/common/Button';
import { colors, typography, spacing, radius } from '../../theme';

export const DoubleDateScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [isLive, setIsLive] = useState(true);

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient colors={['#0A0A0F', '#140a1a']} style={StyleSheet.absoluteFill} />
      <View style={styles.header}><Text style={styles.headerText}>Double Date Live</Text></View>
      <View style={styles.grid}>
        <View style={styles.camSlot}><Text style={styles.camEmoji}>👤</Text><Text style={styles.camLabel}>You</Text></View>
        <View style={styles.camSlot}><Text style={styles.camEmoji}>👤</Text><Text style={styles.camLabel}>Friend</Text></View>
        <View style={styles.camSlot}><Text style={styles.camEmoji}>👤</Text><Text style={styles.camLabel}>Match 1</Text></View>
        <View style={styles.camSlot}><Text style={styles.camEmoji}>👤</Text><Text style={styles.camLabel}>Match 2</Text></View>
      </View>
      <View style={styles.timerRow}><Text style={styles.timerText}>Live · 12:34</Text></View>
      <View style={styles.controls}>
        <Button title={isLive ? 'Leave Room' : 'Start'} onPress={() => setIsLive(!isLive)} variant={isLive ? 'outline' : 'primary'} />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { alignItems: 'center', paddingTop: spacing.lg },
  headerText: { ...typography.h3, color: colors.textPrimary },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', padding: spacing.sm, gap: spacing.sm },
  camSlot: { width: '48%', aspectRatio: 0.75, backgroundColor: colors.surfaceHighlight, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.cardBorder },
  camEmoji: { fontSize: 40, marginBottom: spacing.xs },
  camLabel: { ...typography.caption, color: colors.textSecondary },
  timerRow: { alignItems: 'center', marginBottom: spacing.lg },
  timerText: { ...typography.body1, color: colors.vibeActive },
  controls: { flexDirection: 'row', justifyContent: 'center', paddingBottom: spacing.huge },
});
