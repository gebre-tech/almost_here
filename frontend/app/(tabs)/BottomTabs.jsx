import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import React, { useState, useEffect, useCallback, useContext } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  Dimensions, View, Text, StyleSheet, Platform, Modal, TouchableOpacity, Animated, SafeAreaView, Image
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { StatusBar } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import ChatStack from './ChatStack';
import Contacts from './Contacts';
import GroupsNavigator from './GroupNavigator';
import FriendRequests from './FriendRequests';
import ThemeContext from '../../context/ThemeContext';
import { API_URL, API_HOST, PLACEHOLDER_IMAGE } from '../utils/constants';

const Tab = createBottomTabNavigator();
const { width, height } = Dimensions.get('window');

const COLORS = {
  light: {
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
  },
  dark: {
    primary: '#60a5fa',
    secondary: '#9ca3af',
    background: '#1f2937',
    cardBackground: '#374151',
    white: '#f3f4f6',
    error: '#f87171',
    disabled: '#6b7280',
    border: '#4b5563',
    text: '#f9fafb',
    accent: '#f9a8d4',
    shadow: 'rgba(0, 0, 0, 0.2)',
    green: '#16a34a',
    yellow: '#facc15',
    red: '#ef4444',
  },
};

export default function BottomTabs() {
  const { darkMode, toggleDarkMode } = useContext(ThemeContext) || { darkMode: false, toggleDarkMode: () => console.warn('ThemeContext unavailable') };
  const theme = darkMode ? COLORS.dark : COLORS.light;

  const [friendRequests, setFriendRequests] = useState([]);
  const [ws, setWs] = useState(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [profileData, setProfileData] = useState({
    username: '',
    firstName: '',
    lastName: '',
    profilePicture: PLACEHOLDER_IMAGE,
  });
  const slideAnim = useState(new Animated.Value(-width))[0];
  const navigation = useNavigation();

  // Fetch profile data
  const fetchProfile = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) return;

      const response = await axios.get(`${API_URL}/profiles/profile/`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });

      const profile = response.data;
      setProfileData({
        username: profile.user.username || '',
        firstName: profile.user.first_name || '',
        lastName: profile.user.last_name || '',
        profilePicture: profile.profile_picture
          ? `${profile.profile_picture}?t=${Date.now()}`
          : PLACEHOLDER_IMAGE,
      });
    } catch (error) {
      //console.error('Fetch profile error:', error);
      setProfileData({
        username: '',
        firstName: '',
        lastName: '',
        profilePicture: PLACEHOLDER_IMAGE,
      });
    }
  }, []);

  // Fetch friend requests
  const fetchFriendRequests = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) return;

      const response = await axios.get(`${API_URL}/contacts/requests/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setFriendRequests(response.data);
    } catch (err) {
      console.error('Error fetching friend requests:', err);
    }
  }, []);

  // Setup WebSocket for real-time updates
  const setupWebSocket = useCallback(async () => {
    const token = await AsyncStorage.getItem('token');
    if (!token) return;

    const websocket = new WebSocket(`ws://${API_HOST}/ws/contacts/?token=${token}`);

    websocket.onopen = () => console.log('WebSocket connected for BottomTabs');
    websocket.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'friend_request') {
        setFriendRequests((prev) => [...prev, data.request]);
      } else if (data.type === 'friend_request_accepted') {
        fetchFriendRequests();
      } else if (data.type === 'profile_update') {
        setProfileData({
          username: data.username || '',
          firstName: data.first_name || '',
          lastName: data.last_name || '',
          profilePicture: data.profile_picture
            ? `${data.profile_picture}?t=${Date.now()}`
            : PLACEHOLDER_IMAGE,
        });
      }
    };
    websocket.onerror = (e) => console.error('WebSocket error:', e);
    websocket.onclose = () => console.log('WebSocket disconnected');

    setWs(websocket);
    return () => websocket.close();
  }, [fetchFriendRequests]);

  useEffect(() => {
    fetchFriendRequests();
    fetchProfile();
    setupWebSocket();
  }, [fetchFriendRequests, fetchProfile, setupWebSocket]);

  // Modal animation controls
  const openMenu = useCallback(() => {
    setMenuVisible(true);
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [slideAnim]);

  const closeMenu = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: -width,
      duration: 300,
      useNativeDriver: true,
    }).start(() => setMenuVisible(false));
  }, [slideAnim]);

  // Custom tab bar icon with badge
  const renderTabIcon = (iconName, focused, hasBadge = false) => {
    const scaleValue = new Animated.Value(focused ? 1.1 : 1);

    useEffect(() => {
      Animated.spring(scaleValue, {
        toValue: focused ? 1.1 : 1,
        friction: 5,
        tension: 40,
        useNativeDriver: true,
      }).start();
    }, [focused]);

    return (
      <Animated.View
        style={[
          styles.iconContainer,
          focused && styles.iconContainerFocused,
          { transform: [{ scale: scaleValue }], backgroundColor: focused ? theme.primary : 'transparent' },
        ]}
      >
        <Ionicons
          name={iconName}
          size={26}
          color={focused ? theme.white : theme.secondary}
        />
        {hasBadge && friendRequests.length > 0 && (
          <View style={[styles.badge, { backgroundColor: theme.red, borderColor: theme.white }]}>
            <Text style={[styles.badgeText, { color: theme.white }]}>
              {friendRequests.length > 9 ? '9+' : friendRequests.length}
            </Text>
          </View>
        )}
      </Animated.View>
    );
  };

  // Generate avatar letter and background color
  const getAvatarLetter = () => {
    const name = profileData.firstName || profileData.username || 'U';
    return name.charAt(0).toUpperCase();
  };

  const getAvatarBackgroundColor = () => {
    const colors = darkMode
      ? ['#60a5fa', '#f9a8d4', '#4ade80', '#fbbf24', '#f87171']
      : ['#1e88e5', '#f472b6', '#22c55e', '#f59e0b', '#ef4444'];
    const name = profileData.firstName || profileData.username || 'U';
    return colors[name.charCodeAt(0) % colors.length];
  };

  // Menu items
  const menuItems = [
    {
      name: profileData.firstName || profileData.username || 'Your Profile',
      renderIcon: () => (
        <View style={[styles.avatarIconContainer, { shadowColor: theme.shadow }]}>
          {profileData.profilePicture && profileData.profilePicture !== PLACEHOLDER_IMAGE ? (
            <Image
              source={{ uri: profileData.profilePicture }}
              style={[styles.avatarIcon, { borderColor: theme.white }]}
              resizeMode="cover"
            />
          ) : (
            <View
              style={[
                styles.avatarIcon,
                { backgroundColor: getAvatarBackgroundColor(), borderColor: theme.white },
              ]}
            >
              <Text style={[styles.avatarLetter, { color: theme.white }]}>{getAvatarLetter()}</Text>
            </View>
          )}
        </View>
      ),
      action: () => {
        closeMenu();
        navigation.navigate('ProfileScreen', { fromMenu: true, openMenu });
      },
    },
    {
      name: darkMode ? 'Light Mode' : 'Dark Mode',
      icon: darkMode ? 'white-balance-sunny' : 'weather-night',
      iconColor: darkMode ? theme.yellow : theme.primary,
      action: () => {
        toggleDarkMode();
      },
    },
    {
      name: 'Logout',
      icon: 'logout',
      iconColor: theme.red,
      action: () => {
        closeMenu();
        navigation.navigate('Logout', { fromMenu: true, openMenu });
      },
    },
  ];

  return (
    <>
      <StatusBar barStyle={darkMode ? 'light-content' : 'dark-content'} backgroundColor={theme.green} />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarStyle: (route => {
            const routeName = getFocusedRouteNameFromRoute(route) ?? '';
            
            if (
              routeName === 'ChatScreen' || 
              routeName === 'GroupChatScreen' ||
              routeName === 'FriendProfile' ||
              routeName === 'GroupInfo' ||
              routeName === 'CreateGroup'
            ) {
              return { display: 'none' };
            }
            
            return {
              backgroundColor: theme.background,
              borderTopWidth: 0,
              elevation: 12,
              shadowOpacity: 0.4,
              shadowOffset: { width: 0, height: -4 },
              shadowRadius: 12,
              shadowColor: theme.shadow,
              height: Platform.OS === 'ios' ? 92 : 72,
              paddingBottom: Platform.OS === 'ios' ? 24 : 12,
              paddingTop: 8,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              overflow: 'hidden',
            };
          })(route),
          tabBarActiveTintColor: theme.white,
          tabBarInactiveTintColor: theme.secondary,
          tabBarLabelStyle: styles.tabBarLabel,
          tabBarItemStyle: styles.tabBarItem,
          headerShown: false,
        })}
      >
        <Tab.Screen
          name="Home"
          component={Contacts}
          options={{
            tabBarIcon: ({ focused }) => renderTabIcon('home', focused),
            tabBarLabel: 'Home',
          }}
        />
        <Tab.Screen
          name="Friend Requests"
          component={FriendRequests}
          options={{
            tabBarIcon: ({ focused }) => renderTabIcon('person-add', focused, true),
            tabBarLabel: 'Requests',
          }}
        />
        <Tab.Screen
          name="Chat"
          component={ChatStack}
          options={{
            tabBarIcon: ({ focused }) => renderTabIcon('chatbubbles', focused),
            tabBarLabel: 'Chat',
          }}
        />
        <Tab.Screen
          name="Group"
          component={GroupsNavigator}
          options={{
            tabBarIcon: ({ focused }) => renderTabIcon('chatbox-ellipses', focused),
            tabBarLabel: 'Groups',
          }}
        />
        <Tab.Screen
          name="Menu"
          component={View}
          listeners={{
            tabPress: (e) => {
              e.preventDefault();
              openMenu();
            },
          }}
          options={{
            tabBarIcon: ({ focused }) => renderTabIcon('menu', focused),
            tabBarLabel: 'Menu',
          }}
        />
      </Tab.Navigator>

      <Modal
        visible={menuVisible}
        transparent
        animationType="none"
        onRequestClose={closeMenu}
      >
        <TouchableOpacity
          style={[styles.modalOverlay, { backgroundColor: 'rgba(0, 0, 0, 0.5)' }]}
          activeOpacity={1}
          onPress={closeMenu}
        >
          <Animated.View
            style={[
              styles.menuContainer,
              { transform: [{ translateX: slideAnim }], backgroundColor: theme.background },
            ]}
          >
            <SafeAreaView style={[styles.menuContent, { backgroundColor: theme.background }]}>
              {menuItems.map((item, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.menuItem,
                    index === 0 && styles.profileMenuItem,
                    { backgroundColor: theme.cardBackground },
                  ]}
                  onPress={item.action}
                  activeOpacity={0.7}
                >
                  {index === 0 ? (
                    <View style={styles.profileItemContainer}>
                      {item.renderIcon()}
                      <Text style={[styles.profileItemText, { color: theme.text }]}>{item.name}</Text>
                    </View>
                  ) : (
                    <>
                      <View style={styles.menuItemIcon}>
                        <MaterialCommunityIcons
                          name={item.icon}
                          size={24}
                          color={item.iconColor || theme.primary}
                        />
                      </View>
                      <Text
                        style={[
                          styles.menuItemText,
                          { color: item.iconColor || theme.text },
                        ]}
                      >
                        {item.name}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              ))}
            </SafeAreaView>
          </Animated.View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  tabBarItem: {
    paddingVertical: 6,
    marginHorizontal: 4,
  },
  tabBarLabel: {
    fontSize: width < 400 ? 11 : 12,
    fontWeight: '600',
    marginBottom: 4,
    letterSpacing: 0.2,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  iconContainerFocused: {
    elevation: 4,
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    elevation: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 12,
  },
  modalOverlay: {
    flex: 1,
  },
  menuContainer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: width * 0.75,
    elevation: 5,
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  menuContent: {
    flex: 1,
    paddingVertical: 24,
    paddingHorizontal: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginVertical: 4,
    marginHorizontal: 8,
  },
  profileMenuItem: {
    flexDirection: 'column',
    alignItems: 'center',
    paddingVertical: 20,
    marginBottom: 8,
  },
  profileItemContainer: {
    alignItems: 'center',
  },
  menuItemIcon: {
    marginRight: 12,
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: '600',
  },
  profileItemText: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },
  avatarIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowOpacity: 0.25,
    shadowRadius: 3,
  },
  avatarIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
  },
  avatarLetter: {
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 64,
  },
});