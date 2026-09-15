import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { GOONG_CONFIG, GoongPrediction, goongService } from '../config/goong';

interface LocationPickerModalProps {
  visible: boolean;
  initialLat?: number | null;
  initialLng?: number | null;
  initialAddress?: string;
  onClose: () => void;
  onSelectLocation: (data: { address: string; lat: number; lng: number }) => void;
}

const DEFAULT_LAT = 10.7769; // TP.HCM
const DEFAULT_LNG = 106.7009;

export const LocationPickerModal: React.FC<LocationPickerModalProps> = ({
  visible,
  initialLat,
  initialLng,
  initialAddress = '',
  onClose,
  onSelectLocation,
}) => {
  const webViewRef = useRef<WebView>(null);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [predictions, setPredictions] = useState<GoongPrediction[]>([]);
  const [searching, setSearching] = useState<boolean>(false);

  const [lat, setLat] = useState<number>(initialLat || DEFAULT_LAT);
  const [lng, setLng] = useState<number>(initialLng || DEFAULT_LNG);
  const [formattedAddress, setFormattedAddress] = useState<string>(initialAddress);
  const [geocoding, setGeocoding] = useState<boolean>(false);

  // Sync initial state on open
  useEffect(() => {
    if (visible) {
      const startLat = initialLat || DEFAULT_LAT;
      const startLng = initialLng || DEFAULT_LNG;
      setLat(startLat);
      setLng(startLng);
      setFormattedAddress(initialAddress);
      setSearchQuery(initialAddress);
      setPredictions([]);
    }
  }, [visible, initialLat, initialLng, initialAddress]);

  // Debounced search for predictions
  useEffect(() => {
    if (!searchQuery || searchQuery.trim().length < 2) {
      setPredictions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      const results = await goongService.searchPlaceAutocomplete(searchQuery);
      setPredictions(results);
      setSearching(false);
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Handle selecting a prediction item
  const handleSelectPrediction = async (item: GoongPrediction) => {
    setPredictions([]);
    setSearchQuery(item.description);
    setGeocoding(true);

    const detail = await goongService.getPlaceDetail(item.place_id);
    setGeocoding(false);

    if (detail) {
      const newLat = detail.location.lat;
      const newLng = detail.location.lng;
      const newAddress = detail.address || item.description;

      setLat(newLat);
      setLng(newLng);
      setFormattedAddress(newAddress);

      // Post message to Leaflet map in WebView to update map center & marker
      if (webViewRef.current) {
        const script = `if (window.updateMapPosition) { window.updateMapPosition(${newLat}, ${newLng}); } true;`;
        webViewRef.current.injectJavaScript(script);
      }
    }
  };

  // Handle receiving message from WebView (Leaflet marker drag end)
  const handleWebViewMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MARKER_DRAGGED' && data.lat && data.lng) {
        const draggedLat = Number(data.lat);
        const draggedLng = Number(data.lng);

        setLat(draggedLat);
        setLng(draggedLng);
        setGeocoding(true);

        // Reverse Geocode
        const addressText = await goongService.reverseGeocode(draggedLat, draggedLng);
        setGeocoding(false);

        if (addressText) {
          setFormattedAddress(addressText);
          setSearchQuery(addressText);
        }
      }
    } catch (err) {
      console.warn('Error parsing webview message:', err);
    }
  };

  const handleConfirm = () => {
    onSelectLocation({
      address: formattedAddress || searchQuery || 'Vị trí đã chọn trên bản đồ',
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
    });
    onClose();
  };

  // Generate Leaflet HTML String with Goong Tile Layer & Draggable Marker
  const goongMapHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <script src="https://cdn.jsdelivr.net/npm/@goongmaps/goong-js@1.0.9/dist/goong-js.js"></script>
        <link href="https://cdn.jsdelivr.net/npm/@goongmaps/goong-js@1.0.9/dist/goong-js.css" rel="stylesheet" />
        <style>
          html, body, #map {
            height: 100%;
            width: 100%;
            margin: 0;
            padding: 0;
            background-color: #f6f4fc;
          }
          .mapboxgl-ctrl-logo, .maplibregl-ctrl-logo {
            display: none !important;
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var curLat = ${lat};
          var curLng = ${lng};
          var maptilesKey = '${GOONG_CONFIG.MAPTILES_KEY}';

          goongjs.accessToken = maptilesKey;

          var map = new goongjs.Map({
            container: 'map',
            style: 'https://tiles.goong.io/assets/goong_map_web.json',
            center: [curLng, curLat],
            zoom: 15
          });

          // Add Zoom controls at bottom right
          map.addControl(new goongjs.NavigationControl({ showCompass: false }), 'bottom-right');

          // Create Draggable Goong Marker Pin
          var marker = new goongjs.Marker({
            color: '#6027D2',
            draggable: true
          })
            .setLngLat([curLng, curLat])
            .addTo(map);

          // Event when marker drag ends
          marker.on('dragend', function () {
            var lngLat = marker.getLngLat();
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'MARKER_DRAGGED',
                lat: lngLat.lat,
                lng: lngLat.lng
              }));
            }
          });

          // Update position programmatically when customer picks a suggestion
          window.updateMapPosition = function(newLat, newLng) {
            marker.setLngLat([newLng, newLat]);
            map.flyTo({
              center: [newLng, newLat],
              zoom: 16,
              essential: true
            });
          };
        </script>
      </body>
    </html>
  `;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={24} color="#1F2937" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Ghim vị trí (Goong Maps)</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* Search & Suggestions Container */}
        <View style={styles.searchSection}>
          <View style={styles.searchInputContainer}>
            <Ionicons name="search" size={20} color="#6B7280" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="Nhập địa chỉ để tìm kiếm..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholderTextColor="#9CA3AF"
            />
            {searching ? (
              <ActivityIndicator size="small" color="#6027D2" />
            ) : searchQuery.length > 0 ? (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Autocomplete Predictions List */}
          {predictions.length > 0 && (
            <View style={styles.predictionsList}>
              <FlatList
                data={predictions}
                keyExtractor={(item) => item.place_id}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.predictionItem}
                    onPress={() => handleSelectPrediction(item)}
                  >
                    <Ionicons name="location-outline" size={18} color="#6027D2" style={{ marginRight: 10, marginTop: 2 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.predictionMainText} numberOfLines={1}>
                        {item.structured_formatting?.main_text || item.description}
                      </Text>
                      <Text style={styles.predictionSubText} numberOfLines={1}>
                        {item.structured_formatting?.secondary_text || item.description}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
              />
            </View>
          )}
        </View>

        {/* Leaflet Map via WebView */}
        <View style={styles.mapContainer}>
          <WebView
            ref={webViewRef}
            originWhitelist={['*']}
            source={{ html: goongMapHtml }}
            onMessage={handleWebViewMessage}
            style={{ flex: 1 }}
            javaScriptEnabled={true}
            domStorageEnabled={true}
          />
          <View style={styles.mapHintBadge}>
            <Ionicons name="hand-left-outline" size={14} color="#6027D2" />
            <Text style={styles.mapHintText}>Chạm & Kéo ghim màu tím để tinh chỉnh vị trí</Text>
          </View>
        </View>

        {/* Bottom Location Info & Confirm Button */}
        <View style={styles.footer}>
          <View style={styles.locationDetails}>
            <View style={styles.locationHeaderRow}>
              <Ionicons name="navigate-circle" size={22} color="#6027D2" />
              <Text style={styles.locationLabel}>Vị trí đang chọn:</Text>
              {geocoding && <ActivityIndicator size="small" color="#6027D2" style={{ marginLeft: 8 }} />}
            </View>
            <Text style={styles.addressText} numberOfLines={2}>
              {formattedAddress || searchQuery || 'Chưa chọn địa chỉ'}
            </Text>
            <Text style={styles.coordsText}>
              Tọa độ GPS: {lat.toFixed(6)}, {lng.toFixed(6)}
            </Text>
          </View>

          <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm}>
            <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={styles.confirmBtnText}>Xác nhận & Sử dụng vị trí này</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1F2937',
  },
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    zIndex: 10,
    backgroundColor: '#FFFFFF',
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 46,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#1F2937',
  },
  predictionsList: {
    position: 'absolute',
    top: 62,
    left: 16,
    right: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    maxHeight: 220,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    zIndex: 20,
  },
  predictionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  predictionMainText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
  },
  predictionSubText: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  mapHintBadge: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    elevation: 3,
  },
  mapHintText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6027D2',
    marginLeft: 6,
  },
  footer: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  locationDetails: {
    backgroundColor: '#F6F4FC',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  locationHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  locationLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6027D2',
    marginLeft: 6,
  },
  addressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 4,
  },
  coordsText: {
    fontSize: 12,
    color: '#6B7280',
  },
  confirmBtn: {
    backgroundColor: '#6027D2',
    height: 50,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
