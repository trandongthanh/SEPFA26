import axios from 'axios';

const API_KEY = process.env.EXPO_PUBLIC_GOONG_API_KEY || 'G5dAJG36KP8A1UbXB7ZRcm5FWuvDCMbxtZ0Bx1cW';
const MAPTILES_KEY = process.env.EXPO_PUBLIC_GOONG_MAPTILES_KEY || 'khUFJzCSxyKY4UQaptgFcHa8ZmJ0SeOsm3EzqRUM';

export const GOONG_CONFIG = {
  API_KEY,
  MAPTILES_KEY,
  BASE_URL: 'https://rsapi.goong.io',
  TILE_URL: `https://tiles.goong.io/assets/tiles/{z}/{x}/{y}.png?api_key=${MAPTILES_KEY}`,
};

export interface GoongPrediction {
  description: string;
  place_id: string;
  structured_formatting?: {
    main_text?: string;
    secondary_text?: string;
  };
}

export interface GoongLocation {
  lat: number;
  lng: number;
}

export const goongService = {
  /**
   * Tim kiem goi y dia chi (Place Autocomplete)
   */
  async searchPlaceAutocomplete(query: string): Promise<GoongPrediction[]> {
    if (!query || query.trim().length < 2) return [];
    try {
      const response = await axios.get(`${GOONG_CONFIG.BASE_URL}/Place/AutoComplete`, {
        params: {
          api_key: GOONG_CONFIG.API_KEY,
          input: query,
        },
      });
      if (response.data && response.data.predictions) {
        return response.data.predictions;
      }
      return [];
    } catch (error) {
      console.warn('Goong Autocomplete error:', error);
      return [];
    }
  },

  /**
   * Lay chi tiet toa do va dia chi tu place_id
   */
  async getPlaceDetail(placeId: string): Promise<{ address: string; location: GoongLocation } | null> {
    try {
      const response = await axios.get(`${GOONG_CONFIG.BASE_URL}/Place/Detail`, {
        params: {
          api_key: GOONG_CONFIG.API_KEY,
          place_id: placeId,
        },
      });
      const result = response.data?.result;
      if (result && result.geometry?.location) {
        return {
          address: result.formatted_address || result.name || '',
          location: {
            lat: result.geometry.location.lat,
            lng: result.geometry.location.lng,
          },
        };
      }
      return null;
    } catch (error) {
      console.warn('Goong Place Detail error:', error);
      return null;
    }
  },

  /**
   * Dich nguoc toa do sang chuoi dia chi text (Reverse Geocoding)
   */
  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    try {
      const response = await axios.get(`${GOONG_CONFIG.BASE_URL}/Geocode`, {
        params: {
          api_key: GOONG_CONFIG.API_KEY,
          latlng: `${lat},${lng}`,
        },
      });
      const results = response.data?.results;
      if (results && results.length > 0 && results[0].formatted_address) {
        return results[0].formatted_address;
      }
      return null;
    } catch (error) {
      console.warn('Goong Reverse Geocode error:', error);
      return null;
    }
  },
};
