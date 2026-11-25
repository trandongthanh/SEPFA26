import React, { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LocationPickerModal } from '../components/LocationPickerModal';
import { customerService } from '../services/customerService';
import { CustomerProfileResponse, UpdateCustomerProfilePayload, VerificationStatus } from '../types/customer';
import { storage } from '../utils/storage';
import { GoogleSignin } from '../utils/googleAuth';
import { socketService } from '../services/socketService';
import { navigationRef } from '../navigation/navigationRef';

// Nhãn trạng thái xác thực — khớp CUSTOMER_STATUS bên trang admin.
const VERIFY_META: Record<
  VerificationStatus,
  { label: string; hint: string; icon: keyof typeof Ionicons.glyphMap; fg: string; bg: string }
> = {
  APPROVED: {
    label: 'Đã xác thực',
    hint: 'Đọc thẻ, kiểm tra người thật và so khớp khuôn mặt đều đạt.',
    icon: 'checkmark-circle',
    fg: '#16A34A',
    bg: '#F0FDF4',
  },
  NOT_SUBMITTED: {
    label: 'Chưa xác thực',
    hint: 'Chưa xác thực thì chưa đặt được gói chăm sóc. Mất khoảng 1 phút.',
    icon: 'alert-circle-outline',
    fg: '#475569',
    bg: '#F1F5F9',
  },
  REJECTED: {
    label: 'eKYC không đạt',
    hint: 'Lần eKYC trước chưa đạt. Chụp lại rõ nét để xác thực.',
    icon: 'close-circle',
    fg: '#E53E3E',
    bg: '#FEF2F2',
  },
  PENDING: {
    label: 'Tự khai, chưa eKYC',
    hint: 'Hồ sơ tự khai trước đây. Làm eKYC để được xác thực.',
    icon: 'time-outline',
    fg: '#B45309',
    bg: '#FFFBEB',
  },
};

interface ProfileScreenProps {
  navigation: any;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ navigation }) => {
  const [profile, setProfile] = useState<CustomerProfileResponse | null>(null);
  const [userName, setUserName] = useState<string>('Khách hàng');
  const [userEmail, setUserEmail] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  // Edit Modal States
  const [isProfileModalVisible, setIsProfileModalVisible] = useState<boolean>(false);
  const [isGoongMapModalVisible, setIsGoongMapModalVisible] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  // Form Fields State
  const [phone, setPhone] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [defaultPickupAddress, setDefaultPickupAddress] = useState<string>('');
  const [gpsLat, setGpsLat] = useState<string>('');
  const [gpsLng, setGpsLng] = useState<string>('');
  const [bankName, setBankName] = useState<string>('');
  const [bankAccount, setBankAccount] = useState<string>('');
  const [bankHolder, setBankHolder] = useState<string>('');

  const [sessionExpired, setSessionExpired] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadProfile();
    setRefreshing(false);
  }, []);

  const loadProfile = async () => {
    setLoading(true);
    try {
      const storedUser = await storage.getUser();
      if (storedUser) {
        setUserName(storedUser.fullName || 'Khách hàng');
        setUserEmail(storedUser.email || '');
      }

      const token = await storage.getToken();
      if (!token) {
        setSessionExpired(true);
        setLoading(false);
        return;
      }

      const res = await customerService.getMyProfile();
      setProfile(res);
      setSessionExpired(false);
      if (res.fullName) setUserName(res.fullName);
      if (res.email) setUserEmail(res.email);

      // Populate edit form initial values
      setPhone(res.phone || '');
      setAddress(res.address || '');
      setDefaultPickupAddress(res.defaultPickupAddress || res.address || '');
      setGpsLat(res.gpsLat ? String(res.gpsLat) : '');
      setGpsLng(res.gpsLng ? String(res.gpsLng) : '');
      setBankName(res.bankName || '');
      setBankAccount(res.bankAccount || '');
      setBankHolder(res.bankHolder || '');
    } catch (err: any) {
      console.error('[ProfileScreen] loadProfile error:', err?.response?.status, err?.response?.data || err?.message || err);
      if (err?.response?.status === 401) {
        setSessionExpired(true);
        Alert.alert(
          'Phiên đăng nhập hết hạn',
          'Phiên đăng nhập của bạn đã hết hạn. Vui lòng đăng xuất và đăng nhập lại để tiếp tục.'
        );
      } else {
        const msg = err?.response?.data?.message || 'Không thể tải thông tin hồ sơ lúc này. Vui lòng thử lại sau.';
        Alert.alert(
          'Không thể tải hồ sơ',
          Array.isArray(msg) ? msg.join('\n') : msg
        );
      }
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [])
  );

  // Open Modal 1: Personal Info & Delivery Profile
  const handleOpenProfileModal = () => {
    if (profile) {
      setPhone(profile.phone || '');
      setAddress(profile.address || '');
      setDefaultPickupAddress(profile.defaultPickupAddress || profile.address || '');
      setGpsLat(profile.gpsLat ? String(profile.gpsLat) : '');
      setGpsLng(profile.gpsLng ? String(profile.gpsLng) : '');
      setBankName(profile.bankName || '');
      setBankAccount(profile.bankAccount || '');
      setBankHolder(profile.bankHolder || '');
    }
    setIsProfileModalVisible(true);
  };

  // Handle location selected from Goong Maps + Leaflet Modal
  const handleSelectLocationFromMap = (loc: { address: string; lat: number; lng: number }) => {
    setGpsLat(String(loc.lat));
    setGpsLng(String(loc.lng));
    if (loc.address) {
      setAddress(loc.address);
      setDefaultPickupAddress(loc.address);
    }
    Alert.alert(
      'Đã chọn vị trí',
      `Địa chỉ: ${loc.address}\nTọa độ: ${loc.lat}, ${loc.lng}`
    );
  };

  // Quick action: Pin default TP.HCM GPS coordinates
  const handlePinDefaultGps = () => {
    setGpsLat('10.776889');
    setGpsLng('106.700806');
    Alert.alert('Ghim vị trí', 'Đã lấy tọa độ GPS trung tâm TP.HCM (10.776889, 106.700806).');
  };

  // Save Modal 1: Personal Profile & Location Info
  const handleSaveProfileInfo = async () => {
    setSaving(true);
    try {
      const payload: UpdateCustomerProfilePayload = {};

      if (phone.trim()) payload.phone = phone.trim();
      if (address.trim()) payload.address = address.trim();
      if (defaultPickupAddress.trim()) payload.defaultPickupAddress = defaultPickupAddress.trim();

      if (gpsLat.trim()) {
        const parsedLat = parseFloat(gpsLat.trim());
        if (!isNaN(parsedLat)) payload.gpsLat = parsedLat;
      }

      if (gpsLng.trim()) {
        const parsedLng = parseFloat(gpsLng.trim());
        if (!isNaN(parsedLng)) payload.gpsLng = parsedLng;
      }

      if (bankName.trim()) payload.bankName = bankName.trim();
      if (bankAccount.trim()) payload.bankAccount = bankAccount.trim();
      if (bankHolder.trim()) payload.bankHolder = bankHolder.trim().toUpperCase();

      const updatedProfile = await customerService.updateMyProfile(payload);
      setProfile(updatedProfile);
      setIsProfileModalVisible(false);
      Alert.alert('Thành công', 'Đã cập nhật thông tin cá nhân & giao nhận!');
      loadProfile();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Có lỗi xảy ra khi cập nhật thông tin.';
      Alert.alert('Lỗi cập nhật', Array.isArray(msg) ? msg.join('\n') : msg);
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert('Đăng xuất', 'Bạn có chắc chắn muốn đăng xuất?', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Đăng xuất',
        style: 'destructive',
        onPress: async () => {
          try {
            if (GoogleSignin && typeof GoogleSignin.signOut === 'function') {
              await GoogleSignin.signOut();
            }
          } catch (_) {
            // Bỏ qua lỗi nếu chưa có tài khoản Google nào
          }

          try {
            socketService.disconnect();
          } catch (_) {}

          try {
            await storage.clearAll();
          } catch (_) {}

          setProfile(null);
          setUserName('Khách hàng');
          setUserEmail('');

          try {
            if (navigationRef.isReady()) {
              navigationRef.reset({
                index: 0,
                routes: [{ name: 'Login' }],
              });
            } else if (navigation?.getParent?.()) {
              navigation.getParent().reset({
                index: 0,
                routes: [{ name: 'Login' }],
              });
            } else if (navigation?.reset) {
              navigation.reset({
                index: 0,
                routes: [{ name: 'Login' }],
              });
            }
          } catch (navErr) {
            console.warn('Logout navigation error:', navErr);
          }
        },
      },
    ]);
  };

  const hasGpsPinned = Boolean(profile?.gpsLat && profile?.gpsLng);
  // Khách chưa làm gì: BE trả NOT_SUBMITTED → không còn hiện nhầm "Chờ duyệt".
  const verificationStatus: VerificationStatus = profile?.verificationStatus || 'NOT_SUBMITTED';
  const isVerified = verificationStatus === 'APPROVED';
  const verifyMeta = VERIFY_META[verificationStatus] || VERIFY_META.NOT_SUBMITTED;

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Hồ sơ cá nhân</Text>
        <TouchableOpacity style={styles.logoutHeaderBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={22} color="#E53E3E" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6027D2" />
          <Text style={styles.loadingText}>Đang tải thông tin hồ sơ...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#6027D2']} tintColor="#6027D2" />
          }
        >
          {/* Cảnh báo phiên đăng nhập hết hạn */}
          {sessionExpired && (
            <View
              style={{
                backgroundColor: '#FEF2F2',
                borderColor: '#F87171',
                borderWidth: 1,
                borderRadius: 12,
                padding: 12,
                marginBottom: 14,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <View style={{ flex: 1, marginRight: 10 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#991B1B' }}>
                  ⚠️ Phiên đăng nhập đã hết hạn
                </Text>
                <Text style={{ fontSize: 11, color: '#B91C1C', marginTop: 2 }}>
                  Vui lòng đăng xuất và đăng nhập lại để làm mới dữ liệu hồ sơ đã xác thực của bạn.
                </Text>
              </View>
              <TouchableOpacity
                onPress={handleLogout}
                style={{
                  backgroundColor: '#DC2626',
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 8,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Đăng xuất</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Top Banner User Profile */}
          <View style={styles.topProfileBar}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{userName.substring(0, 2).toUpperCase()}</Text>
            </View>
            <View style={styles.topProfileInfo}>
              <Text style={styles.userName}>{userName}</Text>
              <Text style={styles.userEmail}>{userEmail}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: verifyMeta.bg }]}>
              <Ionicons name={verifyMeta.icon} size={14} color={verifyMeta.fg} />
              <Text style={[styles.statusBadgeText, { color: verifyMeta.fg }]}>{verifyMeta.label}</Text>
            </View>
          </View>

          {/* Row containing Card 1 & Card 2 (Top Grid) */}
          <View style={styles.topCardsRow}>
            {/* Card 1: Thông tin cá nhân & Giao nhận */}
            <TouchableOpacity
              style={styles.cardContainerHalf}
              activeOpacity={0.9}
              onPress={handleOpenProfileModal}
            >
              <View style={styles.cardHeaderRow}>
                <View style={styles.cardHeaderLeft}>
                  <View style={styles.headerIconCircle}>
                    <Ionicons name="person-outline" size={16} color="#6027D2" />
                  </View>
                  <Text style={styles.cardTitleText} numberOfLines={1}>
                    Thông tin cá nhân & Giao nhận
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#A0AEC0" />
              </View>

              <View style={styles.dividerLine} />

              {/* Row 1: SĐT */}
              <View style={styles.infoRowCompact}>
                <View style={styles.infoIconCircle}>
                  <Ionicons name="call-outline" size={15} color="#6027D2" />
                </View>
                <View style={styles.infoTextContainer}>
                  <Text style={styles.infoLabelText}>Số điện thoại</Text>
                  <Text style={styles.infoValueText} numberOfLines={1}>
                    {profile?.phone || 'Chưa cập nhật'}
                  </Text>
                </View>
              </View>

              {/* Row 2: Địa chỉ thường trú */}
              <View style={styles.infoRowCompact}>
                <View style={styles.infoIconCircle}>
                  <Ionicons name="home-outline" size={15} color="#6027D2" />
                </View>
                <View style={styles.infoTextContainer}>
                  <Text style={styles.infoLabelText}>Địa chỉ thường trú</Text>
                  <Text style={styles.infoValueText} numberOfLines={2}>
                    {profile?.address || 'Chưa cập nhật địa chỉ'}
                  </Text>
                </View>
              </View>

              {/* Row 3: Địa chỉ lấy/nhận cây mặc định */}
              <View style={styles.infoRowCompact}>
                <View style={styles.infoIconCircle}>
                  <Ionicons name="location-outline" size={15} color="#6027D2" />
                </View>
                <View style={styles.infoTextContainer}>
                  <Text style={styles.infoLabelText}>Địa chỉ lấy/nhận cây mặc định</Text>
                  <Text style={styles.infoValueText} numberOfLines={2}>
                    {profile?.defaultPickupAddress || profile?.address || 'Chưa cập nhật địa chỉ mặc định'}
                  </Text>
                </View>
              </View>

              {/* Row 4: Tọa độ GPS */}
              <View style={styles.infoRowCompact}>
                <View style={styles.infoIconCircle}>
                  <Ionicons name="navigate-outline" size={15} color="#6027D2" />
                </View>
                <View style={styles.infoTextContainer}>
                  <Text style={styles.infoLabelText}>Tọa độ GPS đã ghim</Text>
                  {hasGpsPinned ? (
                    <View style={styles.gpsPillBadge}>
                      <Ionicons name="location" size={11} color="#2E7D32" />
                      <Text style={styles.gpsPillText} numberOfLines={1}>
                        {profile?.gpsLat}, {profile?.gpsLng}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.gpsUnpinnedText}>Chưa ghim vị trí GPS</Text>
                  )}
                </View>
              </View>

              {/* Row 5: Tài khoản ngân hàng nhận tiền */}
              <View style={styles.infoRowCompact}>
                <View style={styles.infoIconCircle}>
                  <Ionicons name="card-outline" size={15} color="#6027D2" />
                </View>
                <View style={styles.infoTextContainer}>
                  <Text style={styles.infoLabelText}>Tài khoản ngân hàng nhận tiền</Text>
                  <Text style={styles.infoValueText} numberOfLines={2}>
                    {profile?.bankAccount
                      ? `${profile.bankName || 'Ngân hàng'} - ${profile.bankAccount} (${profile.bankHolder || ''})`
                      : 'Chưa cập nhật tài khoản'}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

            {/* Card 2: Xác thực danh tính (eKYC) */}
            <TouchableOpacity
              style={[styles.cardContainerHalf, { justifyContent: 'space-between' }]}
              activeOpacity={0.9}
              disabled={isVerified}
              onPress={() => navigation.navigate('Ekyc')}
            >
              <View style={styles.cardHeaderRow}>
                <View style={styles.cardHeaderLeft}>
                  <View style={[styles.headerIconCircle, { backgroundColor: '#F5F3FF' }]}>
                    <Ionicons name="finger-print" size={16} color="#6027D2" />
                  </View>
                  <Text style={styles.cardTitleText} numberOfLines={1}>
                    Xác thực danh tính
                  </Text>
                </View>
                {!isVerified && <Ionicons name="chevron-forward" size={16} color="#A0AEC0" />}
              </View>

              <View style={styles.cccdInnerBox}>
                <View style={styles.cccdGraphicContainer}>
                  <View style={[styles.cccdCardIllustration, { backgroundColor: '#EDE9FE' }]}>
                    <Ionicons name="scan" size={30} color="#7C3AED" />
                  </View>
                  <View style={styles.cccdCheckBadge}>
                    <Ionicons name={verifyMeta.icon} size={20} color={verifyMeta.fg} />
                  </View>
                </View>

                <Text style={styles.cccdStatusTitle}>{verifyMeta.label}</Text>
                <Text style={styles.cccdStatusSubtitle}>{verifyMeta.hint}</Text>
              </View>

              {isVerified ? (
                <View style={[styles.softPurpleBtn, { backgroundColor: '#F0FDF4' }]}>
                  <Ionicons name="shield-checkmark" size={14} color="#16A34A" />
                  <Text style={[styles.softPurpleBtnText, { color: '#16A34A' }]}>Đã xác thực bằng eKYC</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.softPurpleBtn, { backgroundColor: '#F5F3FF' }]}
                  onPress={() => navigation.navigate('Ekyc')}
                >
                  <Ionicons name="shield-checkmark-outline" size={14} color="#6027D2" />
                  <Text style={[styles.softPurpleBtnText, { color: '#6027D2' }]}>
                    {verificationStatus === 'REJECTED' ? 'Làm lại eKYC' : 'Xác thực bằng eKYC'}
                  </Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>

          {/* Card 3: Thông tin định danh (chỉ xem — BE tự điền khi eKYC đạt, không lưu số/ảnh CCCD) */}
          <View style={styles.cardContainerFull}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardHeaderLeft}>
                <View style={styles.headerIconCircle}>
                  <Ionicons name="document-text-outline" size={16} color="#6027D2" />
                </View>
                <Text style={styles.cardTitleText}>Thông tin định danh</Text>
              </View>
            </View>
            <View style={styles.dividerLine} />
            {[
              { label: 'Họ tên', value: profile?.fullName },
              { label: 'Ngày sinh', value: profile?.dateOfBirth },
              { label: 'Quê quán', value: profile?.placeOfOrigin },
              { label: 'Địa chỉ thường trú', value: profile?.address },
            ].map((row) => (
              <View key={row.label} style={styles.idRow}>
                <Text style={styles.idRowLabel}>{row.label}</Text>
                <Text style={[styles.idRowValue, !row.value && styles.idRowEmpty]} numberOfLines={2}>
                  {row.value || 'Chưa có'}
                </Text>
              </View>
            ))}
            <Text style={styles.idNote}>
              Lấy tự động từ eKYC. LanCare không lưu số CCCD hay ảnh giấy tờ.
            </Text>
          </View>
        </ScrollView>
      )}

      {/* Modal 1: Edit Personal & Delivery Profile */}
      <Modal
        visible={isProfileModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsProfileModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Cập nhật thông tin cá nhân & Giao nhận</Text>
              <TouchableOpacity onPress={() => setIsProfileModalVisible(false)}>
                <Ionicons name="close-circle" size={24} color="#A0AEC0" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.modalFormScroll}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Số điện thoại:</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="Ví dụ: 0909123456"
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={setPhone}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Địa chỉ thường trú:</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="Ví dụ: 25 Lê Lợi, Quận 1, TP.HCM"
                  value={address}
                  onChangeText={setAddress}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Địa chỉ lấy/nhận cây mặc định:</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="Địa chỉ giao nhận khi đặt gói dịch vụ"
                  value={defaultPickupAddress}
                  onChangeText={setDefaultPickupAddress}
                />
              </View>

              <View style={styles.gpsSectionCard}>
                <View style={styles.gpsHeaderRow}>
                  <Ionicons name="pin-outline" size={18} color="#6027D2" />
                  <Text style={styles.gpsSectionTitle}>Ghim tọa độ GPS (Tính phí đi lại):</Text>
                </View>

                <TouchableOpacity
                  style={[styles.quickGpsButton, { backgroundColor: '#6027D2', marginTop: 8 }]}
                  activeOpacity={0.8}
                  onPress={() => setIsGoongMapModalVisible(true)}
                >
                  <Ionicons name="map-outline" size={18} color="#FFFFFF" />
                  <Text style={[styles.quickGpsButtonText, { color: '#FFFFFF', fontWeight: '700' }]}>
                    🗺️ Chọn & Ghim trên Bản đồ Goong Maps
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.quickGpsButton, { marginTop: 6 }]}
                  activeOpacity={0.8}
                  onPress={handlePinDefaultGps}
                >
                  <Ionicons name="locate" size={16} color="#6027D2" />
                  <Text style={styles.quickGpsButtonText}>📍 Ghim vị trí mặc định (TP.HCM)</Text>
                </TouchableOpacity>

                <View style={styles.gpsInputsRow}>
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.inputSubLabel}>Vĩ độ (Lat):</Text>
                    <TextInput
                      style={styles.textInputSmall}
                      placeholder="10.776889"
                      keyboardType="numeric"
                      value={gpsLat}
                      onChangeText={setGpsLat}
                    />
                  </View>

                  <View style={[styles.inputGroup, { flex: 1, marginLeft: 10 }]}>
                    <Text style={styles.inputSubLabel}>Kinh độ (Lng):</Text>
                    <TextInput
                      style={styles.textInputSmall}
                      placeholder="106.700806"
                      keyboardType="numeric"
                      value={gpsLng}
                      onChangeText={setGpsLng}
                    />
                  </View>
                </View>
              </View>

              {/* Tài khoản ngân hàng nhận tiền bồi hoàn / hoàn tiền */}
              <View style={[styles.gpsSectionCard, { marginTop: 14, backgroundColor: '#FAF5FF', borderColor: '#E9D8FD' }]}>
                <View style={styles.gpsHeaderRow}>
                  <Ionicons name="card-outline" size={18} color="#6027D2" />
                  <Text style={[styles.gpsSectionTitle, { color: '#6027D2' }]}>
                    Tài khoản ngân hàng nhận tiền:
                  </Text>
                </View>
                <Text style={{ fontSize: 11, color: '#6B7280', marginTop: 4, marginBottom: 10 }}>
                  Dùng để nhận tiền hoàn hủy đơn hoặc tiền bồi thường khi phát sinh khiếu nại tranh chấp.
                </Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputSubLabel}>Tên ngân hàng:</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Ví dụ: Vietcombank, MB Bank, Techcombank..."
                    value={bankName}
                    onChangeText={setBankName}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputSubLabel}>Số tài khoản:</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Ví dụ: 0123456789"
                    keyboardType="numeric"
                    value={bankAccount}
                    onChangeText={setBankAccount}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputSubLabel}>Tên chủ tài khoản (in hoa không dấu):</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Ví dụ: NGUYEN VAN A"
                    autoCapitalize="characters"
                    value={bankHolder}
                    onChangeText={setBankHolder}
                  />
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelModalButton}
                onPress={() => setIsProfileModalVisible(false)}
              >
                <Text style={styles.cancelModalButtonText}>Hủy</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.saveModalButton}
                activeOpacity={0.8}
                onPress={handleSaveProfileInfo}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.saveModalButtonText}>Lưu thông tin</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>


      {/* Goong Maps Interactive Picker Modal */}
      <LocationPickerModal
        visible={isGoongMapModalVisible}
        onClose={() => setIsGoongMapModalVisible(false)}
        onSelectLocation={handleSelectLocationFromMap}
        initialLat={gpsLat ? parseFloat(gpsLat) : 10.776889}
        initialLng={gpsLng ? parseFloat(gpsLng) : 106.700806}
      />

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  idRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  idRowLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  idRowValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '600',
    color: '#1E293B',
  },
  idRowEmpty: {
    color: '#94A3B8',
    fontWeight: '400',
  },
  idNote: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 8,
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A202C',
  },
  logoutHeaderBtn: {
    padding: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 14,
    color: '#718096',
  },
  scrollContent: {
    padding: 12,
  },

  // Top User Profile Bar
  topProfileBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#6027D2',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  topProfileInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A202C',
  },
  userEmail: {
    fontSize: 12,
    color: '#718096',
    marginTop: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
  },
  approvedBadge: {
    backgroundColor: '#E8F5E9',
  },
  approvedBadgeText: {
    color: '#2E7D32',
    fontSize: 11,
    fontWeight: '700',
  },
  pendingBadge: {
    backgroundColor: '#FEFCBF',
  },
  pendingBadgeText: {
    color: '#D69E2E',
    fontSize: 11,
    fontWeight: '700',
  },
  rejectedBadge: {
    backgroundColor: '#FED7D7',
  },
  rejectedBadgeText: {
    color: '#E53E3E',
    fontSize: 11,
    fontWeight: '700',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // Top Grid Row (Card 1 & Card 2)
  topCardsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  cardContainerHalf: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },

  // Card Header Common
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  headerIconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#F3E8FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardTitleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E1B4B',
    flex: 1,
  },
  dividerLine: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 6,
  },

  // Card 1 Details
  infoRowCompact: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 6,
    gap: 8,
  },
  infoIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#F3E8FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  infoTextContainer: {
    flex: 1,
  },
  infoLabelText: {
    fontSize: 11,
    color: '#64748B',
  },
  infoValueText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E293B',
    marginTop: 1,
  },
  gpsPillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    gap: 4,
    marginTop: 3,
    alignSelf: 'flex-start',
  },
  gpsPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
  },
  gpsUnpinnedText: {
    fontSize: 11,
    color: '#EF4444',
    fontStyle: 'italic',
    marginTop: 2,
  },

  // Card 2 Details
  cccdInnerBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  cccdGraphicContainer: {
    position: 'relative',
    marginBottom: 6,
  },
  cccdCardIllustration: {
    width: 52,
    height: 40,
    backgroundColor: '#EDE9FE',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cccdCheckBadge: {
    position: 'absolute',
    bottom: -2,
    right: -4,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
  },
  cccdStatusTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E1B4B',
    textAlign: 'center',
  },
  cccdStatusSubtitle: {
    fontSize: 10,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 2,
  },
  softPurpleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3E8FF',
    borderRadius: 10,
    paddingVertical: 8,
    gap: 4,
  },
  softPurpleBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6027D2',
  },

  // Card 3: Full Width
  cardContainerFull: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  docsStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3E8FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
  },
  docsStatusPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6027D2',
  },
  thumbnailsRow: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 10,
  },
  thumbnailCard: {
    flex: 1,
    height: 86,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#F1F5F9',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  thumbnailImg: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  thumbnailPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailOverlayBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingVertical: 4,
    paddingHorizontal: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  thumbnailOverlayText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
    flex: 1,
  },
  fullWidthUpdateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F3E8FF',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  fullWidthUpdateBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6027D2',
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1A202C',
  },
  modalFormScroll: {
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4A5568',
    marginBottom: 6,
  },
  inputSubLabel: {
    fontSize: 12,
    color: '#718096',
    marginBottom: 4,
  },
  textInput: {
    backgroundColor: '#F7FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#2D3748',
  },
  textInputSmall: {
    backgroundColor: '#F7FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#2D3748',
  },
  gpsSectionCard: {
    backgroundColor: '#F6F4FC',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E8DEFD',
    marginBottom: 16,
  },
  gpsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  gpsSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#3B1578',
  },
  quickGpsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#6027D2',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
    gap: 6,
  },
  quickGpsButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6027D2',
  },
  gpsInputsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  uploadDocSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  docSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A202C',
    marginBottom: 4,
  },
  docSectionSubtitle: {
    fontSize: 12,
    color: '#718096',
    marginBottom: 12,
  },
  uploadCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  uploadCardLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2D3748',
    marginBottom: 8,
  },
  uploadedImagePreview: {
    width: '100%',
    height: 120,
    borderRadius: 8,
    marginBottom: 8,
    resizeMode: 'cover',
  },
  selectImageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F6F4FC',
    borderWidth: 1,
    borderColor: '#6027D2',
    borderRadius: 10,
    paddingVertical: 10,
    gap: 6,
  },
  selectImageBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6027D2',
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelModalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#EDF2F7',
    alignItems: 'center',
  },
  cancelModalButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4A5568',
  },
  saveModalButton: {
    flex: 1.5,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#6027D2',
    alignItems: 'center',
  },
  saveModalButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Document Fullscreen Preview Modal Styles
  docPreviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  docPreviewContainer: {
    width: '100%',
    maxHeight: '85%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  docPreviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FAF8FC',
  },
  docPreviewTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E1B2E',
  },
  docPreviewBody: {
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 260,
    backgroundColor: '#0F172A',
  },
  docPreviewCenter: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docPreviewLoadingText: {
    marginTop: 12,
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
  },
  docPreviewImage: {
    width: '100%',
    height: 320,
    borderRadius: 8,
  },
});

