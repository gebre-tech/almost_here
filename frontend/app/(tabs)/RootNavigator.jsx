import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import BottomTabs from './BottomTabs';
import ProfileScreen from './ProfileScreen';
import AddContacts from './AddContacts';
import CreateGroupScreen from './CreateGroupScreen';
import LogoutScreen from '../(auth)/logout';

const Stack = createStackNavigator();

const COLORS = {
  primary: '#1e88e5',
  secondary: '#6b7280',
  background: '#ffffff',
  cardBackground: '#f9fafb',
  white: '#ffffff',
  error: '#ef4444',
  disabled: '#d1d5db',
  border: '#e5e7eb',
  text: '#111827',
  accent: '#f472b6',
  shadow: 'rgba(0, 0, 0, 0.05)',
  green: '#078930',
  yellow: '#FCDD09',
  red: '#DA121A',
};

export default function RootNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: COLORS.background,
          elevation: 8,
          shadowOpacity: 0.3,
          shadowOffset: { width: 0, height: 4 },
          shadowRadius: 10,
          borderBottomLeftRadius: 20,
          borderBottomRightRadius: 20,
          height: 100,
        },
        headerTintColor: COLORS.text,
        headerTitleStyle: {
          fontSize: 20,
          fontWeight: '700',
          letterSpacing: 0.5,
          color: COLORS.text,
        },
        headerTitleAlign: 'center',
        headerLeftContainerStyle: {
          paddingLeft: 16,
        },
        headerRight: () => (
          <View style={styles.headerRight}>
            <FontAwesome5 name="lock" size={18} color={COLORS.primary} />
            <Text style={styles.headerRightText}>Secure</Text>
          </View>
        ),
      }}
    >
      <Stack.Screen
        name="BottomTabs"
        component={BottomTabs}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ProfileScreen"
        component={ProfileScreen}
        options={({ navigation, route }) => ({
          title: 'My Profile',
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => {
                const { fromMenu, openMenu } = route.params || {};
                if (fromMenu && openMenu) {
                  openMenu();
                  navigation.goBack();
                } else {
                  navigation.navigate('BottomTabs', { screen: 'Home' });
                }
              }}
              accessible
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={24} color={COLORS.primary} />
            </TouchableOpacity>
          ),
        })}
      />
      <Stack.Screen
        name="AddContacts"
        component={AddContacts}
        options={({ navigation, route }) => ({
          title: 'Add Contacts',
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => {
                const { fromMenu, openMenu } = route.params || {};
                if (fromMenu && openMenu) {
                  openMenu();
                  navigation.goBack();
                } else {
                  navigation.navigate('BottomTabs', { screen: 'Home' });
                }
              }}
              accessible
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={24} color={COLORS.primary} />
            </TouchableOpacity>
          ),
        })}
      />
      <Stack.Screen
        name="CreateGroup"
        component={CreateGroupScreen}
        options={({ navigation, route }) => ({
          title: 'Create Group',
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => {
                const { fromMenu, openMenu } = route.params || {};
                if (fromMenu && openMenu) {
                  openMenu();
                  navigation.goBack();
                } else {
                  navigation.navigate('BottomTabs', { screen: 'Home' });
                }
              }}
              accessible
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={24} color={COLORS.primary} />
            </TouchableOpacity>
          ),
        })}
      />
      <Stack.Screen
        name="Logout"
        component={LogoutScreen}
        options={({ navigation, route }) => ({
          title: 'Logout',
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => {
                const { fromMenu, openMenu } = route.params || {};
                if (fromMenu && openMenu) {
                  openMenu();
                  navigation.goBack();
                } else {
                  navigation.navigate('BottomTabs', { screen: 'Home' });
                }
              }}
              accessible
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={24} color={COLORS.primary} />
            </TouchableOpacity>
          ),
        })}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 16,
  },
  headerRightText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
  },
});