import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { customerService } from '../services/customerService';
import { CustomerProfileResponse } from '../types/customer';
import { storage } from '../utils/storage';

interface ProfileScreenProps {
  navigation: any;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ navigation }) => {
  const [profile, setProfile] = useState<CustomerProfileResponse | null>(null);
  const [userName, setUserName] = useState<string>('Khách hàng');
  const [userEmail, setUserEmail] = useState<string>('');

  useEffect(() => {
    const loadProfile = async () => {
      const storedUser = await storage.getUser();
      if (storedUser) {
        setUserName(storedUser.fullName || 'Khách hàng');
        setUserEmail(storedUser.email || '');
      }

      const token = await storage.getToken();
      if (!token) return;

      try {
        const res = await customerService.getMyProfile();
        setProfile(res);
        if (res.fullName) setUserName(res.fullName);
        if (res.email) setUserEmail(res.email);
      } catch (err: any) {
        if (err?.response?.status !== 401) {
          console.log('Customer profile info:', err?.message || err);
        }
      }
    };

    loadProfile();
  }, []);

  const handleLogout = async () => {
    Alert.alert('Đăng xuất', 'Bạn có chắc chắn muốn đăng xuất?', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Đăng xuất',
        style: 'destructive',
        onPress: async () => {
          await storage.clearAll();
          navigation.getParent()?.reset({
            index: 0,
            routes: [{ name: 'Login' }],
          }) || navigation.reset({
            index: 0,
            routes: [{ name: 'Login' }],
          });
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Hồ sơ cá nhân</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.profileCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>
              {userName.substring(0, 2).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.userName}>{userName}</Text>
          <Text style={styles.userEmail}>{userEmail}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Thông tin cá nhân</Text>

          <View style={styles.infoRow}>
            <Ionicons name="call-outline" size={20} color="#6027D2" />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Số điện thoại</Text>
              <Text style={styles.infoValue}>
                {profile?.phone || 'Chưa cập nhật'}
              </Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={20} color="#6027D2" />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Địa chỉ của tôi</Text>
              <Text style={styles.infoValue}>
                {profile?.address || 'Chưa cập nhật địa chỉ'}
              </Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="shield-checkmark-outline" size={20} color="#6027D2" />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Trạng thái tài khoản</Text>
              <Text style={styles.infoValue}>
                {profile?.verificationStatus === 'APPROVED'
                  ? 'Đã xác thực ✅'
                  : 'Chưa xác thực'}
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={styles.logoutButton}
          activeOpacity={0.8}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={20} color="#E53E3E" />
          <Text style={styles.logoutText}>Đăng xuất tài khoản</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F4FC',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A202C',
  },
  scrollContent: {
    padding: 16,
  },
  profileCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  avatarCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#6027D2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  userName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A202C',
  },
  userEmail: {
    fontSize: 13,
    color: '#718096',
    marginTop: 2,
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4A5568',
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
    gap: 12,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    color: '#A0AEC0',
  },
  infoValue: {
    fontSize: 14,
    color: '#2D3748',
    fontWeight: '500',
    marginTop: 2,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#FEB2B2',
    borderRadius: 14,
    paddingVertical: 12,
    gap: 8,
    marginTop: 8,
  },
  logoutText: {
    color: '#E53E3E',
    fontSize: 15,
    fontWeight: '700',
  },
});
