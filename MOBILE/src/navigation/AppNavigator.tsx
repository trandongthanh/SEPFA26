import React from 'react';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SplashScreen } from '../screens/SplashScreen';
import { RegisterScreen } from '../screens/RegisterScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { MainTabNavigator } from './MainTabNavigator';
import { ProviderDetailScreen } from '../screens/ProviderDetailScreen';
import { CreateOrderScreen } from '../screens/CreateOrderScreen';
import { OrderDetailScreen } from '../screens/OrderDetailScreen';
import { EkycScreen } from '../screens/EkycScreen';
import { VideoCallScreen } from '../screens/VideoCallScreen';
import { CallProvider } from '../context/CallContext';
import { IncomingCallModal } from '../components/IncomingCallModal';

export type RootStackParamList = {
  Splash: undefined;
  Register: undefined;
  Login: undefined;
  MainTabs: { screen?: string } | undefined;
  ProviderDetail: { providerId: string };
  CreateOrder: {
    providerId: string;
    providerName?: string;
    package: {
      id: string;
      name: string;
      durationDays: number;
      reportFrequencyDays?: number;
      maxPlants: number;
      price?: number;
      basePrice?: string;
      description?: string;
    };
  };
  OrderDetail: { orderId: string };
  Ekyc: undefined;
  VideoCall: {
    callId: string;
    session?: any;
    orderId?: string;
  };
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const Stack = createNativeStackNavigator<RootStackParamList>();

export const AppNavigator: React.FC = () => {
  return (
    <CallProvider>
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator
          initialRouteName="Splash"
          screenOptions={{
            headerShown: false,
            animation: 'fade',
          }}
        >
          <Stack.Screen name="Splash" component={SplashScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
          <Stack.Screen name="MainTabs" component={MainTabNavigator} />
          <Stack.Screen name="ProviderDetail" component={ProviderDetailScreen} />
          <Stack.Screen name="CreateOrder" component={CreateOrderScreen} />
          <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
          <Stack.Screen name="Ekyc" component={EkycScreen} />
          <Stack.Screen
            name="VideoCall"
            component={VideoCallScreen}
            options={{ animation: 'slide_from_bottom' }}
          />
        </Stack.Navigator>

        {/* Global Incoming Call Overlay */}
        <IncomingCallModal
          onAccept={(session) => {
            if (navigationRef.isReady()) {
              navigationRef.navigate('VideoCall', {
                callId: session.call.id,
                session,
                orderId: session.call.orderId,
              });
            }
          }}
        />
      </NavigationContainer>
    </CallProvider>
  );
};
