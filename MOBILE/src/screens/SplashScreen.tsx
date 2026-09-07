import React, { useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  Animated,
  Dimensions,
  Easing,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width, height } = Dimensions.get('window');

interface SplashScreenProps {
  navigation?: any;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ navigation }) => {
  // Animation values
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.88)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;
  const textFadeAnim = useRef(new Animated.Value(0)).current;
  const textTranslateY = useRef(new Animated.Value(20)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // 1. Entrance animation for Logo
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 7,
        tension: 35,
        useNativeDriver: true,
      }),
    ]).start();

    // 2. Text slide up and fade in
    Animated.parallel([
      Animated.timing(textFadeAnim, {
        toValue: 1,
        duration: 700,
        delay: 250,
        useNativeDriver: true,
      }),
      Animated.timing(textTranslateY, {
        toValue: 0,
        duration: 700,
        delay: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    // 3. Continuous gentle float loop for logo
    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: -6,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    floatLoop.start();

    // Configurable Splash Duration (4.5 seconds)
    const SPLASH_DURATION = 10000;

    // 4. Progress bar animation matching splash duration
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: SPLASH_DURATION - 300,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start();

    // 5. Navigate to Login after splash duration
    const timer = setTimeout(() => {
      if (navigation) {
        navigation.replace('Login');
      }
    }, SPLASH_DURATION);

    return () => {
      clearTimeout(timer);
      floatLoop.stop();
    };
  }, [fadeAnim, scaleAnim, floatAnim, textFadeAnim, textTranslateY, progressAnim, navigation]);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF8FC" />

      <View style={styles.content}>
        {/* Animated Logo Container */}
        <Animated.View
          style={[
            styles.logoContainer,
            {
              opacity: fadeAnim,
              transform: [
                { scale: scaleAnim },
                { translateY: floatAnim },
              ],
            },
          ]}
        >
          <Image
            source={require('../../assets/images/logo_app.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </Animated.View>

        {/* Animated Text Section */}
        <Animated.View
          style={[
            styles.textContainer,
            {
              opacity: textFadeAnim,
              transform: [{ translateY: textTranslateY }],
            },
          ]}
        >
          <Text style={styles.brandTitle}>
            <Text style={styles.brandLanCare}>LanCare</Text>
            <Text style={styles.brandHub}> Hub</Text>
          </Text>
          <Text style={styles.tagline}>Lan đẹp cho cuộc sống thêm xanh</Text>
        </Animated.View>
      </View>

      {/* Subtle Loading Progress Bar at Bottom */}
      <View style={styles.footer}>
        <View style={styles.progressBarTrack}>
          <Animated.View
            style={[
              styles.progressBarFill,
              {
                width: progressWidth,
              },
            ]}
          />
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF8FC',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },

  logoContainer: {
    width: width * 0.72,
    height: width * 0.72,
    maxWidth: 300,
    maxHeight: 300,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  logo: {
    width: '100%',
    height: '100%',
  },

  textContainer: {
    alignItems: 'center',
  },
  brandTitle: {
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 8,
    textAlign: 'center',
  },
  brandLanCare: {
    color: '#1C0D45',
    fontWeight: '900',
  },
  brandHub: {
    color: '#822BD8',
    fontWeight: '800',
  },
  tagline: {
    fontSize: 15,
    color: '#685984',
    fontWeight: '500',
    letterSpacing: 0.2,
    textAlign: 'center',
  },

  footer: {
    paddingBottom: 40,
    alignItems: 'center',
    width: '100%',
  },
  progressBarTrack: {
    width: 120,
    height: 3.5,
    backgroundColor: '#EBE3F5',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#822BD8',
    borderRadius: 2,
  },
});
