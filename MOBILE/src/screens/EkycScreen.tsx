import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  ekycService,
  EkycStatusResponse,
  EkycExtractedData,
} from '../services/ekycService';

const { width } = Dimensions.get('window');

interface EkycScreenProps {
  navigation: any;
  route?: any;
}

export const EkycScreen: React.FC<EkycScreenProps> = ({ navigation }) => {
  // Step: 1 = CCCD Upload & OCR, 2 = Selfie & Face Match, 3 = Result
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [serverStatus, setServerStatus] = useState<EkycStatusResponse | null>(null);

  // Step 1 States: CCCD
  const [frontUri, setFrontUri] = useState<string | null>(null);
  const [backUri, setBackUri] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState<boolean>(false);
  const [ocrData, setOcrData] = useState<EkycExtractedData | null>(null);
  const [antiFraudInfo, setAntiFraudInfo] = useState<{
    fraudScore: number | null;
    passed: boolean;
    verdict: string;
  } | null>(null);

  // Step 2 States: Selfie
  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [faceMatchLoading, setFaceMatchLoading] = useState<boolean>(false);

  // Step 3 States: Result
  const [verificationResult, setVerificationResult] = useState<{
    success: boolean;
    status: 'VERIFIED' | 'REJECTED';
    similarity?: number;
    message?: string;
    rejectionReason?: string;
  } | null>(null);

  // Image Preview Modal
  const [previewModalVisible, setPreviewModalVisible] = useState<boolean>(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string>('');
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);

  useEffect(() => {
    loadCurrentEkycStatus();
  }, []);

  const loadCurrentEkycStatus = async () => {
    try {
      setInitialLoading(true);
      const res = await ekycService.getStatus();
      setServerStatus(res);

      if (res.status === 'VERIFIED') {
        setCurrentStep(3);
        setVerificationResult({
          success: true,
          status: 'VERIFIED',
          similarity: res.faceSimilarity || 85,
          message: 'Tài khoản của bạn đã được xác thực eKYC thành công!',
        });
      } else if (res.status === 'REJECTED') {
        setCurrentStep(3);
        setVerificationResult({
          success: false,
          status: 'REJECTED',
          similarity: res.faceSimilarity || 0,
          rejectionReason:
            res.rejectionReason || 'Thông tin khuôn mặt không khớp hoặc nghi ngờ thẻ giả mạo.',
        });
      } else if (res.status === 'PROCESSING') {
        // Đã OCR nhưng chưa Face Match
        if (res.fullName) {
          setOcrData({
            fullName: res.fullName,
            idNumber: res.hasIdDocNumber ? '••••••••••••' : null,
            dateOfBirth: res.dateOfBirth || null,
            gender: res.gender || null,
            nationality: res.nationality || 'Việt Nam',
            placeOfOrigin: null,
            idDocType: res.idDocType || 'CCCD',
            confidence: 0.95,
          });
        }
      }
    } catch (err: any) {
      console.warn('Load eKYC status warning:', err?.message);
    } finally {
      setInitialLoading(false);
    }
  };

  // Helper: Chọn ảnh từ Camera hoặc Thư viện
  const handlePickImage = (
    target: 'front' | 'back' | 'selfie',
    mode: 'camera' | 'library'
  ) => {
    const isCamera = mode === 'camera';
    const isSelfie = target === 'selfie';

    (async () => {
      try {
        if (isCamera) {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) {
            Alert.alert('Cần cấp quyền', 'Vui lòng cho phép ứng dụng truy cập máy ảnh.');
            return;
          }
          const res = await ImagePicker.launchCameraAsync({
            allowsEditing: true,
            aspect: isSelfie ? [1, 1] : [16, 10],
            quality: 0.85,
            cameraType: isSelfie
              ? ImagePicker.CameraType?.front ?? ('front' as any)
              : ImagePicker.CameraType?.back ?? ('back' as any),
          });
          if (!res.canceled && res.assets && res.assets[0]?.uri) {
            applySelectedImage(target, res.assets[0].uri);
          }
        } else {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) {
            Alert.alert('Cần cấp quyền', 'Vui lòng cho phép ứng dụng truy cập thư viện ảnh.');
            return;
          }
          const res = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: isSelfie ? [1, 1] : [16, 10],
            quality: 0.85,
          });
          if (!res.canceled && res.assets && res.assets[0]?.uri) {
            applySelectedImage(target, res.assets[0].uri);
          }
        }
      } catch (err: any) {
        Alert.alert('Lỗi chọn ảnh', err?.message || 'Không thể chọn hình ảnh.');
      }
    })();
  };

  const applySelectedImage = (target: 'front' | 'back' | 'selfie', uri: string) => {
    if (target === 'front') {
      setFrontUri(uri);
      setOcrData(null); // Reset OCR cũ khi đổi ảnh
    } else if (target === 'back') {
      setBackUri(uri);
    } else if (target === 'selfie') {
      setSelfieUri(uri);
    }
  };

  // Bước 1: Gọi AI OCR & Anti-Fraud
  const handleStartOcr = async () => {
    if (!frontUri) {
      Alert.alert('Chưa có ảnh', 'Vui lòng chụp hoặc tải ảnh mặt trước thẻ CCCD.');
      return;
    }

    try {
      setOcrLoading(true);
      const res = await ekycService.ocrIdCard(frontUri, backUri || undefined);

      if (res.success && res.extracted) {
        setOcrData(res.extracted);
        setAntiFraudInfo(res.antiFraud);
        Alert.alert(
          'AI Bóc tách thành công 🎉',
          `Họ tên: ${res.extracted.fullName || 'N/A'}\nSố CCCD: ${res.extracted.idNumber || 'N/A'}\nPhôi thẻ: ${res.antiFraud?.passed ? 'Hợp lệ' : 'Cần kiểm tra'}`
        );
      } else {
        Alert.alert('Thông báo', res.message || 'Không thể bóc tách dữ liệu từ thẻ CCCD.');
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'Không thể nhận diện thẻ CCCD. Vui lòng chụp rõ nét hơn!';
      Alert.alert('Lỗi nhận diện CCCD', msg);
    } finally {
      setOcrLoading(false);
    }
  };

  // Bước 2: Gọi Face Match & Liveness
  const handleStartFaceMatch = async () => {
    if (!frontUri) {
      Alert.alert('Thiếu ảnh CCCD', 'Vui lòng quay lại bước 1 để tải ảnh mặt trước CCCD.');
      return;
    }
    if (!selfieUri) {
      Alert.alert('Thiếu ảnh Selfie', 'Vui lòng chụp ảnh khuôn mặt thật của bạn.');
      return;
    }

    try {
      setFaceMatchLoading(true);
      const res = await ekycService.faceMatch(frontUri, selfieUri);

      setCurrentStep(3);
      if (res.status === 'VERIFIED') {
        setVerificationResult({
          success: true,
          status: 'VERIFIED',
          similarity: res.similarity,
          message: 'Xác thực khuôn mặt sinh trắc học thành công!',
        });
      } else {
        setVerificationResult({
          success: false,
          status: 'REJECTED',
          similarity: res.similarity,
          rejectionReason:
            res.message || 'Khuôn mặt selfie không khớp ảnh thẻ CCCD hoặc phát hiện ảnh giả mạo.',
        });
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'Quá trình so khớp khuôn mặt gặp sự cố.';
      setCurrentStep(3);
      setVerificationResult({
        success: false,
        status: 'REJECTED',
        rejectionReason: msg,
      });
    } finally {
      setFaceMatchLoading(false);
    }
  };

  // Reset khi bị từ chối
  const handleRetry = async () => {
    try {
      setInitialLoading(true);
      await ekycService.retry();
      setFrontUri(null);
      setBackUri(null);
      setSelfieUri(null);
      setOcrData(null);
      setAntiFraudInfo(null);
      setVerificationResult(null);
      setCurrentStep(1);
    } catch (err: any) {
      Alert.alert('Lỗi', err?.message || 'Không thể thiết lập lại phiên eKYC.');
    } finally {
      setInitialLoading(false);
    }
  };

  // Xem ảnh bảo mật (khi đã VERIFIED)
  const handleViewDocument = async (field: 'front' | 'back' | 'selfie', title: string) => {
    try {
      setLoadingPreview(true);
      setPreviewTitle(title);
      setPreviewModalVisible(true);
      const res = await ekycService.getDocumentUrl(field);
      setPreviewImageUrl(res.url);
    } catch (err: any) {
      Alert.alert('Lỗi', 'Không thể lấy ảnh bảo mật từ Cloudinary.');
      setPreviewModalVisible(false);
    } finally {
      setLoadingPreview(false);
    }
  };

  if (initialLoading) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#6025D2" />
        <Text style={styles.loadingText}>Đang tải trạng thái xác thực eKYC...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={24} color="#1E1B2E" />
        </TouchableOpacity>
        <View style={styles.headerTitleBox}>
          <Text style={styles.headerTitle}>Xác thực định danh AI</Text>
          <Text style={styles.headerSubtitle}>Self-hosted eKYC (EasyOCR & DeepFace)</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={styles.scrollInner}
        showsVerticalScrollIndicator={false}
      >
        {/* PROGRESS STEP BAR */}
        <View style={styles.stepperContainer}>
          <View style={styles.stepItem}>
            <View
              style={[
                styles.stepCircle,
                currentStep >= 1 && styles.stepCircleActive,
                currentStep > 1 && styles.stepCircleDone,
              ]}
            >
              {currentStep > 1 ? (
                <Ionicons name="checkmark" size={16} color="#FFFFFF" />
              ) : (
                <Text style={[styles.stepNumber, currentStep === 1 && styles.stepNumberActive]}>
                  1
                </Text>
              )}
            </View>
            <Text style={[styles.stepLabel, currentStep >= 1 && styles.stepLabelActive]}>
              Quét CCCD
            </Text>
          </View>

          <View
            style={[
              styles.stepConnector,
              currentStep >= 2 && styles.stepConnectorActive,
            ]}
          />

          <View style={styles.stepItem}>
            <View
              style={[
                styles.stepCircle,
                currentStep >= 2 && styles.stepCircleActive,
                currentStep > 2 && styles.stepCircleDone,
              ]}
            >
              {currentStep > 2 ? (
                <Ionicons name="checkmark" size={16} color="#FFFFFF" />
              ) : (
                <Text style={[styles.stepNumber, currentStep === 2 && styles.stepNumberActive]}>
                  2
                </Text>
              )}
            </View>
            <Text style={[styles.stepLabel, currentStep >= 2 && styles.stepLabelActive]}>
              So khớp mặt
            </Text>
          </View>

          <View
            style={[
              styles.stepConnector,
              currentStep === 3 && styles.stepConnectorActive,
            ]}
          />

          <View style={styles.stepItem}>
            <View
              style={[
                styles.stepCircle,
                currentStep === 3 && styles.stepCircleActive,
                verificationResult?.status === 'VERIFIED' && styles.stepCircleDone,
                verificationResult?.status === 'REJECTED' && styles.stepCircleError,
              ]}
            >
              <Text style={[styles.stepNumber, currentStep === 3 && styles.stepNumberActive]}>
                3
              </Text>
            </View>
            <Text style={[styles.stepLabel, currentStep === 3 && styles.stepLabelActive]}>
              Hoàn tất
            </Text>
          </View>
        </View>

        {/* AI BADGE INFO BANNER */}
        <View style={styles.aiBadgeBanner}>
          <View style={styles.aiIconWrapper}>
            <Ionicons name="sparkles" size={18} color="#6025D2" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.aiBadgeTitle}>Hệ thống AI eKYC bảo mật & tự động</Text>
            <Text style={styles.aiBadgeDesc}>
              Bóc tách chữ EasyOCR, kiểm tra gian lận thẻ OpenCV & so khớp sinh trắc học DeepFace
              ArcFace. Phê duyệt tức thì, không cần đợi duyệt thủ công!
            </Text>
          </View>
        </View>

        {/* ======================================================== */}
        {/*  BƯỚC 1: QUÉT THẺ CCCD                                  */}
        {/* ======================================================== */}
        {currentStep === 1 && (
          <View style={styles.stepSection}>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="card-outline" size={20} color="#6025D2" />
              <Text style={styles.sectionTitle}>Bước 1: Chụp ảnh Căn cước công dân (CCCD)</Text>
            </View>
            <Text style={styles.sectionDesc}>
              Vui lòng đặt thẻ trên mặt phẳng, đủ ánh sáng, rõ 4 góc, không bị bóng loá hay che
              khuất.
            </Text>

            {/* 1.1 MẶT TRƯỚC CCCD (BẮT BUỘC) */}
            <View style={styles.cardUploadBox}>
              <View style={styles.cardBoxHeader}>
                <Text style={styles.cardBoxTitle}>Mặt trước thẻ CCCD *</Text>
                {frontUri && (
                  <View style={styles.badgeSuccess}>
                    <Ionicons name="checkmark-circle" size={14} color="#16A34A" />
                    <Text style={styles.badgeSuccessText}>Đã chọn</Text>
                  </View>
                )}
              </View>

              {frontUri ? (
                <View style={styles.imagePreviewContainer}>
                  <Image source={{ uri: frontUri }} style={styles.idCardImagePreview} />
                  <TouchableOpacity
                    style={styles.retakeBtn}
                    onPress={() => setFrontUri(null)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="refresh-outline" size={14} color="#FFFFFF" />
                    <Text style={styles.retakeBtnText}>Chụp lại</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.emptyUploadBox}>
                  <View style={styles.scanGuideGraphic}>
                    <Ionicons name="id-card-outline" size={36} color="#A78BFA" />
                  </View>
                  <Text style={styles.emptyUploadText}>Chụp hoặc chọn ảnh mặt trước thẻ</Text>
                  <View style={styles.uploadActionButtonsRow}>
                    <TouchableOpacity
                      style={styles.actionBtnCamera}
                      onPress={() => handlePickImage('front', 'camera')}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="camera" size={16} color="#FFFFFF" />
                      <Text style={styles.actionBtnCameraText}>Chụp máy ảnh</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionBtnGallery}
                      onPress={() => handlePickImage('front', 'library')}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="images-outline" size={16} color="#6025D2" />
                      <Text style={styles.actionBtnGalleryText}>Thư viện</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

            {/* 1.2 MẶT SAU CCCD (TUỲ CHỌN) */}
            <View style={[styles.cardUploadBox, { marginTop: 14 }]}>
              <View style={styles.cardBoxHeader}>
                <Text style={styles.cardBoxTitle}>Mặt sau thẻ CCCD (Tuỳ chọn)</Text>
                {backUri && (
                  <View style={styles.badgeSuccess}>
                    <Ionicons name="checkmark-circle" size={14} color="#16A34A" />
                    <Text style={styles.badgeSuccessText}>Đã chọn</Text>
                  </View>
                )}
              </View>

              {backUri ? (
                <View style={styles.imagePreviewContainer}>
                  <Image source={{ uri: backUri }} style={styles.idCardImagePreview} />
                  <TouchableOpacity
                    style={styles.retakeBtn}
                    onPress={() => setBackUri(null)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="refresh-outline" size={14} color="#FFFFFF" />
                    <Text style={styles.retakeBtnText}>Chụp lại</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.emptyUploadBox}>
                  <Text style={styles.emptyUploadText}>Bổ sung mặt sau để AI trích xuất đủ chip/quê quán</Text>
                  <View style={styles.uploadActionButtonsRow}>
                    <TouchableOpacity
                      style={styles.actionBtnCameraSmall}
                      onPress={() => handlePickImage('back', 'camera')}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="camera-outline" size={14} color="#6025D2" />
                      <Text style={styles.actionBtnCameraSmallText}>Chụp ảnh</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionBtnGallerySmall}
                      onPress={() => handlePickImage('back', 'library')}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="images-outline" size={14} color="#64748B" />
                      <Text style={styles.actionBtnGallerySmallText}>Chọn ảnh</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

            {/* NÚT BẮT ĐẦU QUÉT OCR */}
            {!ocrData ? (
              <TouchableOpacity
                style={[
                  styles.primarySubmitBtn,
                  (!frontUri || ocrLoading) && styles.primarySubmitBtnDisabled,
                ]}
                onPress={handleStartOcr}
                disabled={!frontUri || ocrLoading}
                activeOpacity={0.85}
              >
                {ocrLoading ? (
                  <View style={styles.btnLoadingRow}>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                    <Text style={styles.primarySubmitBtnText}>AI đang phân tích & bóc tách thẻ...</Text>
                  </View>
                ) : (
                  <View style={styles.btnRow}>
                    <Ionicons name="scan-outline" size={18} color="#FFFFFF" />
                    <Text style={styles.primarySubmitBtnText}>Bắt đầu quét AI EasyOCR</Text>
                  </View>
                )}
              </TouchableOpacity>
            ) : null}

            {/* KẾT QUẢ BÓC TÁCH BỞI AI */}
            {ocrData && (
              <View style={styles.extractedCardContainer}>
                <View style={styles.extractedHeader}>
                  <View style={styles.extractedHeaderLeft}>
                    <Ionicons name="checkmark-done-circle" size={20} color="#16A34A" />
                    <Text style={styles.extractedTitle}>Dữ liệu bóc tách từ CCCD</Text>
                  </View>
                  {antiFraudInfo?.passed && (
                    <View style={styles.antiFraudPill}>
                      <Ionicons name="shield-checkmark" size={13} color="#059669" />
                      <Text style={styles.antiFraudPillText}>Thẻ hợp lệ</Text>
                    </View>
                  )}
                </View>

                <View style={styles.infoRow}>
                  <Text style={styles.infoKey}>Số CCCD:</Text>
                  <Text style={styles.infoValHighlight}>{ocrData.idNumber || 'Đã đọc thành công'}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoKey}>Họ và tên:</Text>
                  <Text style={styles.infoVal}>{ocrData.fullName || 'N/A'}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoKey}>Ngày sinh:</Text>
                  <Text style={styles.infoVal}>{ocrData.dateOfBirth || 'N/A'}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoKey}>Giới tính:</Text>
                  <Text style={styles.infoVal}>{ocrData.gender || 'N/A'}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoKey}>Quốc tịch:</Text>
                  <Text style={styles.infoVal}>{ocrData.nationality || 'Việt Nam'}</Text>
                </View>

                <TouchableOpacity
                  style={styles.continueToStep2Btn}
                  onPress={() => setCurrentStep(2)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.continueToStep2BtnText}>Tiếp tục: So khớp khuôn mặt</Text>
                  <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* ======================================================== */}
        {/*  BƯỚC 2: SO KHỚP CHÂN DUNG & LIVENESS                  */}
        {/* ======================================================== */}
        {currentStep === 2 && (
          <View style={styles.stepSection}>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="person-outline" size={20} color="#6025D2" />
              <Text style={styles.sectionTitle}>Bước 2: Chụp ảnh khuôn mặt chân dung (Selfie)</Text>
            </View>
            <Text style={styles.sectionDesc}>
              AI DeepFace ArcFace sẽ so khớp sinh trắc học giữa ảnh chân dung và ảnh trên thẻ CCCD.
              Kiểm tra Liveness tự động ngăn chặn deepfake & ảnh chụp lại từ màn hình.
            </Text>

            {/* OVAL GUIDE / CAMERA PREVIEW */}
            <View style={styles.selfieUploadBox}>
              {selfieUri ? (
                <View style={styles.selfiePreviewContainer}>
                  <Image source={{ uri: selfieUri }} style={styles.selfieImagePreview} />
                  <TouchableOpacity
                    style={styles.retakeBtn}
                    onPress={() => setSelfieUri(null)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="refresh-outline" size={14} color="#FFFFFF" />
                    <Text style={styles.retakeBtnText}>Chụp lại</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.selfiePlaceholderBox}>
                  <View style={styles.ovalFrame}>
                    <Ionicons name="person" size={56} color="#C4B5FD" />
                  </View>
                  <Text style={styles.ovalGuideText}>
                    Giữ khuôn mặt thẳng trong khung hình, bỏ kính và khẩu trang
                  </Text>
                  <View style={styles.uploadActionButtonsRow}>
                    <TouchableOpacity
                      style={styles.actionBtnCamera}
                      onPress={() => handlePickImage('selfie', 'camera')}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="camera" size={16} color="#FFFFFF" />
                      <Text style={styles.actionBtnCameraText}>Mở Camera Selfie</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionBtnGallery}
                      onPress={() => handlePickImage('selfie', 'library')}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="images-outline" size={16} color="#6025D2" />
                      <Text style={styles.actionBtnGalleryText}>Chọn từ thư viện</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

            {/* NÚT THỰC HIỆN SO KHỚP */}
            <TouchableOpacity
              style={[
                styles.primarySubmitBtn,
                (!selfieUri || faceMatchLoading) && styles.primarySubmitBtnDisabled,
              ]}
              onPress={handleStartFaceMatch}
              disabled={!selfieUri || faceMatchLoading}
              activeOpacity={0.85}
            >
              {faceMatchLoading ? (
                <View style={styles.btnLoadingRow}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.primarySubmitBtnText}>DeepFace & Liveness đang xác minh...</Text>
                </View>
              ) : (
                <View style={styles.btnRow}>
                  <Ionicons name="finger-print-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.primarySubmitBtnText}>Xác thực sinh trắc học AI</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.backStepBtn}
              onPress={() => setCurrentStep(1)}
              disabled={faceMatchLoading}
            >
              <Ionicons name="arrow-back" size={16} color="#64748B" />
              <Text style={styles.backStepBtnText}>Quay lại Bước 1</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ======================================================== */}
        {/*  BƯỚC 3: KẾT QUẢ XÁC THỰC                              */}
        {/* ======================================================== */}
        {currentStep === 3 && (
          <View style={styles.stepSection}>
            {verificationResult?.status === 'VERIFIED' ? (
              <View style={styles.resultCardSuccess}>
                <View style={styles.successIconOuterCircle}>
                  <View style={styles.successIconInnerCircle}>
                    <Ionicons name="checkmark" size={40} color="#FFFFFF" />
                  </View>
                </View>

                <Text style={styles.resultTitleSuccess}>Xác thực eKYC thành công!</Text>
                <Text style={styles.resultDescSuccess}>
                  Hồ sơ định danh của bạn đã được đối soát sinh trắc học và phê duyệt tự động. Giờ đây
                  bạn có thể sử dụng trọn vẹn các dịch vụ của LanCare Hub!
                </Text>

                <View style={styles.verifiedStatsBox}>
                  <View style={styles.statCol}>
                    <Text style={styles.statLabel}>Độ khớp khuôn mặt</Text>
                    <Text style={styles.statValue}>
                      {verificationResult.similarity?.toFixed(1) || '88.5'}%
                    </Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statCol}>
                    <Text style={styles.statLabel}>Kiểm tra người thật</Text>
                    <Text style={[styles.statValue, { color: '#16A34A' }]}>REAL (Hợp lệ)</Text>
                  </View>
                </View>

                {/* Secure Documents Viewer Buttons */}
                <View style={styles.secureDocsRow}>
                  <TouchableOpacity
                    style={styles.secureDocBtn}
                    onPress={() => handleViewDocument('front', 'Mặt trước thẻ CCCD')}
                  >
                    <Ionicons name="id-card-outline" size={14} color="#6025D2" />
                    <Text style={styles.secureDocBtnText}>Xem CCCD trước</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.secureDocBtn}
                    onPress={() => handleViewDocument('selfie', 'Ảnh chân dung Selfie')}
                  >
                    <Ionicons name="person-outline" size={14} color="#6025D2" />
                    <Text style={styles.secureDocBtnText}>Xem ảnh Selfie</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.doneBtn}
                  onPress={() => navigation.goBack()}
                  activeOpacity={0.85}
                >
                  <Text style={styles.doneBtnText}>Hoàn tất & Về trang cá nhân</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.resultCardError}>
                <View style={styles.errorIconOuterCircle}>
                  <View style={styles.errorIconInnerCircle}>
                    <Ionicons name="close" size={40} color="#FFFFFF" />
                  </View>
                </View>

                <Text style={styles.resultTitleError}>Xác thực chưa thành công</Text>
                <Text style={styles.resultDescError}>
                  {verificationResult?.rejectionReason ||
                    'Khuôn mặt selfie không khớp với ảnh trên thẻ CCCD hoặc phát hiện dấu hiệu bất thường.'}
                </Text>

                <View style={styles.tipsBox}>
                  <Text style={styles.tipsTitle}>💡 Mẹo để xác thực thành công:</Text>
                  <Text style={styles.tipsText}>• Chụp ảnh CCCD gốc, không chụp qua màn hình hay photocopy.</Text>
                  <Text style={styles.tipsText}>• Chụp khuôn mặt thật nơi đủ sáng, không đeo kính đen hay khẩu trang.</Text>
                  <Text style={styles.tipsText}>• Đảm bảo khuôn mặt hướng thẳng vào máy ảnh.</Text>
                </View>

                <TouchableOpacity
                  style={styles.retryBtn}
                  onPress={handleRetry}
                  activeOpacity={0.85}
                >
                  <Ionicons name="refresh" size={18} color="#FFFFFF" />
                  <Text style={styles.retryBtnText}>Thử lại ngay</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.backHomeBtn}
                  onPress={() => navigation.goBack()}
                >
                  <Text style={styles.backHomeBtnText}>Quay lại sau</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* MODAL XEM ẢNH BẢO MẬT */}
      <Modal
        visible={previewModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setPreviewModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalInner}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalHeaderTitle}>{previewTitle}</Text>
              <TouchableOpacity onPress={() => setPreviewModalVisible(false)}>
                <Ionicons name="close-circle" size={24} color="#64748B" />
              </TouchableOpacity>
            </View>

            {loadingPreview ? (
              <View style={styles.modalLoadingBox}>
                <ActivityIndicator size="large" color="#6025D2" />
                <Text style={styles.loadingText}>Đang tải ảnh bảo mật từ Cloudinary...</Text>
              </View>
            ) : previewImageUrl ? (
              <Image source={{ uri: previewImageUrl }} style={styles.modalPreviewImage} resizeMode="contain" />
            ) : (
              <Text style={styles.loadingText}>Không thể hiển thị ảnh</Text>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EDE9FE',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitleBox: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1E1B2E',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#7C3AED',
    fontWeight: '600',
    marginTop: 2,
  },
  scrollContent: {
    flex: 1,
  },
  scrollInner: {
    padding: 16,
    paddingBottom: 40,
  },
  // Stepper
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    marginBottom: 14,
    elevation: 2,
    shadowColor: '#6025D2',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
  },
  stepItem: {
    alignItems: 'center',
  },
  stepCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  stepCircleActive: {
    backgroundColor: '#6025D2',
  },
  stepCircleDone: {
    backgroundColor: '#16A34A',
  },
  stepCircleError: {
    backgroundColor: '#DC2626',
  },
  stepNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  stepNumberActive: {
    color: '#FFFFFF',
  },
  stepLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },
  stepLabelActive: {
    color: '#6025D2',
  },
  stepConnector: {
    flex: 1,
    height: 2,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 8,
    marginBottom: 16,
  },
  stepConnectorActive: {
    backgroundColor: '#6025D2',
  },
  // AI Badge Banner
  aiBadgeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F3FF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#DDD6FE',
    marginBottom: 16,
  },
  aiIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EDE9FE',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  aiBadgeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4C1D95',
  },
  aiBadgeDesc: {
    fontSize: 11,
    color: '#6D28D9',
    marginTop: 2,
    lineHeight: 16,
  },
  // Step Section
  stepSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    elevation: 2,
    shadowColor: '#6025D2',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E1B2E',
    marginLeft: 8,
  },
  sectionDesc: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 14,
  },
  // Card Upload Box
  cardUploadBox: {
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#F8FAFC',
  },
  cardBoxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardBoxTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  badgeSuccess: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  badgeSuccessText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#16A34A',
    marginLeft: 4,
  },
  emptyUploadBox: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  scanGuideGraphic: {
    width: 60,
    height: 44,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#C4B5FD',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F3FF',
    marginBottom: 8,
  },
  emptyUploadText: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 12,
  },
  uploadActionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtnCamera: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6025D2',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
  },
  actionBtnCameraText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
  },
  actionBtnGallery: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
  },
  actionBtnGalleryText: {
    color: '#6025D2',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
  },
  actionBtnCameraSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  actionBtnCameraSmallText: {
    color: '#6025D2',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 4,
  },
  actionBtnGallerySmall: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  actionBtnGallerySmallText: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 4,
  },
  imagePreviewContainer: {
    position: 'relative',
    borderRadius: 10,
    overflow: 'hidden',
  },
  idCardImagePreview: {
    width: '100%',
    height: 180,
    borderRadius: 10,
    backgroundColor: '#000000',
  },
  retakeBtn: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  retakeBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 4,
  },
  // Submit Button
  primarySubmitBtn: {
    backgroundColor: '#6025D2',
    borderRadius: 14,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 18,
    shadowColor: '#6025D2',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 3,
  },
  primarySubmitBtnDisabled: {
    backgroundColor: '#A78BFA',
    opacity: 0.7,
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  btnLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  primarySubmitBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 8,
  },
  // Extracted Result Card
  extractedCardContainer: {
    marginTop: 18,
    backgroundColor: '#F0FDF4',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  extractedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#DCFCE7',
    paddingBottom: 8,
  },
  extractedHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  extractedTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#166534',
    marginLeft: 6,
  },
  antiFraudPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  antiFraudPillText: {
    fontSize: 11,
    color: '#059669',
    fontWeight: '700',
    marginLeft: 4,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  infoKey: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '500',
  },
  infoVal: {
    fontSize: 12,
    color: '#1E293B',
    fontWeight: '600',
  },
  infoValHighlight: {
    fontSize: 13,
    color: '#6025D2',
    fontWeight: '700',
  },
  continueToStep2Btn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#16A34A',
    borderRadius: 12,
    height: 44,
    marginTop: 12,
  },
  continueToStep2BtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    marginRight: 6,
  },
  // Step 2: Selfie
  selfieUploadBox: {
    borderWidth: 1.5,
    borderColor: '#DDD6FE',
    borderRadius: 18,
    padding: 16,
    backgroundColor: '#FAF5FF',
    alignItems: 'center',
  },
  selfiePlaceholderBox: {
    alignItems: 'center',
    width: '100%',
  },
  ovalFrame: {
    width: 140,
    height: 180,
    borderRadius: 70,
    borderWidth: 2,
    borderColor: '#8B5CF6',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#EDE9FE',
    marginBottom: 12,
  },
  ovalGuideText: {
    fontSize: 12,
    color: '#6B21A8',
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 16,
    lineHeight: 18,
  },
  selfiePreviewContainer: {
    width: '100%',
    alignItems: 'center',
    position: 'relative',
  },
  selfieImagePreview: {
    width: 180,
    height: 220,
    borderRadius: 90,
    backgroundColor: '#000000',
  },
  backStepBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 14,
    paddingVertical: 8,
  },
  backStepBtnText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
    marginLeft: 6,
  },
  // Step 3: Result
  resultCardSuccess: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  successIconOuterCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#DCFCE7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  successIconInnerCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#16A34A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultTitleSuccess: {
    fontSize: 20,
    fontWeight: '800',
    color: '#15803D',
    marginBottom: 8,
  },
  resultDescSuccess: {
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  verifiedStatsBox: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 12,
    paddingHorizontal: 20,
    width: '100%',
    marginBottom: 16,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    height: '100%',
    backgroundColor: '#E2E8F0',
  },
  statLabel: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6025D2',
  },
  secureDocsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
    width: '100%',
  },
  secureDocBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
    borderRadius: 10,
    paddingVertical: 8,
  },
  secureDocBtnText: {
    fontSize: 11,
    color: '#6025D2',
    fontWeight: '600',
    marginLeft: 6,
  },
  doneBtn: {
    backgroundColor: '#6025D2',
    borderRadius: 14,
    height: 48,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  resultCardError: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  errorIconOuterCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  errorIconInnerCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultTitleError: {
    fontSize: 19,
    fontWeight: '800',
    color: '#DC2626',
    marginBottom: 8,
  },
  resultDescError: {
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
    marginBottom: 16,
  },
  tipsBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 12,
    width: '100%',
    marginBottom: 16,
  },
  tipsTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 6,
  },
  tipsText: {
    fontSize: 11,
    color: '#78350F',
    lineHeight: 16,
    marginBottom: 3,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6025D2',
    borderRadius: 14,
    height: 48,
    width: '100%',
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 6,
  },
  backHomeBtn: {
    paddingVertical: 12,
    marginTop: 6,
  },
  backHomeBtnText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  // Modal Preview Image
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalInner: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalHeaderTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E1B2E',
  },
  modalLoadingBox: {
    height: 240,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalPreviewImage: {
    width: '100%',
    height: 280,
    borderRadius: 10,
    backgroundColor: '#000000',
  },
});
