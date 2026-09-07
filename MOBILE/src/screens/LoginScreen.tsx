import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../config/api';

interface LoginScreenProps {
  navigation?: any;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Thông báo', 'Vui lòng nhập đầy đủ Email và Mật khẩu.');
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post('/auth/login', {
        email: email.trim().toLowerCase(),
        password,
      });

      const { account } = response.data;
      Alert.alert(
        'Đăng nhập thành công',
        `Xin chào, ${account.fullName || account.email} (${account.role})!`
      );
    } catch (err: any) {
      const msg = err.response?.data?.message;
      if (msg === 'INVALID_CREDENTIALS') {
        Alert.alert('Đăng nhập thất bại', 'Email hoặc mật khẩu không chính xác.');
      } else if (msg === 'ACCOUNT_SUSPENDED') {
        Alert.alert('Tài khoản bị khóa', 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ hỗ trợ.');
      } else if (msg === 'ACCOUNT_INACTIVE') {
        Alert.alert('Tài khoản chờ duyệt', 'Tài khoản Provider của bạn đang chờ Admin phê duyệt.');
      } else {
        Alert.alert('Lỗi đăng nhập', 'Có lỗi xảy ra, vui lòng thử lại.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardContainer}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Header Banner */}
          <View style={styles.headerContainer}>
            <View style={styles.headerTextSection}>
              {/* Brand Logo Row */}
              <View style={styles.logoRow}>
                <Image
                  source={require('../../assets/images/logo_app.png')}
                  style={styles.appLogo}
                  resizeMode="contain"
                />
                <Text style={styles.brandTitle}>
                  <Text style={styles.brandLanCare}>LanCare</Text>
                  <Text style={styles.brandHub}> Hub</Text>
                </Text>
              </View>
              <Text style={styles.tagline}>
                Ứng dụng chăm sóc sức khỏe tiện lợi, an toàn và đáng tin cậy dành cho bạn.
              </Text>
            </View>

            {/* Decorative Orchid Pot (reg2.png) & 3 Feature Badges */}
            <View style={styles.illustrationWrapper}>
              <View style={styles.illustrationGlowCircle}>
                <Image
                  source={require('../../assets/images/reg2.png')}
                  style={styles.orchidPotImage}
                  resizeMode="contain"
                />
                
                {/* Badge 1: Water */}
                <View style={styles.waterBadge}>
                  <Ionicons name="water-outline" size={14} color="#6C38FF" />
                </View>

                {/* Badge 2: Leaf */}
                <View style={styles.leafBadge}>
                  <Ionicons name="leaf-outline" size={14} color="#2E7D32" />
                </View>

                {/* Badge 3: Sun */}
                <View style={styles.sunBadge}>
                  <Ionicons name="sunny-outline" size={14} color="#7C3AED" />
                </View>
              </View>
            </View>
          </View>

          {/* Floating Petal near Header (reg3.png) */}
          <Image
            source={require('../../assets/images/reg3.png')}
            style={styles.headerPetal}
            resizeMode="contain"
          />

          {/* Main Form Card */}
          <View style={styles.card}>
            {/* Top Left Leaf Accent (reg4.png) */}
            <Image
              source={require('../../assets/images/reg4.png')}
              style={styles.topLeftLeaf}
              resizeMode="contain"
            />

            {/* Top Right Petal Accent on Card (reg3.png) */}
            <Image
              source={require('../../assets/images/reg3.png')}
              style={styles.cardTopPetal}
              resizeMode="contain"
            />

            {/* Form Title & Subtitle */}
            <Text style={styles.cardTitle}>Đăng nhập</Text>
            <Text style={styles.cardSubtitle}>
              Nhập thông tin của bạn để truy cập hệ thống LanCare Hub
            </Text>

            {/* Email Field */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email</Text>
              <View
                style={[
                  styles.inputBox,
                  focusedField === 'email' && styles.inputBoxFocused,
                ]}
              >
                <Ionicons
                  name="mail-outline"
                  size={20}
                  color={focusedField === 'email' ? '#6025D2' : '#9E91B6'}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.textInput}
                  placeholder="Nhập email của bạn"
                  placeholderTextColor="#A599BE"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(null)}
                />
              </View>
            </View>

            {/* Password Field */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Mật khẩu</Text>
              <View
                style={[
                  styles.inputBox,
                  focusedField === 'password' && styles.inputBoxFocused,
                ]}
              >
                <Ionicons
                  name="lock-closed-outline"
                  size={20}
                  color={focusedField === 'password' ? '#6025D2' : '#9E91B6'}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.textInput}
                  placeholder="Nhập mật khẩu"
                  placeholderTextColor="#A599BE"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons
                    name={showPassword ? 'eye-outline' : 'eye-off-outline'}
                    size={20}
                    color="#9E91B6"
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              activeOpacity={0.88}
              style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <View style={styles.submitBtnContent}>
                  <Ionicons name="log-in-outline" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                  <Text style={styles.submitBtnText}>Đăng nhập</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Bottom Section inside Card */}
            <View style={styles.cardFooter}>
              <Text style={styles.footerText}>Chưa có tài khoản?</Text>
              <TouchableOpacity
                style={styles.navLinkButton}
                onPress={() => navigation?.navigate('Register')}
              >
                <Text style={styles.navLinkText}>Đăng ký ngay</Text>
                <Ionicons name="arrow-forward-outline" size={16} color="#6025D2" style={{ marginLeft: 4 }} />
              </TouchableOpacity>
            </View>

            {/* Bottom Left Orchid Flower Branch (reg1.png) */}
            <Image
              source={require('../../assets/images/reg1.png')}
              style={styles.bottomOrchidBranch}
              resizeMode="contain"
            />

            {/* Bottom Right Floating Petal (reg3.png) */}
            <Image
              source={require('../../assets/images/reg3.png')}
              style={styles.bottomRightPetal}
              resizeMode="contain"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F4FC',
  },
  keyboardContainer: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: Platform.OS === 'android' ? 24 : 16,
    position: 'relative',
  },

  /* Header Section */
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
  },
  headerTextSection: {
    flex: 1,
    paddingRight: 8,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  appLogo: {
    width: 44,
    height: 44,
    marginRight: 8,
  },
  brandTitle: {
    fontSize: 23,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  brandLanCare: {
    color: '#1C0947',
    fontWeight: '900',
  },
  brandHub: {
    color: '#8326D4',
    fontWeight: '800',
  },
  tagline: {
    fontSize: 12,
    color: '#5B4B78',
    lineHeight: 16.5,
    fontWeight: '500',
  },

  /* Top Right Illustration with reg2.png & 3 Badges */
  illustrationWrapper: {
    width: 140,
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
  },
  illustrationGlowCircle: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: '#EFEBFB',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  orchidPotImage: {
    width: 115,
    height: 115,
    marginTop: -5,
  },
  waterBadge: {
    position: 'absolute',
    top: 14,
    left: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  leafBadge: {
    position: 'absolute',
    top: 26,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sunBadge: {
    position: 'absolute',
    bottom: 14,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },

  /* Ambient Accents Outside Card */
  headerPetal: {
    position: 'absolute',
    top: 125,
    right: 145,
    width: 24,
    height: 24,
    transform: [{ rotate: '40deg' }],
    pointerEvents: 'none',
  },
  topLeftLeaf: {
    position: 'absolute',
    top: -16,
    left: -14,
    width: 48,
    height: 48,
    transform: [{ rotate: '-25deg' }],
    zIndex: 10,
    pointerEvents: 'none',
  },

  /* Main Form Card */
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    marginHorizontal: 16,
    padding: 22,
    shadowColor: '#6B46C1',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 4,
    position: 'relative',
    overflow: 'hidden',
  },
  cardTopPetal: {
    position: 'absolute',
    top: 14,
    right: 16,
    width: 36,
    height: 36,
    transform: [{ rotate: '-15deg' }],
    pointerEvents: 'none',
  },
  cardTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1C0B3B',
    letterSpacing: -0.5,
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#635480',
    marginTop: 4,
    marginBottom: 20,
    fontWeight: '500',
  },

  /* Form Fields */
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1C0B3B',
    marginBottom: 8,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#EBE4F7',
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 50,
    backgroundColor: '#FAF7FE',
  },
  inputBoxFocused: {
    borderColor: '#7C2AE8',
    backgroundColor: '#FFFFFF',
  },
  inputIcon: {
    marginRight: 12,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    color: '#1C0B3B',
    fontWeight: '500',
    height: '100%',
  },

  /* Primary Button */
  submitBtn: {
    backgroundColor: '#6025D2',
    height: 52,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#6025D2',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 4,
  },
  submitBtnDisabled: {
    opacity: 0.7,
  },
  submitBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },

  /* Footer Navigation */
  cardFooter: {
    alignItems: 'center',
    marginTop: 22,
    marginBottom: 6,
    zIndex: 2,
  },
  footerText: {
    fontSize: 13,
    color: '#7E709A',
    fontWeight: '500',
    marginBottom: 4,
  },
  navLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  navLinkText: {
    color: '#5F24D0',
    fontSize: 15,
    fontWeight: '700',
  },

  /* Bottom Left Orchid Branch (reg1.png) */
  bottomOrchidBranch: {
    position: 'absolute',
    bottom: -10,
    left: -15,
    width: 145,
    height: 145,
    zIndex: 1,
    pointerEvents: 'none',
  },

  /* Bottom Right Petal (reg3.png) */
  bottomRightPetal: {
    position: 'absolute',
    bottom: 24,
    right: 18,
    width: 30,
    height: 30,
    transform: [{ rotate: '25deg' }],
    zIndex: 1,
    pointerEvents: 'none',
  },
});
