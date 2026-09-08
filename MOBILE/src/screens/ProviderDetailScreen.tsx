import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { providerService } from '../services/providerService';
import { ProviderDetail, ServicePackage } from '../types/provider';

interface ProviderDetailScreenProps {
  route: any;
  navigation: any;
}

export const ProviderDetailScreen: React.FC<ProviderDetailScreenProps> = ({
  route,
  navigation,
}) => {
  const { providerId } = route.params || {};

  const [provider, setProvider] = useState<ProviderDetail | null>(null);
  const [packages, setPackages] = useState<ServicePackage[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!providerId) {
      setErrorMsg('Không tìm thấy thông tin nhà cung cấp.');
      setLoading(false);
      return;
    }

    const loadData = async () => {
      setLoading(true);
      try {
        const [detailRes, packagesRes] = await Promise.all([
          providerService.getProviderById(providerId),
          providerService.getProviderPackages(providerId),
        ]);
        setProvider(detailRes);
        setPackages(packagesRes);
      } catch (err: any) {
        console.error('Error loading provider detail:', err);
        setErrorMsg('Không thể tải thông tin nhà cung cấp.');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [providerId]);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
    }).format(price);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingArea}>
        <ActivityIndicator size="large" color="#6027D2" />
        <Text style={styles.loadingText}>Đang tải chi tiết nhà cung cấp...</Text>
      </SafeAreaView>
    );
  }

  if (errorMsg || !provider) {
    return (
      <SafeAreaView style={styles.errorArea}>
        <Ionicons name="alert-circle-outline" size={50} color="#E53E3E" />
        <Text style={styles.errorText}>{errorMsg || 'Đã có lỗi xảy ra'}</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Quay lại</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const isNursery = provider.providerType === 'NURSERY';

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Custom Header */}
      <View style={styles.topHeader}>
        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={22} color="#1A202C" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {provider.displayName}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Provider Main Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatarLargeCircle}>
            <Text style={styles.avatarLargeText}>
              {provider.displayName.substring(0, 2).toUpperCase()}
            </Text>
          </View>

          <Text style={styles.displayNameText}>{provider.displayName}</Text>

          <View style={styles.badgesRow}>
            <View
              style={[
                styles.typeBadge,
                isNursery ? styles.nurseryBadge : styles.expertBadge,
              ]}
            >
              <Text
                style={[
                  styles.typeBadgeText,
                  isNursery ? styles.nurseryBadgeText : styles.expertBadgeText,
                ]}
              >
                {isNursery ? '🏡 Vườn ươm' : '👨‍🌾 Chuyên gia'}
              </Text>
            </View>

            {provider.ratingAvg ? (
              <View style={styles.ratingBadge}>
                <Ionicons name="star" size={14} color="#FFB300" />
                <Text style={styles.ratingText}>
                  {parseFloat(String(provider.ratingAvg)).toFixed(1)} / 5
                </Text>
              </View>
            ) : null}
          </View>

          {provider.bio ? (
            <Text style={styles.bioText}>{provider.bio}</Text>
          ) : null}

          <View style={styles.infoDivider} />

          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={18} color="#6027D2" />
            <Text style={styles.infoValueText}>
              {provider.address || 'Chưa cập nhật địa chỉ'}
            </Text>
          </View>

          {provider.experience ? (
            <View style={styles.infoRow}>
              <Ionicons name="ribbon-outline" size={18} color="#6027D2" />
              <Text style={styles.infoValueText}>
                Kinh nghiệm: {provider.experience}
              </Text>
            </View>
          ) : null}

          {provider.specialties ? (
            <View style={styles.infoRow}>
              <Ionicons name="leaf-outline" size={18} color="#6027D2" />
              <Text style={styles.infoValueText}>
                Chuyên môn: {provider.specialties}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Public Service Packages Section */}
        <View style={styles.packagesSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Gói dịch vụ cung cấp</Text>
            <View style={styles.packageCountBadge}>
              <Text style={styles.packageCountText}>{packages.length} gói</Text>
            </View>
          </View>

          {packages.length === 0 ? (
            <View style={styles.emptyPackagesCard}>
              <Ionicons name="cube-outline" size={36} color="#A0AEC0" />
              <Text style={styles.emptyPackagesText}>
                Nhà cung cấp chưa có gói dịch vụ nào đang hiển thị
              </Text>
            </View>
          ) : (
            packages.map((pkg) => (
              <View key={pkg.id} style={styles.packageCard}>
                <View style={styles.packageCardHeader}>
                  <Text style={styles.packageName}>{pkg.name}</Text>
                  <Text style={styles.packagePrice}>
                    {formatPrice(pkg.price)}
                  </Text>
                </View>

                {pkg.description ? (
                  <Text style={styles.packageDescription}>
                    {pkg.description}
                  </Text>
                ) : null}

                {pkg.durationDays ? (
                  <View style={styles.durationRow}>
                    <Ionicons name="time-outline" size={14} color="#718096" />
                    <Text style={styles.durationText}>
                      Thời hạn: {pkg.durationDays} ngày
                    </Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={styles.bookButton}
                  activeOpacity={0.8}
                  onPress={() => {
                    alert(`Đã chọn gói: ${pkg.name}. Tính năng tạo đơn hàng sắp ra mắt!`);
                  }}
                >
                  <Text style={styles.bookButtonText}>Chọn gói dịch vụ</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7FAFC',
  },
  loadingArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#718096',
  },
  errorArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorText: {
    marginTop: 12,
    fontSize: 16,
    color: '#4A5568',
    textAlign: 'center',
  },
  backButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#6027D2',
    borderRadius: 20,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EDF2F7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A202C',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 12,
  },
  scrollContent: {
    padding: 16,
  },
  profileCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  avatarLargeCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#6027D2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarLargeText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: 'bold',
  },
  displayNameText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A202C',
    marginBottom: 8,
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  typeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  nurseryBadge: {
    backgroundColor: '#F6F4FC',
  },
  nurseryBadgeText: {
    color: '#6027D2',
  },
  expertBadge: {
    backgroundColor: '#F3E5F5',
  },
  expertBadgeText: {
    color: '#7B1FA2',
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8E1',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B78103',
  },
  bioText: {
    fontSize: 13,
    color: '#4A5568',
    textAlign: 'center',
    lineHeight: 18,
  },
  infoDivider: {
    height: 1,
    backgroundColor: '#EDF2F7',
    width: '100%',
    marginVertical: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 8,
    gap: 8,
  },
  infoValueText: {
    fontSize: 13,
    color: '#4A5568',
    flex: 1,
  },
  packagesSection: {
    marginBottom: 24,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A202C',
  },
  packageCountBadge: {
    backgroundColor: '#EDF2F7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  packageCountText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4A5568',
  },
  emptyPackagesCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyPackagesText: {
    fontSize: 13,
    color: '#718096',
    marginTop: 8,
    textAlign: 'center',
  },
  packageCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  packageCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  packageName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A202C',
    flex: 1,
    marginRight: 8,
  },
  packagePrice: {
    fontSize: 15,
    fontWeight: '700',
    color: '#6027D2',
  },
  packageDescription: {
    fontSize: 13,
    color: '#4A5568',
    lineHeight: 18,
    marginBottom: 10,
  },
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 12,
  },
  durationText: {
    fontSize: 12,
    color: '#718096',
  },
  bookButton: {
    backgroundColor: '#6027D2',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  bookButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
