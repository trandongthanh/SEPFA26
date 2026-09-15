import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LocationPickerModal } from '../components/LocationPickerModal';
import { customerService } from '../services/customerService';
import { uploadService } from '../services/uploadService';
import { CustomerProfileResponse, UpdateCustomerProfilePayload } from '../types/customer';
import { storage } from '../utils/storage';

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
  const [isCccdModalVisible, setIsCccdModalVisible] = useState<boolean>(false);
  const [isGoongMapModalVisible, setIsGoongMapModalVisible] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  // Form Fields State
  const [phone, setPhone] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [defaultPickupAddress, setDefaultPickupAddress] = useState<string>('');
  const [gpsLat, setGpsLat] = useState<string>('');
  const [gpsLng, setGpsLng] = useState<string>('');

  // CCCD Verification Image URLs & Number
  const [cccdNumber, setCccdNumber] = useState<string>('');
  const [cccdFrontUrl, setCccdFrontUrl] = useState<string>('');
  const [cccdBackUrl, setCccdBackUrl] = useState<string>('');
  const [selfieWithIdUrl, setSelfieWithIdUrl] = useState<string>('');
  const [uploadingType, setUploadingType] = useState<'front' | 'back' | 'selfie' | null>(null);

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
        setLoading(false);
        return;
      }

      const res = await customerService.getMyProfile();
      setProfile(res);
      if (res.fullName) setUserName(res.fullName);
      if (res.email) setUserEmail(res.email);

      // Populate edit form initial values
      setPhone(res.phone || '');
      setAddress(res.address || '');
      setDefaultPickupAddress(res.defaultPickupAddress || res.address || '');
      setGpsLat(res.gpsLat ? String(res.gpsLat) : '');
      setGpsLng(res.gpsLng ? String(res.gpsLng) : '');
      setCccdNumber(res.cccdNumber || '');
      setCccdFrontUrl(res.cccdFrontUrl || '');
      setCccdBackUrl(res.cccdBackUrl || '');
      setSelfieWithIdUrl(res.selfieWithIdUrl || '');
    } catch (err: any) {
      if (err?.response?.status !== 401) {
        console.log('Customer profile info:', err?.message || err);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  // Open Modal 1: Personal Info & Delivery Profile
  const handleOpenProfileModal = () => {
    if (profile) {
      setPhone(profile.phone || '');
      setAddress(profile.address || '');
      setDefaultPickupAddress(profile.defaultPickupAddress || profile.address || '');
      setGpsLat(profile.gpsLat ? String(profile.gpsLat) : '');
      setGpsLng(profile.gpsLng ? String(profile.gpsLng) : '');
    }
    setIsProfileModalVisible(true);
  };

  // Open Modal 2: CCCD Documents Upload
  const handleOpenCccdModal = () => {
    if (profile) {
      setCccdNumber(profile.cccdNumber || '');
      setCccdFrontUrl(profile.cccdFrontUrl || '');
      setCccdBackUrl(profile.cccdBackUrl || '');
      setSelfieWithIdUrl(profile.selfieWithIdUrl || '');
    }
    setIsCccdModalVisible(true);
  };

  // Upload image handler via Camera or Library
  const processImageResult = async (result: ImagePicker.ImagePickerResult, type: 'front' | 'back' | 'selfie') => {
    if (!result.canceled && result.assets && result.assets.length > 0) {
      const uri = result.assets[0].uri;
      setUploadingType(type);
      try {
        const uploadedUrl = await uploadService.uploadDocumentImage(uri);
        if (type === 'front') setCccdFrontUrl(uploadedUrl);
        if (type === 'back') setCccdBackUrl(uploadedUrl);
        if (type === 'selfie') setSelfieWithIdUrl(uploadedUrl);
        Alert.alert('Tải ảnh thành công', 'Đã tải ảnh giấy tờ lên hệ thống!');
      } catch (err: any) {
        console.error('Upload document error:', err);
        Alert.alert('Lỗi tải ảnh', err?.response?.data?.message || err?.message || 'Không thể tải ảnh lên.');
      } finally {
        setUploadingType(null);
      }
    }
  };

  // Pick or Capture CCCD / Selfie Document Image
  const handlePickDocument = (type: 'front' | 'back' | 'selfie') => {
    Alert.alert(
      'Tải ảnh xác minh CCCD',
      'Vui lòng chọn phương thức tải ảnh:',
      [
        {
          text: '📷 Chụp ảnh bằng Camera',
          onPress: async () => {
            try {
              const permission = await ImagePicker.requestCameraPermissionsAsync();
              if (!permission.granted) {
                Alert.alert('Cần quyền truy cập', 'Vui lòng cấp quyền máy ảnh để chụp ảnh CCCD.');
                return;
              }
              const result = await ImagePicker.launchCameraAsync({
                allowsEditing: true,
                quality: 0.8,
              });
              await processImageResult(result, type);
            } catch (err: any) {
              Alert.alert('Lỗi camera', err?.message || 'Không thể mở máy ảnh.');
            }
          },
        },
        {
          text: '🖼️ Chọn từ thư viện ảnh',
          onPress: async () => {
            try {
              const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
              if (!permission.granted) {
                Alert.alert('Cần quyền truy cập', 'Vui lòng cấp quyền thư viện ảnh để chọn ảnh CCCD.');
                return;
              }
              const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                quality: 0.8,
              });
              await processImageResult(result, type);
            } catch (err: any) {
              Alert.alert('Lỗi thư viện ảnh', err?.message || 'Không thể mở thư viện ảnh.');
            }
          },
        },
        {
          text: 'Hủy',
          style: 'cancel',
        },
      ]
    );
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

  // Save Modal 2: CCCD Images & Number
  const handleSaveCccdDocs = async () => {
    const trimmedNumber = cccdNumber.trim();
    if (!trimmedNumber || !/^\d{12}$/.test(trimmedNumber)) {
      Alert.alert('Số CCCD không hợp lệ', 'Vui lòng nhập đúng 12 chữ số Căn cước công dân!');
      return;
    }
    if (!cccdFrontUrl || !cccdBackUrl || !selfieWithIdUrl) {
      Alert.alert('Chưa đủ 3 ảnh', 'Vui lòng tải lên đầy đủ 3 ảnh (Mặt trước, Mặt sau và Selfie cầm CCCD) trước khi gửi xác minh!');
      return;
    }
    setSaving(true);
    try {
      const payload: UpdateCustomerProfilePayload = {
        cccdNumber: trimmedNumber,
        cccdFrontUrl: cccdFrontUrl.trim(),
        cccdBackUrl: cccdBackUrl.trim(),
        selfieWithIdUrl: selfieWithIdUrl.trim(),
      };

      const updatedProfile = await customerService.updateMyProfile(payload);
      setProfile(updatedProfile);
      setIsCccdModalVisible(false);
      Alert.alert('Thành công', 'Đã gửi thông tin CCCD cho Admin duyệt!');
      loadProfile();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Có lỗi xảy ra khi gửi xác minh CCCD.';
      Alert.alert('Lỗi xác minh', Array.isArray(msg) ? msg.join('\n') : msg);
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

  const hasGpsPinned = Boolean(profile?.gpsLat && profile?.gpsLng);
  const isVerified = profile?.verificationStatus === 'APPROVED';
  const hasUploadedDocs = Boolean(profile?.cccdFrontUrl && profile?.cccdBackUrl && profile?.selfieWithIdUrl);

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
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Top Banner User Profile */}
          <View style={styles.topProfileBar}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{userName.substring(0, 2).toUpperCase()}</Text>
            </View>
            <View style={styles.topProfileInfo}>
              <Text style={styles.userName}>{userName}</Text>
              <Text style={styles.userEmail}>{userEmail}</Text>
            </View>
            <View
              style={[
                styles.statusBadge,
                isVerified
                  ? styles.approvedBadge
                  : profile?.verificationStatus === 'REJECTED'
                  ? styles.rejectedBadge
                  : styles.pendingBadge,
              ]}
            >
              <Ionicons
                name={
                  isVerified
                    ? 'checkmark-circle'
                    : profile?.verificationStatus === 'REJECTED'
                    ? 'close-circle'
                    : 'time-outline'
                }
                size={14}
                color={
                  isVerified
                    ? '#2E7D32'
                    : profile?.verificationStatus === 'REJECTED'
                    ? '#E53E3E'
                    : '#D69E2E'
                }
              />
              <Text
                style={[
                  styles.statusBadgeText,
                  isVerified
                    ? styles.approvedBadgeText
                    : profile?.verificationStatus === 'REJECTED'
                    ? styles.rejectedBadgeText
                    : styles.pendingBadgeText,
                ]}
              >
                {isVerified
                  ? 'Đã xác thực'
                  : profile?.verificationStatus === 'REJECTED'
                  ? 'Bị từ chối'
                  : 'Chờ duyệt'}
              </Text>
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
            </TouchableOpacity>

            {/* Card 2: Cập nhật CCCD */}
            <TouchableOpacity
              style={[styles.cardContainerHalf, { justifyContent: 'space-between' }]}
              activeOpacity={0.9}
              onPress={handleOpenCccdModal}
            >
              <View style={styles.cardHeaderRow}>
                <View style={styles.cardHeaderLeft}>
                  <View style={styles.headerIconCircle}>
                    <Ionicons name="card-outline" size={16} color="#6027D2" />
                  </View>
                  <Text style={styles.cardTitleText} numberOfLines={1}>
                    Cập nhật CCCD
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#A0AEC0" />
              </View>

              <View style={styles.cccdInnerBox}>
                <View style={styles.cccdGraphicContainer}>
                  <View style={styles.cccdCardIllustration}>
                    <Ionicons name="id-card-outline" size={32} color="#8B5CF6" />
                  </View>
                  <View style={styles.cccdCheckBadge}>
                    <Ionicons
                      name={
                        isVerified
                          ? 'checkmark-circle'
                          : profile?.verificationStatus === 'REJECTED'
                          ? 'close-circle'
                          : 'time'
                      }
                      size={20}
                      color={
                        isVerified
                          ? '#22C55E'
                          : profile?.verificationStatus === 'REJECTED'
                          ? '#EF4444'
                          : '#F59E0B'
                      }
                    />
                  </View>
                </View>

                <Text style={styles.cccdStatusTitle}>
                  {isVerified
                    ? 'Đã cập nhật thông tin CCCD'
                    : profile?.verificationStatus === 'REJECTED'
                    ? 'Hồ sơ bị từ chối'
                    : hasUploadedDocs
                    ? 'Đang chờ Admin duyệt'
                    : 'Chưa cập nhật CCCD'}
                </Text>

                <Text style={styles.cccdStatusSubtitle}>
                  {profile?.cccdNumber
                    ? `Mã CCCD: ${profile.cccdNumber}`
                    : isVerified
                    ? 'Thông tin của bạn đã được xác thực'
                    : profile?.verificationStatus === 'REJECTED'
                    ? profile.verificationNote || 'Vui lòng tải lại ảnh giấy tờ'
                    : hasUploadedDocs
                    ? 'Hệ thống đang xử lý hồ sơ'
                    : 'Tải ảnh CCCD để xác thực'}
                </Text>
              </View>

              <TouchableOpacity style={styles.softPurpleBtn} onPress={handleOpenCccdModal}>
                <Ionicons name="create-outline" size={14} color="#6027D2" />
                <Text style={styles.softPurpleBtnText}>
                  {hasUploadedDocs ? 'Xem thông tin' : 'Cập nhật ngay'}
                </Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </View>

          {/* Card 3: Hình ảnh CCCD */}
          <View style={styles.cardContainerFull}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardHeaderLeft}>
                <View style={styles.headerIconCircle}>
                  <Ionicons name="image-outline" size={16} color="#6027D2" />
                </View>
                <Text style={styles.cardTitleText}>Hình ảnh CCCD</Text>
              </View>

              <View style={styles.docsStatusPill}>
                <Ionicons
                  name={hasUploadedDocs ? 'checkmark' : 'alert'}
                  size={12}
                  color={hasUploadedDocs ? '#6027D2' : '#D69E2E'}
                />
                <Text style={styles.docsStatusPillText}>
                  {hasUploadedDocs ? 'Đã cập nhật' : 'Chưa đủ 3 ảnh'}
                </Text>
              </View>
            </View>

            {/* 3 Thumbnail Previews */}
            <View style={styles.thumbnailsRow}>
              {/* Thumbnail 1: Mặt trước */}
              <TouchableOpacity
                style={styles.thumbnailCard}
                activeOpacity={0.85}
                onPress={handleOpenCccdModal}
              >
                {profile?.cccdFrontUrl ? (
                  <Image source={{ uri: profile.cccdFrontUrl }} style={styles.thumbnailImg} />
                ) : (
                  <View style={styles.thumbnailPlaceholder}>
                    <Ionicons name="id-card-outline" size={26} color="#CBD5E0" />
                  </View>
                )}
                <View style={styles.thumbnailOverlayBar}>
                  <Text style={styles.thumbnailOverlayText} numberOfLines={1}>
                    Mặt trước
                  </Text>
                  <Ionicons name="chevron-forward" size={12} color="#FFFFFF" />
                </View>
              </TouchableOpacity>

              {/* Thumbnail 2: Mặt sau */}
              <TouchableOpacity
                style={styles.thumbnailCard}
                activeOpacity={0.85}
                onPress={handleOpenCccdModal}
              >
                {profile?.cccdBackUrl ? (
                  <Image source={{ uri: profile.cccdBackUrl }} style={styles.thumbnailImg} />
                ) : (
                  <View style={styles.thumbnailPlaceholder}>
                    <Ionicons name="card-outline" size={26} color="#CBD5E0" />
                  </View>
                )}
                <View style={styles.thumbnailOverlayBar}>
                  <Text style={styles.thumbnailOverlayText} numberOfLines={1}>
                    Mặt sau
                  </Text>
                  <Ionicons name="chevron-forward" size={12} color="#FFFFFF" />
                </View>
              </TouchableOpacity>

              {/* Thumbnail 3: Ảnh chân dung */}
              <TouchableOpacity
                style={styles.thumbnailCard}
                activeOpacity={0.85}
                onPress={handleOpenCccdModal}
              >
                {profile?.selfieWithIdUrl ? (
                  <Image source={{ uri: profile.selfieWithIdUrl }} style={styles.thumbnailImg} />
                ) : (
                  <View style={styles.thumbnailPlaceholder}>
                    <Ionicons name="person-outline" size={26} color="#CBD5E0" />
                  </View>
                )}
                <View style={styles.thumbnailOverlayBar}>
                  <Text style={styles.thumbnailOverlayText} numberOfLines={1}>
                    Ảnh chân dung
                  </Text>
                  <Ionicons name="chevron-forward" size={12} color="#FFFFFF" />
                </View>
              </TouchableOpacity>
            </View>

            {/* Full-width Action Button at bottom of Card 3 */}
            <TouchableOpacity
              style={styles.fullWidthUpdateBtn}
              activeOpacity={0.85}
              onPress={handleOpenCccdModal}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="create-outline" size={16} color="#6027D2" />
                <Text style={styles.fullWidthUpdateBtnText}>Cập nhật thông tin CCCD</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#6027D2" />
            </TouchableOpacity>
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

      {/* Modal 2: CCCD Documents Upload */}
      <Modal
        visible={isCccdModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsCccdModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Cập nhật giấy tờ CCCD</Text>
              <TouchableOpacity onPress={() => setIsCccdModalVisible(false)}>
                <Ionicons name="close-circle" size={24} color="#A0AEC0" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.modalFormScroll}>
              {/* CCCD Number Input */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Mã số CCCD / Căn cước (12 chữ số):</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="Nhập 12 chữ số (ví dụ: 001234567890)"
                  keyboardType="numeric"
                  maxLength={12}
                  value={cccdNumber}
                  onChangeText={setCccdNumber}
                  editable={profile?.verificationStatus !== 'APPROVED'}
                />
                {profile?.verificationStatus === 'APPROVED' && (
                  <Text style={{ fontSize: 11, color: '#2E7D32', marginTop: 4 }}>
                    🔒 Hồ sơ đã được Admin phê duyệt, không thể thay đổi thông tin định danh.
                  </Text>
                )}
              </View>

              <View style={styles.uploadDocSection}>
                <Text style={styles.docSectionTitle}>🪪 Ảnh xác minh Căn cước công dân (CCCD)</Text>
                <Text style={styles.docSectionSubtitle}>
                  Tải lên ảnh chụp rõ nét để Admin xác minh tài khoản trước khi đặt dịch vụ.
                </Text>

                {/* 1. CCCD Front */}
                <View style={styles.uploadCard}>
                  <Text style={styles.uploadCardLabel}>1. Ảnh mặt trước CCCD</Text>
                  {cccdFrontUrl ? (
                    <Image source={{ uri: cccdFrontUrl }} style={styles.uploadedImagePreview} />
                  ) : null}
                  <TouchableOpacity
                    style={styles.selectImageBtn}
                    onPress={() => handlePickDocument('front')}
                    disabled={uploadingType === 'front'}
                  >
                    {uploadingType === 'front' ? (
                      <ActivityIndicator size="small" color="#6027D2" />
                    ) : (
                      <>
                        <Ionicons name="camera-outline" size={18} color="#6027D2" />
                        <Text style={styles.selectImageBtnText}>
                          {cccdFrontUrl ? 'Thay đổi ảnh mặt trước' : 'Chọn ảnh mặt trước CCCD'}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                {/* 2. CCCD Back */}
                <View style={styles.uploadCard}>
                  <Text style={styles.uploadCardLabel}>2. Ảnh mặt sau CCCD</Text>
                  {cccdBackUrl ? (
                    <Image source={{ uri: cccdBackUrl }} style={styles.uploadedImagePreview} />
                  ) : null}
                  <TouchableOpacity
                    style={styles.selectImageBtn}
                    onPress={() => handlePickDocument('back')}
                    disabled={uploadingType === 'back'}
                  >
                    {uploadingType === 'back' ? (
                      <ActivityIndicator size="small" color="#6027D2" />
                    ) : (
                      <>
                        <Ionicons name="camera-outline" size={18} color="#6027D2" />
                        <Text style={styles.selectImageBtnText}>
                          {cccdBackUrl ? 'Thay đổi ảnh mặt sau' : 'Chọn ảnh mặt sau CCCD'}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                {/* 3. Selfie with ID */}
                <View style={styles.uploadCard}>
                  <Text style={styles.uploadCardLabel}>3. Ảnh Selfie cầm CCCD</Text>
                  {selfieWithIdUrl ? (
                    <Image source={{ uri: selfieWithIdUrl }} style={styles.uploadedImagePreview} />
                  ) : null}
                  <TouchableOpacity
                    style={styles.selectImageBtn}
                    onPress={() => handlePickDocument('selfie')}
                    disabled={uploadingType === 'selfie'}
                  >
                    {uploadingType === 'selfie' ? (
                      <ActivityIndicator size="small" color="#6027D2" />
                    ) : (
                      <>
                        <Ionicons name="camera-outline" size={18} color="#6027D2" />
                        <Text style={styles.selectImageBtnText}>
                          {selfieWithIdUrl ? 'Thay đổi ảnh Selfie' : 'Chọn ảnh Selfie cầm CCCD'}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelModalButton}
                onPress={() => setIsCccdModalVisible(false)}
              >
                <Text style={styles.cancelModalButtonText}>Hủy</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.saveModalButton}
                activeOpacity={0.8}
                onPress={handleSaveCccdDocs}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.saveModalButtonText}>Lưu & Gửi xác minh</Text>
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
});

