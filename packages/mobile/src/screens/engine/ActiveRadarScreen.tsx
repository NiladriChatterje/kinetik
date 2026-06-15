import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Button } from '../../components/common/Button';
import { colors, typography, spacing, radius } from '../../theme';

const { width } = Dimensions.get('window');
const RADAR_SIZE = width * 0.7;

export const ActiveRadarScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [isInQueue, setIsInQueue] = useState(false);
  const [queueSize, setQueueSize] = useState(842);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.8, duration: 1500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
      ]),
    ).start();

    Animated.loop(
      Animated.timing(rotateAnim, { toValue: 1, duration: 4000, useNativeDriver: true }),
    ).start();
  }, []);

  const rotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const handleMatchFound = () => {
    navigation.navigate('VibeCheck', { vibeId: 'vibe-123', partnerName: 'Alex' });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Live Radar</Text>
        <View style={styles.queueBadge}>
          <Text style={styles.queueText}>{queueSize} in queue</Text>
        </View>
      </View>

      <View style={styles.radarContainer}>
        <Animated.View style={[styles.radarRing, { opacity: pulseAnim }]} />
        <Animated.View style={[styles.radarSweep, { transform: [{ rotate: rotation }] }]}>
          <LinearGradient colors={['transparent', colors.radarPulse]} style={styles.radarGradient} />
        </Animated.View>
        <View style={styles.radarCenter}>
          <View style={styles.centerDot} />
        </View>
        {[0, 1, 2, 3, 4].map((i) => (
          <Animated.View
            key={i}
            style={[
              styles.blip,
              {
                left: RADAR_SIZE / 2 + Math.cos((i * 72 * Math.PI) / 180) * 80,
                top: RADAR_SIZE / 2 + Math.sin((i * 72 * Math.PI) / 180) * 80,
                opacity: Animated.multiply(pulseAnim, 0.5 + Math.random() * 0.5),
              },
            ]}
          />
        ))}
      </View>

      <View style={styles.info}>
        {isInQueue ? (
          <>
            <Text style={styles.matchingText}>Searching for your match...</Text>
            <Text style={styles.avgText}>Avg. match time: 23 seconds</Text>
            <Button title="Leave Queue" onPress={() => setIsInQueue(false)} variant="outline" />
          </>
        ) : (
          <>
            <Text style={styles.matchingText}>Tap to enter the Flash Window</Text>
            <Text style={styles.avgText}>Over 800 people are live right now</Text>
            <Button title="Enter Queue" onPress={() => setIsInQueue(true)} fullWidth icon={<Text>⚡</Text>} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.radarBg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xxl, paddingTop: spacing.lg },
  title: { ...typography.h2, color: colors.textPrimary },
  queueBadge: { backgroundColor: colors.surfaceHighlight, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderRadius: radius.full },
  queueText: { ...typography.body2, color: colors.primary },
  radarContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  radarRing: { width: RADAR_SIZE, height: RADAR_SIZE, borderRadius: RADAR_SIZE / 2, borderWidth: 2, borderColor: colors.radarRing, position: 'absolute' },
  radarSweep: { width: RADAR_SIZE, height: RADAR_SIZE, borderRadius: RADAR_SIZE / 2, overflow: 'hidden', position: 'absolute' },
  radarGradient: { flex: 1, borderTopLeftRadius: RADAR_SIZE / 2, borderTopRightRadius: RADAR_SIZE / 2, opacity: 0.3 },
  radarCenter: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', position: 'absolute' },
  centerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textPrimary },
  blip: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.vibeActive, position: 'absolute' },
  info: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.huge, alignItems: 'center' },
  matchingText: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.sm, textAlign: 'center' },
  avgText: { ...typography.body2, color: colors.textSecondary, marginBottom: spacing.xl, textAlign: 'center' },
});
