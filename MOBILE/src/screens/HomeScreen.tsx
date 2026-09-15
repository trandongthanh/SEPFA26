import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { customerService } from '../services/customerService';
import { providerService } from '../services/providerService';
import { CustomerProfileResponse } from '../types/customer';
import { ProviderItem, ProviderType } from '../types/provider';
import { storage } from '../utils/storage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BANNER_WIDTH = SCREEN_WIDTH - 32;

const HERO_BANNERS = [
  {
    id: '1',
    image: require('../../assets/images/hero1.png'),
    tagline: 'Chăm sóc lan – Kết nối đam mê',
    headline: 'Tìm chuyên gia',
    subtext: 'Lan đẹp hơn – Nhờ người chăm đúng',
    cta: 'Khám phá ngay',
  },
  {
    id: '2',
    image: require('../../assets/images/hero2.png'),
    tagline: 'Giải pháp chăm sóc toàn diện',
    headline: 'Dịch vụ bảo dưỡng',
    subtext: 'Cây luôn xanh khỏe – Hoa nở rạng rỡ',
    cta: 'Xem gói dịch vụ',
  },
  {
    id: '3',
    image: require('../../assets/images/hero3.png'),
    tagline: 'Minh bạch & An tâm tuyệt đối',
    headline: 'Theo dõi tiến độ\nchăm sóc dễ dàng',
    subtext: 'Cập nhật nhật ký chăm sóc cây 24/7',
    cta: 'Đặt lịch ngay',
  },
];

interface HomeScreenProps {
  navigation: any;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  // Customer State
  const [customerName, setCustomerName] = useState<string>('Khách hàng');
  const [customerAddress, setCustomerAddress] = useState<string | null>(null);

  // Provider List & Pagination State
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const [total, setTotal] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(true);

  // Filter & Search State
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [selectedType, setSelectedType] = useState<ProviderType | undefined>(undefined);
  const [selectedMinRating, setSelectedMinRating] = useState<number | undefined>(undefined);

  // Hero Banner Carousel State & Ref
  const [activeBannerIndex, setActiveBannerIndex] = useState<number>(0);
  const bannerRef = useRef<FlatList>(null);

  // Unread notifications count (0 until notifications API is integrated)
  const [unreadNotifications] = useState<number>(0);

  // Auto-scroll Hero Carousel every 4.5 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveBannerIndex((prevIndex) => {
        const nextIndex = (prevIndex + 1) % HERO_BANNERS.length;
        bannerRef.current?.scrollToIndex({
          index: nextIndex,
          animated: true,
        });
        return nextIndex;
      });
    }, 4500);

    return () => clearInterval(timer);
  }, []);

  const handleBannerScroll = (event: any) => {
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    const currentIndex = Math.round(contentOffsetX / BANNER_WIDTH);
    if (currentIndex >= 0 && currentIndex < HERO_BANNERS.length) {
      setActiveBannerIndex(currentIndex);
    }
  };

  const renderHeroBannerItem = ({ item }: { item: (typeof HERO_BANNERS)[0] }) => (
    <View style={styles.bannerCard}>
      {/* 1. Botanical Orchid Image (Positioned on the right & center) */}
      <Image source={item.image} style={styles.bannerBotanicalImage} resizeMode="cover" />

      {/* 2. Left Lavender Solid Backdrop (#F7F3FF) */}
      <View style={styles.bannerLeftBackdrop} />

      {/* 3. Translucent Organic Curved Waves for Smooth Blend */}
      <View style={styles.decorativeOrganicCurveAccent} />
      <View style={styles.decorativeOrganicCurveLight} />
      <View style={styles.decorativePetalGlow} />

      {/* 4. Text & CTA Container (Positioned on top of left bright pastel background) */}
      <View style={styles.bannerTextContainer}>
        <Text style={styles.bannerTagline}>{item.tagline}</Text>
        <Text style={styles.bannerHeadline} numberOfLines={2}>
          {item.headline}
        </Text>
        <Text style={styles.bannerSubtext} numberOfLines={1}>
          {item.subtext}
        </Text>

        <TouchableOpacity
          style={styles.bannerCtaButton}
          activeOpacity={0.85}
          onPress={() => {
            // Action
          }}
        >
          <Text style={styles.bannerCtaText}>{item.cta}</Text>
          <Ionicons name="arrow-forward" size={14} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );

  // Load Customer Profile
  const fetchCustomerProfile = async () => {
    try {
      // Prioritize storage user data first
      const storedUser = await storage.getUser();
      if (storedUser?.fullName) {
        setCustomerName(storedUser.fullName);
      }

      const token = await storage.getToken();
      if (!token) return;

      // Fetch latest profile from API if token exists
      const profile: CustomerProfileResponse = await customerService.getMyProfile();
      if (profile.fullName) {
        setCustomerName(profile.fullName);
      }
      if (profile.address) {
        setCustomerAddress(profile.address);
      }
    } catch (error: any) {
      // Ignore 401 for guest users
      if (error?.response?.status !== 401) {
        console.log('Customer profile info:', error?.message || error);
      }
    }
  };

  // Fetch Providers List
  const fetchProviders = async (
    targetPage: number = 1,
    isRefresh: boolean = false
  ) => {
    if (isRefresh) {
      setRefreshing(true);
    } else if (targetPage === 1) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const res = await providerService.getProviders({
        page: targetPage,
        limit: 10,
        keyword: searchKeyword,
        type: selectedType,
        minRating: selectedMinRating,
      });

      if (targetPage === 1) {
        setProviders(res.data);
      } else {
        setProviders((prev) => [...prev, ...res.data]);
      }

      setTotal(res.total);
      setPage(targetPage);
      setHasMore(targetPage * 10 < res.total);
    } catch (error) {
      console.log('Error fetching providers:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchCustomerProfile();
  }, []);

  // Fetch providers when filters or search change
  useEffect(() => {
    fetchProviders(1);
  }, [selectedType, selectedMinRating]);

  // Handle Search Submission
  const handleSearch = () => {
    fetchProviders(1);
  };

  // Pull to refresh
  const onRefresh = useCallback(() => {
    fetchCustomerProfile();
    fetchProviders(1, true);
  }, [searchKeyword, selectedType, selectedMinRating]);

  // Load more pagination
  const handleLoadMore = () => {
    if (!loadingMore && !loading && hasMore) {
      fetchProviders(page + 1);
    }
  };

  // Get Avatar Initials
  const getAvatarInitials = (name: string) => {
    if (!name) return 'KH';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Format Rating
  const formatRating = (rating: number | string | null | undefined) => {
    if (rating === null || rating === undefined) return 'Chưa có';
    const num = typeof rating === 'string' ? parseFloat(rating) : rating;
    if (isNaN(num) || num === 0) return 'Mới';
    return `${num.toFixed(1)}`;
  };

  // Render Provider Card
  const renderProviderCard = ({ item }: { item: ProviderItem }) => {
    const isNursery = item.providerType === 'NURSERY';

    return (
      <TouchableOpacity
        style={styles.cardContainer}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('ProviderDetail', { providerId: item.id })}
      >
        {/* Top Badges & Image Banner */}
        <View style={styles.cardHeaderBanner}>
          <View
            style={[
              styles.typeBadge,
              isNursery ? styles.nurseryBadge : styles.expertBadge,
            ]}
          >
            <Ionicons
              name={isNursery ? 'flower-outline' : 'person-outline'}
              size={12}
              color={isNursery ? '#6027D2' : '#7B1FA2'}
            />
            <Text
              style={[
                styles.typeBadgeText,
                isNursery ? styles.nurseryBadgeText : styles.expertBadgeText,
              ]}
            >
              {isNursery ? 'Vườn ươm' : 'Chuyên gia'}
            </Text>
          </View>

          <View style={styles.ratingBadge}>
            <Ionicons name="star" size={13} color="#FFB300" />
            <Text style={styles.ratingBadgeText}>{formatRating(item.ratingAvg)}</Text>
          </View>
        </View>

        {/* Card Main Info */}
        <View style={styles.cardBody}>
          <View style={styles.titleRow}>
            <Text style={styles.providerName} numberOfLines={1}>
              {item.displayName}
            </Text>
            <Ionicons name="checkmark-circle" size={16} color="#6027D2" />
          </View>

          {item.bio ? (
            <Text style={styles.providerBio} numberOfLines={2}>
              {item.bio}
            </Text>
          ) : null}

          <View style={styles.metaDivider} />

          <View style={styles.cardFooter}>
            <View style={styles.locationContainer}>
              <Ionicons name="location-outline" size={14} color="#666" />
              <Text style={styles.locationText} numberOfLines={1}>
                {item.address || 'TP. Hồ Chí Minh'}
              </Text>
            </View>

            <View style={styles.packageBadge}>
              <Ionicons name="cube-outline" size={13} color="#1565C0" />
              <Text style={styles.packageBadgeText}>
                {item.packageCount || 0} gói
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.userInfoRow}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{getAvatarInitials(customerName)}</Text>
          </View>
          <View style={styles.userTextContainer}>
            <Text style={styles.welcomeSubtext}>Xin chào 👋</Text>
            <Text style={styles.userNameText} numberOfLines={1}>
              {customerName}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.notificationButton}
          activeOpacity={0.7}
          onPress={() => {
            alert('Thông báo: Bạn không có thông báo mới nào.');
          }}
        >
          <Ionicons name="notifications-outline" size={22} color="#1A365D" />
          {unreadNotifications > 0 && (
            <View style={styles.notificationBadge}>
              <Text style={styles.notificationBadgeText}>
                {unreadNotifications}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Main Content Area */}
      <FlatList
        data={providers}
        keyExtractor={(item) => item.id}
        renderItem={renderProviderCard}
        contentContainerStyle={styles.listContentContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#6027D2']} />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        ListHeaderComponent={
          <View style={styles.searchFilterContainer}>
            {/* Hero Carousel Section */}
            <View style={styles.carouselWrapper}>
              <FlatList
                ref={bannerRef}
                data={HERO_BANNERS}
                keyExtractor={(item) => item.id}
                renderItem={renderHeroBannerItem}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                snapToInterval={BANNER_WIDTH}
                decelerationRate="fast"
                onScroll={handleBannerScroll}
                scrollEventThrottle={16}
                getItemLayout={(_, index) => ({
                  length: BANNER_WIDTH,
                  offset: BANNER_WIDTH * index,
                  index,
                })}
              />

              {/* Indicator Dots */}
              <View style={styles.indicatorRow}>
                {HERO_BANNERS.map((_, index) => (
                  <TouchableOpacity
                    key={index}
                    activeOpacity={0.7}
                    onPress={() => {
                      setActiveBannerIndex(index);
                      bannerRef.current?.scrollToIndex({
                        index,
                        animated: true,
                      });
                    }}
                    style={[
                      styles.indicatorDot,
                      activeBannerIndex === index && styles.indicatorDotActive,
                    ]}
                  />
                ))}
              </View>
            </View>

            {/* Search Input */}
            <View style={styles.searchBar}>
              <Ionicons name="search-outline" size={20} color="#718096" />
              <TextInput
                style={styles.searchInput}
                placeholder="Tìm tên nhà cung cấp, vườn ươm..."
                placeholderTextColor="#A0AEC0"
                value={searchKeyword}
                onChangeText={setSearchKeyword}
                onSubmitEditing={handleSearch}
                returnKeyType="search"
              />
              {searchKeyword ? (
                <TouchableOpacity
                  onPress={() => {
                    setSearchKeyword('');
                    fetchProviders(1);
                  }}
                >
                  <Ionicons name="close-circle" size={18} color="#A0AEC0" />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Type Filter Pills */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Loại dịch vụ:</Text>
              <View style={styles.pillsRow}>
                <TouchableOpacity
                  style={[
                    styles.pillButton,
                    selectedType === undefined && styles.pillButtonActive,
                  ]}
                  onPress={() => setSelectedType(undefined)}
                >
                  <Text
                    style={[
                      styles.pillText,
                      selectedType === undefined && styles.pillTextActive,
                    ]}
                  >
                    Tất cả
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.pillButton,
                    selectedType === 'NURSERY' && styles.pillButtonActive,
                  ]}
                  onPress={() => setSelectedType('NURSERY')}
                >
                  <Text
                    style={[
                      styles.pillText,
                      selectedType === 'NURSERY' && styles.pillTextActive,
                    ]}
                  >
                    🏡 Vườn ươm
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.pillButton,
                    selectedType === 'EXPERT' && styles.pillButtonActive,
                  ]}
                  onPress={() => setSelectedType('EXPERT')}
                >
                  <Text
                    style={[
                      styles.pillText,
                      selectedType === 'EXPERT' && styles.pillTextActive,
                    ]}
                  >
                    👨‍🌾 Chuyên gia
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Rating Filter Pills */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Đánh giá tối thiểu:</Text>
              <View style={styles.pillsRow}>
                <TouchableOpacity
                  style={[
                    styles.pillButton,
                    selectedMinRating === undefined && styles.pillButtonActive,
                  ]}
                  onPress={() => setSelectedMinRating(undefined)}
                >
                  <Text
                    style={[
                      styles.pillText,
                      selectedMinRating === undefined && styles.pillTextActive,
                    ]}
                  >
                    Tất cả sao
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.pillButton,
                    selectedMinRating === 4 && styles.pillButtonActive,
                  ]}
                  onPress={() => setSelectedMinRating(4)}
                >
                  <Text
                    style={[
                      styles.pillText,
                      selectedMinRating === 4 && styles.pillTextActive,
                    ]}
                  >
                    ⭐ 4.0 trở lên
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.pillButton,
                    selectedMinRating === 4.5 && styles.pillButtonActive,
                  ]}
                  onPress={() => setSelectedMinRating(4.5)}
                >
                  <Text
                    style={[
                      styles.pillText,
                      selectedMinRating === 4.5 && styles.pillTextActive,
                    ]}
                  >
                    ⭐ 4.5 trở lên
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* List Result Summary */}
            <View style={styles.resultSummaryRow}>
              <Text style={styles.resultSummaryText}>
                {loading ? 'Đang tìm...' : `Tìm thấy ${total} nhà cung cấp`}
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="search-outline" size={50} color="#CBD5E0" />
              <Text style={styles.emptyTitle}>Không tìm thấy Nhà cung cấp nào</Text>
              <Text style={styles.emptySubtext}>
                Thử thay đổi từ khóa hoặc bộ lọc của bạn
              </Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => {
                  setSearchKeyword('');
                  setSelectedType(undefined);
                  setSelectedMinRating(undefined);
                }}
              >
                <Text style={styles.retryButtonText}>Xóa bộ lọc</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#6027D2" />
              <Text style={styles.loadingText}>Đang tải danh sách...</Text>
            </View>
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color="#6027D2" />
              <Text style={styles.footerLoaderText}>Tải thêm danh sách...</Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F4FC',
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
  userInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#6027D2',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  userTextContainer: {
    flex: 1,
  },
  welcomeSubtext: {
    fontSize: 12,
    color: '#718096',
  },
  userNameText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A202C',
  },
  notificationButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EDF2F7',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  notificationBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: '#E53E3E',
    borderRadius: 8,
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  listContentContainer: {
    paddingBottom: 24,
  },
  carouselWrapper: {
    marginBottom: 16,
    position: 'relative',
  },
  bannerCard: {
    width: BANNER_WIDTH,
    height: 180,
    borderRadius: 20,
    backgroundColor: '#F7F3FF',
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#6027D2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#EFE8FE',
  },
  bannerBotanicalImage: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    zIndex: 1,
  },
  bannerLeftBackdrop: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '54%',
    backgroundColor: 'rgba(247, 243, 255, 0.4)',
    zIndex: 2,
  },
  decorativeOrganicCurveLight: {
    position: 'absolute',
    left: '42%',
    top: -45,
    bottom: -45,
    width: 110,
    borderRadius: 55,
    backgroundColor: 'rgba(247, 243, 255, 0.4)',
    zIndex: 3,
    transform: [{ rotate: '-8deg' }, { scaleY: 1.3 }],
  },
  decorativeOrganicCurveAccent: {
    position: 'absolute',
    left: '52%',
    top: -30,
    bottom: -30,
    width: 75,
    borderRadius: 37.5,
    backgroundColor: 'rgba(247, 243, 255, 0.65)',
    zIndex: 2,
    transform: [{ rotate: '-12deg' }, { scaleY: 1.2 }],
  },
  decorativePetalGlow: {
    position: 'absolute',
    left: '35%',
    top: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(235, 222, 254, 0.4)',
    zIndex: 3,
  },
  bannerTextContainer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '64%',
    paddingLeft: 18,
    paddingVertical: 16,
    paddingRight: 6,
    justifyContent: 'center',
    zIndex: 4,
  },
  bannerTagline: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#6B5B95',
    marginBottom: 4,
  },
  bannerHeadline: {
    fontSize: 18,
    fontWeight: '800',
    color: '#38206F',
    lineHeight: 23,
    marginBottom: 4,
  },
  bannerSubtext: {
    fontSize: 11.5,
    fontWeight: '500',
    color: '#5B4B8A',
    marginBottom: 12,
  },
  bannerCtaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#6027D2',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  bannerCtaText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  indicatorRow: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    zIndex: 10,
  },
  indicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(216, 206, 246, 0.85)',
  },
  indicatorDotActive: {
    width: 22,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#6027D2',
  },
  searchFilterContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#2D3748',
    marginLeft: 8,
    marginRight: 4,
  },
  filterSection: {
    marginBottom: 12,
  },
  filterSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4A5568',
    marginBottom: 6,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pillButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#EDF2F7',
    borderWidth: 1,
    borderColor: '#CBD5E0',
  },
  pillButtonActive: {
    backgroundColor: '#6027D2',
    borderColor: '#6027D2',
  },
  pillText: {
    fontSize: 12,
    color: '#4A5568',
    fontWeight: '500',
  },
  pillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  resultSummaryRow: {
    marginTop: 4,
    marginBottom: 8,
  },
  resultSummaryText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#718096',
  },
  cardContainer: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeaderBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F6F4FC',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
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
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 3,
  },
  ratingBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B78103',
  },
  cardBody: {
    padding: 14,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  providerName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A202C',
    flex: 1,
  },
  providerBio: {
    fontSize: 13,
    color: '#4A5568',
    lineHeight: 18,
    marginBottom: 10,
  },
  metaDivider: {
    height: 1,
    backgroundColor: '#EDF2F7',
    marginVertical: 8,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
    gap: 4,
  },
  locationText: {
    fontSize: 12,
    color: '#718096',
    flex: 1,
  },
  packageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F6F4FC',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
  },
  packageBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6027D2',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#4A5568',
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#A0AEC0',
    marginTop: 4,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#6027D2',
    borderRadius: 20,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  loadingContainer: {
    padding: 32,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 13,
    color: '#718096',
  },
  footerLoader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  footerLoaderText: {
    fontSize: 12,
    color: '#718096',
  },
});
