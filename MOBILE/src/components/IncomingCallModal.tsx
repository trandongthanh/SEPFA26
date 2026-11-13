import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  Easing,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCall } from '../context/CallContext';

interface IncomingCallModalProps {
  onAccept: (session: any) => void;
}

export const IncomingCallModal: React.FC<IncomingCallModalProps> = ({ onAccept }) => {
  const { incomingCall, acceptCall, declineCall, dismissCall } = useCall();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [loadingAccept, setLoadingAccept] = useState(false);
  const [loadingDecline, setLoadingDecline] = useState(false);

  // Pulse animations for radar effect
  const pulseAnim1 = useRef(new Animated.Value(1)).current;
  const pulseAnim2 = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!incomingCall) return;

    // Start radar looping animations
    const pulse1 = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim1, {
          toValue: 1.4,
          duration: 1200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim1, {
          toValue: 1,
          duration: 1200,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    const pulse2 = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim2, {
          toValue: 1.7,
          duration: 1500,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim2, {
          toValue: 1,
          duration: 1500,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    pulse1.start();
    pulse2.start();

    return () => {
      pulse1.stop();
      pulse2.stop();
    };
  }, [incomingCall]);

  // Countdown timer based on ringExpiresAt from BE
  useEffect(() => {
    if (!incomingCall?.ringExpiresAt) return;

    const updateRemaining = () => {
      const expMs = new Date(incomingCall.ringExpiresAt).getTime();
      const diffSec = Math.max(0, Math.ceil((expMs - Date.now()) / 1000));
      setSecondsLeft(diffSec);

      if (diffSec <= 0) {
        dismissCall();
      }
    };

    updateRemaining();
    const timer = setInterval(updateRemaining, 1000);

    return () => clearInterval(timer);
  }, [incomingCall?.ringExpiresAt, dismissCall]);

  if (!incomingCall) return null;

  const handlePressAccept = async () => {
    if (loadingAccept || loadingDecline) return;
    setLoadingAccept(true);
    try {
      const session = await acceptCall();
      if (session) {
        onAccept(session);
      }
    } catch (e) {
      console.error('Accept call failed:', e);
    } finally {
      setLoadingAccept(false);
    }
  };

  const handlePressDecline = async () => {
    if (loadingDecline || loadingAccept) return;
    setLoadingDecline(true);
    try {
      await declineCall();
    } finally {
      setLoadingDecline(false);
    }
  };

  const shortOrderId = incomingCall.orderId
    ? incomingCall.orderId.slice(0, 8).toUpperCase()
    : '---';

  return (
    <Modal visible={!!incomingCall} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.cardContainer}>
          {/* Ambient Glow Header */}
          <View style={styles.glowBackground} />

          {/* Radar Avatar Area */}
          <View style={styles.avatarWrapper}>
            <Animated.View
              style={[
                styles.radarCircle2,
                {
                  transform: [{ scale: pulseAnim2 }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.radarCircle1,
                {
                  transform: [{ scale: pulseAnim1 }],
                },
              ]}
            />
            <View style={styles.avatarCore}>
              <Ionicons name="videocam" size={38} color="#FFFFFF" />
            </View>
          </View>

          {/* Caller Details */}
          <View style={styles.infoSection}>
            <Text style={styles.tagText}>CUỘC GỌI VIDEO ĐẾN</Text>
            <Text style={styles.callerName} numberOfLines={1}>
              {incomingCall.caller?.fullName || 'Người dùng LanCare'}
            </Text>
            <View style={styles.orderBadge}>
              <Ionicons name="receipt-outline" size={13} color="#A78BFA" />
              <Text style={styles.orderBadgeText}>Đơn #{shortOrderId}</Text>
            </View>

            {secondsLeft !== null && (
              <Text style={styles.countdownText}>
                Tự động tắt sau <Text style={{ color: '#F87171', fontWeight: '700' }}>{secondsLeft}s</Text>
              </Text>
            )}
          </View>

          {/* Action Buttons */}
          <View style={styles.actionsRow}>
            {/* Decline */}
            <TouchableOpacity
              style={[styles.btn, styles.declineBtn]}
              onPress={handlePressDecline}
              disabled={loadingDecline || loadingAccept}
              activeOpacity={0.8}
            >
              {loadingDecline ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <View style={styles.declineIconCircle}>
                    <Ionicons name="close" size={24} color="#FFFFFF" />
                  </View>
                  <Text style={styles.btnLabel}>Từ chối</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Accept */}
            <TouchableOpacity
              style={[styles.btn, styles.acceptBtn]}
              onPress={handlePressAccept}
              disabled={loadingAccept || loadingDecline}
              activeOpacity={0.8}
            >
              {loadingAccept ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <View style={styles.acceptIconCircle}>
                    <Ionicons name="call" size={22} color="#FFFFFF" />
                  </View>
                  <Text style={[styles.btnLabel, { color: '#FFFFFF', fontWeight: '700' }]}>
                    Tham gia
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 5, 12, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  cardContainer: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#161324',
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: 'rgba(139, 92, 246, 0.3)',
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    shadowColor: '#6027D2',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 25,
    elevation: 20,
    overflow: 'hidden',
  },
  glowBackground: {
    position: 'absolute',
    top: -50,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(96, 39, 210, 0.25)',
  },
  avatarWrapper: {
    width: 130,
    height: 130,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  radarCircle2: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
  },
  radarCircle1: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(96, 39, 210, 0.3)',
  },
  avatarCore: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#6027D2',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#6027D2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 8,
  },
  infoSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#A78BFA',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  callerName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
    paddingHorizontal: 10,
  },
  orderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 5,
    marginBottom: 8,
  },
  orderBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  countdownText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    gap: 14,
    paddingTop: 8,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 20,
    gap: 8,
  },
  declineBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  declineIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  acceptBtn: {
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  acceptIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#059669',
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#EF4444',
  },
});
