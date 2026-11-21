import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LocationPickerModal } from '../components/LocationPickerModal';
import { orderService } from '../services/orderService';
import { customerService } from '../services/customerService';
import { uploadService } from '../services/uploadService';
import { providerService } from '../services/providerService';
import { calculateRoadDistanceKm } from '../utils/distance';

interface CreateOrderScreenProps {
  navigation: any;
  route: {
    params: {
      providerId: string;
      providerName?: string;
      providerGpsLat?: string | number | null;
      providerGpsLng?: string | number | null;
      providerAddress?: string | null;
      package: {
        id: string;
        name: string;
        durationDays: number;
        reportFrequencyDays?: number;
        maxPlants: number;
        price?: number;
        basePrice?: string;
        minDeclaredValue?: string | number;
        maxDeclaredValue?: string | number;
        description?: string;
      };
    };
  };
}

interface LocalPlantItem {
  id: string;
  name: string;
  speciesName: string;
  isValueDeclared: boolean;
  declaredValue: string;
  imageUri: string | null;
}

export const CreateOrderScreen: React.FC<CreateOrderScreenProps> = ({
  navigation,
  route,
}) => {
  const { providerId, providerName, package: pkg } = route.params;

  // Max plants allowed by package
  const maxPlantsAllowed = pkg.maxPlants || 10;

  // Initial 1 plant
  const [plants, setPlants] = useState<LocalPlantItem[]>([
    {
      id: 'plant-1',
      name: 'Chậu Lan Hồ Điệp 1',
      speciesName: 'Hồ Điệp Tím',
      isValueDeclared: false,
      declaredValue: '',
      imageUri: null,
    },
  ]);

  // Location state
  const [pickupAddress, setPickupAddress] = useState<string>('Số 1 Võ Văn Ngân, Thủ Đức, TP.HCM');
  const [pickupLat, setPickupLat] = useState<number>(10.8505);
  const [pickupLng, setPickupLng] = useState<number>(106.7719);
  const [showLocationPicker, setShowLocationPicker] = useState<boolean>(false);

  // Provider location to compute distance
  const [providerCoords, setProviderCoords] = useState<{
    lat: number | null;
    lng: number | null;
    address?: string;
  }>({
    lat: route.params.providerGpsLat != null ? Number(route.params.providerGpsLat) : null,
    lng: route.params.providerGpsLng != null ? Number(route.params.providerGpsLng) : null,
    address: route.params.providerAddress || undefined,
  });

  // Pickup fee quote from BE Google Routes API
  const [pickupQuote, setPickupQuote] = useState<{ distanceKm: number; pickupFee: string } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState<boolean>(false);

  useEffect(() => {
    let isCancelled = false;
    const fetchQuote = async () => {
      if (!pkg.id || pickupLat == null || pickupLng == null) return;
      setQuoteLoading(true);
      try {
        const quote = await orderService.quotePickupFee({
          servicePackageId: pkg.id,
          pickupGpsLat: pickupLat,
          pickupGpsLng: pickupLng,
        });
        if (!isCancelled) {
          setPickupQuote(quote);
        }
      } catch (err) {
        console.warn('Could not quote pickup fee:', err);
      } finally {
        if (!isCancelled) {
          setQuoteLoading(false);
        }
      }
    };
    fetchQuote();
    return () => {
      isCancelled = true;
    };
  }, [pkg.id, pickupLat, pickupLng]);

  useEffect(() => {
    if ((providerCoords.lat == null || providerCoords.lng == null) && providerId) {
      providerService.getProviderById(providerId).then((res) => {
        if (res?.gpsLat != null && res?.gpsLng != null) {
          setProviderCoords({
            lat: Number(res.gpsLat),
            lng: Number(res.gpsLng),
            address: res.address || undefined,
          });
        }
      }).catch((err) => {
        console.warn('Could not fetch provider coords:', err);
      });
    }
  }, [providerId]);

  // Real road distance in km
  const roadDistanceKm = calculateRoadDistanceKm(
    pickupLat,
    pickupLng,
    providerCoords.lat,
    providerCoords.lng,
  );

  // Scheduled pickup (Default tomorrow 09:00 AM)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const [scheduledPickupAt, setScheduledPickupAt] = useState<Date>(tomorrow);

  // Customer note
  const [customerNote, setCustomerNote] = useState<string>('');

  // Submit state
  const [submitting, setSubmitting] = useState<boolean>(false);

  const priceVal = pkg.price || Number(pkg.basePrice || 0);
  const pkgMin = pkg.minDeclaredValue != null && Number(pkg.minDeclaredValue) > 0 ? Number(pkg.minDeclaredValue) : null;
  const pkgMax = pkg.maxDeclaredValue != null && Number(pkg.maxDeclaredValue) > 0 ? Number(pkg.maxDeclaredValue) : null;

  // PR #39: Declared deposit rule (10% if declaredValue > 2 * basePrice)
  const declaredDepositTotal = plants.reduce((sum, p) => {
    if (p.isValueDeclared && p.declaredValue) {
      const val = Number(p.declaredValue.replace(/\D/g, ''));
      if (val > 2 * priceVal) {
        return sum + Math.round(val * 0.1);
      }
    }
    return sum;
  }, 0);

  const pickupFeeNumber = pickupQuote ? Number(pickupQuote.pickupFee) : 0;
  const packageTotalNumber = priceVal * plants.length;
  const grandTotalEstimate = packageTotalNumber + pickupFeeNumber + declaredDepositTotal;

  // Handlers for plants
  const handleAddPlant = () => {
    if (plants.length >= maxPlantsAllowed) {
      Alert.alert(
        'Giới hạn gói',
        `Gói dịch vụ này tối đa chỉ hỗ trợ ${maxPlantsAllowed} chậu lan.`
      );
      return;
    }
    const newId = `plant-${Date.now()}`;
    setPlants((prev) => [
      ...prev,
      {
        id: newId,
        name: `Chậu Lan ${prev.length + 1}`,
        speciesName: '',
        isValueDeclared: false,
        declaredValue: '',
        imageUri: null,
      },
    ]);
  };

  const handleRemovePlant = (id: string) => {
    if (plants.length <= 1) {
      Alert.alert('Thông báo', 'Đơn hàng phải có ít nhất 1 chậu lan.');
      return;
    }
    setPlants((prev) => prev.filter((p) => p.id !== id));
  };

  const handleUpdatePlant = (id: string, field: keyof LocalPlantItem, value: any) => {
    setPlants((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  const handlePickImage = async (id: string) => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Quyền truy cập', 'Vui lòng cho phép ứng dụng truy cập máy ảnh để chụp ảnh chậu lan.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]?.uri) {
        handleUpdatePlant(id, 'imageUri', result.assets[0].uri);
      }
    } catch (error: any) {
      Alert.alert('Lỗi máy ảnh', error?.message || 'Không thể mở máy ảnh.');
    }
  };

  // Submit Order flow
  const handleSubmitOrder = async () => {
    // 1. Validate
    if (plants.length === 0) {
      Alert.alert('Lỗi', 'Vui lòng thêm ít nhất 1 chậu lan.');
      return;
    }

    for (let i = 0; i < plants.length; i++) {
      const p = plants[i];
      if (!p.name.trim()) {
        Alert.alert('Lỗi', `Vui lòng nhập tên cho chậu cây số ${i + 1}.`);
        return;
      }
      if (p.isValueDeclared) {
        const val = Number(p.declaredValue.replace(/\D/g, ''));
        if (!val || val <= 0) {
          Alert.alert('Lỗi', `Vui lòng nhập giá trị khai báo hợp lệ cho chậu cây số ${i + 1}.`);
          return;
        }
        if (pkgMin !== null && val < pkgMin) {
          Alert.alert(
            'Giá trị dưới mức cho phép của gói',
            `Chậu #${i + 1} có giá trị khai báo (${val.toLocaleString('vi-VN')} đ) nhỏ hơn mức tối thiểu của gói (${pkgMin.toLocaleString('vi-VN')} đ).\n\nNếu chậu cây có giá trị thông thường, bạn hãy bỏ tích chọn 'Khai báo giá trị chậu lan' để đặt đơn theo chính sách bồi thường mặc định.`
          );
          return;
        }
        if (pkgMax !== null && val > pkgMax) {
          Alert.alert(
            'Giá trị vượt hạn mức gói',
            `Chậu #${i + 1} có giá trị khai báo (${val.toLocaleString('vi-VN')} đ) vượt mức tối đa của gói (${pkgMax.toLocaleString('vi-VN')} đ).\n\nVui lòng chọn gói dịch vụ cao cấp hơn có hạn mức phù hợp hoặc điều chỉnh mức khai báo.`
          );
          return;
        }
      }
    }

    if (!pickupAddress.trim()) {
      Alert.alert('Lỗi', 'Vui lòng chọn hoặc nhập địa chỉ lấy cây.');
      return;
    }

    setSubmitting(true);

    try {
      // 2. Prepare payload for POST /orders
      const formattedPickupAt = scheduledPickupAt.toISOString();

      const plantsPayload = plants.map((p) => ({
        name: p.name.trim(),
        speciesName: p.speciesName.trim() || undefined,
        isValueDeclared: p.isValueDeclared,
        declaredValue:
          p.isValueDeclared && p.declaredValue.trim()
            ? p.declaredValue.trim().replace(/\D/g, '')
            : undefined,
      }));

      const createDto = {
        servicePackageId: pkg.id,
        scheduledPickupAt: formattedPickupAt,
        pickupAddress: pickupAddress.trim(),
        pickupGpsLat: pickupLat,
        pickupGpsLng: pickupLng,
        customerNote: customerNote.trim() || undefined,
        plants: plantsPayload,
      };

      // Call API create draft order
      const createdOrder = await orderService.createOrder(createDto);

      // 3. Upload initial photos for each plant if picked
      if (createdOrder.plants && createdOrder.plants.length > 0) {
        for (let i = 0; i < plants.length; i++) {
          const localPlant = plants[i];
          const serverPlant = createdOrder.plants[i];

          if (localPlant.imageUri && serverPlant?.id) {
            try {
              const photoUrl = await uploadService.uploadDocumentImage(localPlant.imageUri);
              await orderService.addInitialPhoto(createdOrder.id, serverPlant.id, {
                photoUrl,
                caption: `Ảnh hiện trạng ban đầu của ${localPlant.name}`,
              });
            } catch (err) {
              console.warn(`Could not upload photo for plant ${localPlant.name}:`, err);
            }
          }
        }
      }

      // 4. Submit order to provider (DRAFT -> PENDING_PROVIDER)
      await orderService.submitOrder(createdOrder.id);

      Alert.alert(
        'Thành công!',
        `Đã tạo đơn hàng ${createdOrder.orderCode || ''} và gửi tới nhà vườn thành công!`,
        [
          {
            text: 'Xem đơn hàng',
            onPress: () => {
              navigation.navigate('MainTabs', { screen: 'Orders' });
            },
          },
        ]
      );
    } catch (error: any) {
      if (error?.response?.status !== 401) {
        console.error('Order creation failed:', error?.response?.data || error?.message || error);
      }
      const is401 = error?.response?.status === 401;
      let errMsg = is401
        ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để tiếp tục tạo đơn hàng.'
        : error?.response?.data?.message ||
          error?.message ||
          'Không thể tạo đơn hàng. Vui lòng kiểm tra lại kết nối.';

      // Nếu BE trả 403 gộp chung thiếu SĐT / thiếu mặt sau CCCD / chưa xác thực -> kiểm tra chi tiết hồ sơ để báo đúng nguyên nhân
      if (error?.response?.status === 403) {
        try {
          const prof = await customerService.getMyProfile();
          if (prof?.verificationStatus === 'APPROVED') {
            if (!prof.phone) {
              errMsg = 'Tài khoản đã xác thực nhưng chưa có Số điện thoại. Vui lòng cập nhật Số điện thoại trong mục Cá nhân -> Thông tin cá nhân trước khi đặt đơn.';
            } else if (!prof.cccdBackUrl) {
              errMsg = 'Hồ sơ của bạn hiện thiếu ảnh mặt sau CCCD trên hệ thống (do tài khoản cũ chưa chụp mặt sau). Vui lòng liên hệ quản trị viên để cập nhật lại hoặc dùng tài khoản mới quét đủ 2 mặt CCCD.';
            }
          }
        } catch (_) {}
      }

      Alert.alert(
        is401 ? 'Hết phiên đăng nhập' : 'Tạo đơn thất bại',
        Array.isArray(errMsg) ? errMsg.join('\n') : errMsg
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#1A202C" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Đặt dịch vụ chăm sóc</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Package Card Summary */}
        <View style={styles.packageCard}>
          <View style={styles.packageHeaderRow}>
            <View style={styles.packageInfoContainer}>
              <Text style={styles.packageName} numberOfLines={2}>
                {pkg.name}
              </Text>
              {providerName ? (
                <Text style={styles.providerSub} numberOfLines={1}>
                  Nhà vườn: {providerName}
                </Text>
              ) : null}
            </View>
            <View style={styles.packagePriceContainer}>
              <Text style={styles.packagePrice}>
                {priceVal ? `${priceVal.toLocaleString('vi-VN')} đ` : 'Thỏa thuận'}
              </Text>
            </View>
          </View>
          <View style={styles.packageMetaRow}>
            <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={14} color="#6027D2" />
              <Text style={styles.metaText}>{pkg.durationDays || 15} ngày chăm sóc</Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="flower-outline" size={14} color="#6027D2" />
              <Text style={styles.metaText}>Tối đa {maxPlantsAllowed} chậu</Text>
            </View>
          </View>
        </View>

        {/* Section 1: Plants */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitleInRow} numberOfLines={1}>
              Danh sách chậu lan ({plants.length}/{maxPlantsAllowed})
            </Text>
            <TouchableOpacity
              style={styles.addPlantButton}
              onPress={handleAddPlant}
              disabled={plants.length >= maxPlantsAllowed}
            >
              <Ionicons name="add" size={16} color="#6027D2" />
              <Text style={styles.addPlantButtonText}>Thêm chậu</Text>
            </TouchableOpacity>
          </View>

          {plants.map((plant, index) => (
            <View key={plant.id} style={styles.plantCard}>
              <View style={styles.plantCardHeader}>
                <Text style={styles.plantIndexLabel}>Chậu #{index + 1}</Text>
                {plants.length > 1 && (
                  <TouchableOpacity onPress={() => handleRemovePlant(plant.id)}>
                    <Ionicons name="trash-outline" size={18} color="#E53E3E" />
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Tên chậu lan *</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="VD: Lan Hồ Điệp Tím chậu 1"
                  value={plant.name}
                  onChangeText={(val) => handleUpdatePlant(plant.id, 'name', val)}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Giống lan / Tình trạng</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="VD: Phalaenopsis / đang vươn chồi"
                  value={plant.speciesName}
                  onChangeText={(val) => handleUpdatePlant(plant.id, 'speciesName', val)}
                />
              </View>

              {/* Khai báo giá trị chậu lan & Tiền bảo đảm */}
              <View style={styles.inputGroup}>
                <TouchableOpacity
                  style={styles.declaredToggleRow}
                  onPress={() => handleUpdatePlant(plant.id, 'isValueDeclared', !plant.isValueDeclared)}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={plant.isValueDeclared ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={plant.isValueDeclared ? '#6027D2' : '#A0AEC0'}
                  />
                  <Text style={styles.declaredToggleText}>Khai báo giá trị chậu lan</Text>
                </TouchableOpacity>

                {plant.isValueDeclared && (
                  <View style={styles.declaredInputBox}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={styles.inputSubLabel}>Giá trị khai báo (VNĐ) *</Text>
                      {(pkgMin !== null || pkgMax !== null) && (
                        <Text style={{ fontSize: 10.5, color: '#6E6A8A', fontWeight: '500' }}>
                          Hạn mức: {pkgMin ? Number(pkgMin).toLocaleString('vi-VN') + 'đ' : '0đ'} - {pkgMax ? Number(pkgMax).toLocaleString('vi-VN') + 'đ' : 'Không giới hạn'}
                        </Text>
                      )}
                    </View>
                    <TextInput
                      style={styles.textInput}
                      placeholder="VD: 2000000"
                      keyboardType="numeric"
                      value={plant.declaredValue}
                      onChangeText={(val) => {
                        const digits = val.replace(/\D/g, '');
                        handleUpdatePlant(plant.id, 'declaredValue', digits);
                      }}
                    />
                    {(() => {
                      const decVal = Number(plant.declaredValue || 0);
                      if (decVal <= 0) return null;

                      // Check out of range
                      const isBelowMin = pkgMin !== null && decVal < pkgMin;
                      const isAboveMax = pkgMax !== null && decVal > pkgMax;

                      if (isBelowMin) {
                        return (
                          <View style={styles.declaredErrorNotice}>
                            <Ionicons name="alert-circle" size={15} color="#DC2626" />
                            <Text style={styles.declaredErrorText}>
                              Giá trị nhỏ hơn mức tối thiểu của gói ({pkgMin?.toLocaleString('vi-VN')} đ). Nếu cây có giá trị thông thường, bạn hãy bỏ tích chọn khai báo để đặt đơn.
                            </Text>
                          </View>
                        );
                      }

                      if (isAboveMax) {
                        return (
                          <View style={styles.declaredErrorNotice}>
                            <Ionicons name="alert-circle" size={15} color="#DC2626" />
                            <Text style={styles.declaredErrorText}>
                              Giá trị vượt mức tối đa của gói ({pkgMax?.toLocaleString('vi-VN')} đ). Vui lòng chọn gói cao cấp hơn hoặc điều chỉnh mức khai báo.
                            </Text>
                          </View>
                        );
                      }

                      const threshold = 2 * priceVal;
                      if (decVal > threshold) {
                        const dep = Math.round(decVal * 0.1);
                        return (
                          <View style={styles.declaredDepositNotice}>
                            <View style={styles.declaredDepositBadge}>
                              <Ionicons name="shield-checkmark" size={14} color="#7C3AED" />
                              <Text style={styles.declaredDepositBadgeText}>
                                Tiền bảo đảm khai giá (10%): +{dep.toLocaleString('vi-VN')} đ
                              </Text>
                            </View>
                            <Text style={styles.declaredDepositSubText}>
                              Giá trị vượt 2 lần giá gói ({threshold.toLocaleString('vi-VN')} đ). Tiền bảo đảm được tạm giữ an toàn và hoàn trả 100% cho bạn khi hoàn tất đơn.
                            </Text>
                          </View>
                        );
                      } else {
                        return (
                          <Text style={styles.declaredNormalNotice}>
                            ✓ Hợp lệ. Nằm trong hạn mức gói (≤ 2 lần giá gói, không thu thêm tiền bảo đảm).
                          </Text>
                        );
                      }
                    })()}
                  </View>
                )}
              </View>

              {/* Photo Upload for Plant */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Ảnh hiện trạng ban đầu (Chụp từ camera)</Text>
                {plant.imageUri ? (
                  <View style={styles.imagePreviewContainer}>
                    <Image source={{ uri: plant.imageUri }} style={styles.imagePreview} />
                    <TouchableOpacity
                      style={styles.changeImageButton}
                      onPress={() => handlePickImage(plant.id)}
                    >
                      <Ionicons name="camera-reverse" size={16} color="#FFFFFF" />
                      <Text style={styles.changeImageText}>Chụp lại</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.uploadBox}
                    onPress={() => handlePickImage(plant.id)}
                  >
                    <Ionicons name="camera-outline" size={24} color="#6027D2" />
                    <Text style={styles.uploadBoxText}>Chụp ảnh chậu lan</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
        </View>

        {/* Section 2: Pickup Location */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionTitle}>Địa chỉ & Vị trí lấy cây</Text>
          <TouchableOpacity
            style={styles.locationSelector}
            onPress={() => setShowLocationPicker(true)}
          >
            <Ionicons name="location" size={20} color="#6027D2" />
            <View style={styles.locationTextContainer}>
              <Text style={styles.locationAddressText} numberOfLines={2}>
                {pickupAddress || 'Chưa chọn địa chỉ'}
              </Text>
              <Text style={styles.locationSubText}>
                Tọa độ: {pickupLat.toFixed(4)}, {pickupLng.toFixed(4)}
              </Text>
              {quoteLoading ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                  <ActivityIndicator size="small" color="#6027D2" />
                  <Text style={{ fontSize: 11, color: '#6E6A8A', marginLeft: 6 }}>
                    Đang tính cước phí đường bộ theo Google Routes...
                  </Text>
                </View>
              ) : pickupQuote ? (
                <View style={styles.distanceBadge}>
                  <Ionicons name="navigate-circle" size={15} color="#6027D2" />
                  <Text style={styles.distanceBadgeText}>
                    Khoảng cách: <Text style={styles.distanceHighlight}>~{pickupQuote.distanceKm} km</Text> · Phí lấy: <Text style={styles.distanceHighlight}>{Number(pickupQuote.pickupFee).toLocaleString('vi-VN')} đ</Text> (tính 1 lần cho cả đơn)
                  </Text>
                </View>
              ) : roadDistanceKm !== null ? (
                <View style={styles.distanceBadge}>
                  <Ionicons name="navigate-circle" size={15} color="#6027D2" />
                  <Text style={styles.distanceBadgeText}>
                    Khoảng cách tới vườn: <Text style={styles.distanceHighlight}>~{roadDistanceKm} km</Text>
                  </Text>
                </View>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color="#A0AEC0" />
          </TouchableOpacity>
        </View>

        {/* Section 3: Scheduled Pickup Time */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionTitle}>Lịch hẹn nhà vườn đến lấy cây</Text>
          <View style={styles.datePickerDisplay}>
            <Ionicons name="calendar-outline" size={20} color="#6027D2" />
            <Text style={styles.datePickerText}>
              {scheduledPickupAt.toLocaleDateString('vi-VN')} -{' '}
              {scheduledPickupAt.toLocaleTimeString('vi-VN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>
        </View>

        {/* Section 4: Customer Note */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionTitle}>Ghi chú cho nhà vườn</Text>
          <TextInput
            style={[styles.textInput, styles.textArea]}
            placeholder="Ghi chú thêm về chế độ tưới, vị trí chậu hoặc lưu ý đặc biệt..."
            multiline
            numberOfLines={3}
            value={customerNote}
            onChangeText={setCustomerNote}
          />
        </View>
      </ScrollView>

      {/* Footer / Submit bar */}
      <View style={styles.footer}>
        <View style={styles.totalPriceContainer}>
          <Text style={styles.totalLabel}>
            Tổng dự kiến thanh toán:
          </Text>
          <Text style={styles.totalValue}>
            {grandTotalEstimate.toLocaleString('vi-VN')} VNĐ
          </Text>
          <Text style={styles.footerShippingNote}>
            Gói ({packageTotalNumber.toLocaleString('vi-VN')}đ)
            {pickupFeeNumber > 0 ? ` + Phí lấy (${pickupFeeNumber.toLocaleString('vi-VN')}đ)` : ''}
            {declaredDepositTotal > 0 ? ` + Bảo đảm (${declaredDepositTotal.toLocaleString('vi-VN')}đ - hoàn 100%)` : ''}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={handleSubmitOrder}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.submitButtonText}>Gửi yêu cầu đặt đơn</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Location Picker Modal */}
      <LocationPickerModal
        visible={showLocationPicker}
        initialAddress={pickupAddress}
        initialLat={pickupLat}
        initialLng={pickupLng}
        onClose={() => setShowLocationPicker(false)}
        onSelectLocation={({ address, lat, lng }) => {
          setPickupAddress(address);
          setPickupLat(lat);
          setPickupLng(lng);
          setShowLocationPicker(false);
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backButton: {
    padding: 6,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1A202C',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  packageCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E9D8FD',
    shadowColor: '#6027D2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  packageHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 8,
  },
  packageInfoContainer: {
    flex: 1,
    marginRight: 8,
  },
  packagePriceContainer: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  packageName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A202C',
  },
  providerSub: {
    fontSize: 12,
    color: '#718096',
    marginTop: 2,
  },
  packagePrice: {
    fontSize: 15,
    fontWeight: '800',
    color: '#6027D2',
    textAlign: 'right',
  },
  packageMetaRow: {
    flexDirection: 'row',
    gap: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F7FAFC',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 12,
    color: '#4A5568',
    fontWeight: '500',
  },
  sectionContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#EDF2F7',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: 10,
  },
  sectionTitleInRow: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2D3748',
    flex: 1,
    marginRight: 6,
  },
  addPlantButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: '#F3E8FF',
    flexShrink: 0,
  },
  addPlantButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6027D2',
  },
  plantCard: {
    backgroundColor: '#F7FAFC',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  plantCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  plantIndexLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6027D2',
  },
  inputGroup: {
    marginBottom: 10,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4A5568',
    marginBottom: 4,
  },
  textInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#2D3748',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  uploadBox: {
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderStyle: 'dashed',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  uploadBoxText: {
    fontSize: 12,
    color: '#6027D2',
    fontWeight: '600',
  },
  imagePreviewContainer: {
    position: 'relative',
    borderRadius: 8,
    overflow: 'hidden',
  },
  imagePreview: {
    width: '100%',
    height: 140,
    borderRadius: 8,
  },
  changeImageButton: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  changeImageText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  locationSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  locationTextContainer: {
    flex: 1,
  },
  locationAddressText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2D3748',
  },
  locationSubText: {
    fontSize: 11,
    color: '#718096',
    marginTop: 2,
  },
  datePickerDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F7FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 12,
    padding: 12,
  },
  datePickerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3748',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  totalPriceContainer: {
    justifyContent: 'center',
    flexShrink: 1,
    marginRight: 12,
  },
  totalLabel: {
    fontSize: 11,
    color: '#718096',
  },
  totalValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#6027D2',
  },
  submitButton: {
    backgroundColor: '#6027D2',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    flexShrink: 0,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  distanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F3E8FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  distanceBadgeText: {
    fontSize: 11,
    color: '#4A5568',
    fontWeight: '500',
  },
  distanceHighlight: {
    fontWeight: '800',
    color: '#6027D2',
  },
  footerShippingNote: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2,
    fontStyle: 'italic',
  },
  declaredToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    marginBottom: 4,
  },
  declaredToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2D3748',
  },
  declaredInputBox: {
    backgroundColor: '#FAF5FF',
    borderWidth: 1,
    borderColor: '#E9D8FD',
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
    gap: 6,
  },
  inputSubLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6027D2',
  },
  declaredDepositNotice: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
    borderRadius: 8,
    padding: 8,
    marginTop: 4,
  },
  declaredDepositBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  declaredDepositBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7C3AED',
  },
  declaredDepositSubText: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 4,
    lineHeight: 15,
  },
  declaredNormalNotice: {
    fontSize: 11.5,
    color: '#059669',
    marginTop: 4,
    fontWeight: '500',
  },
  declaredErrorNotice: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    padding: 8,
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  declaredErrorText: {
    fontSize: 11,
    color: '#B91C1C',
    flex: 1,
    lineHeight: 15,
  },
});
