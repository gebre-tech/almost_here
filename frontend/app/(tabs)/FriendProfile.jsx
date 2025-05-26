import React, { useState, useEffect } from 'react';
import { View, Text, Image, StyleSheet, ActivityIndicator, Alert, TouchableOpacity } from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { API_URL, API_HOST, PLACEHOLDER_IMAGE, DEFAULT_AVATAR_ICON } from '../utils/constants';

const FriendProfile = () => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const navigation = useNavigation();
  const route = useRoute();
  const { username } = route.params || {};

  const fetchFriendProfile = async () => {
    if (!username) {
      Alert.alert("Error", "No username provided.");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      const response = await axios.get(`${API_URL}/profiles/friend/${username}/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      // Ensure we have basic profile data even if some fields are missing
      const profileData = {
        ...response.data,
        user: {
          username: username,
          first_name: response.data.user?.first_name || username.split(' ')[0] || username,
          last_name: response.data.user?.last_name || '',
          ...response.data.user
        },
        bio: response.data.bio || 'No bio available',
        last_seen: response.data.last_seen || null,
        is_online: false // Will be updated below
      };

      const now = new Date();
      const lastSeen = profileData.last_seen ? new Date(profileData.last_seen) : null;
      profileData.is_online = lastSeen && (now - lastSeen) < 5 * 60 * 1000;
      
      setProfile(profileData);
      setImageError(false);
    } catch (error) {
      // Create a minimal profile if the API fails
      const fallbackProfile = {
        user: {
          username: username,
          first_name: username.split(' ')[0] || username,
          last_name: ''
        },
        bio: 'No bio available',
        last_seen: null,
        is_online: false,
        profile_picture: null
      };
      
      setProfile(fallbackProfile);
      
      if (error.response?.status === 401) {
        Alert.alert('Error', 'Session expired. Please log in again.', [
          { text: 'OK', onPress: () => navigation.navigate('Login') },
        ]);
      } else if (error.response?.status !== 404) {
        Alert.alert('Error', error.response?.data?.error || 'Failed to load profile details');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFriendProfile();
  }, [username]);

  if (loading) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  const handleImageError = () => {
    setImageError(true);
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Ionicons name="arrow-back" size={24} color="#007AFF" />
        <Text style={styles.backButtonText}>Back</Text>
      </TouchableOpacity>

      {profile.profile_picture && !imageError ? (
        <Image
          source={{ uri: profile.profile_picture }}
          style={styles.profileImage}
          resizeMode="cover"
          onError={handleImageError}
          accessibilityLabel="Profile picture"
        />
      ) : (
        <View style={[styles.profileImage, styles.profileImageFallback]}>
          <Text style={styles.profileImageFallbackText}>
            {profile.user.first_name?.charAt(0).toUpperCase() || '?'}
          </Text>
        </View>
      )}

      <Text style={styles.name}>
        {profile.user.first_name} {profile.user.last_name}
      </Text>
      
      <Text style={styles.username}>@{profile.user.username}</Text>
      
      <Text style={styles.bio}>{profile.bio}</Text>
      
      <Text style={styles.lastSeen}>
        {profile.is_online
          ? 'Online'
          : profile.last_seen
            ? `Last seen: ${new Date(profile.last_seen).toLocaleString()}`
            : 'Last seen: Unknown'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    alignItems: 'center', 
    padding: 20, 
    backgroundColor: '#f5f5f5' 
  },
  loaderContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  profileImage: {
    width: 150,
    height: 150,
    borderRadius: 75,
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  profileImageFallback: {
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileImageFallbackText: {
    color: 'white',
    fontSize: 60,
    fontWeight: 'bold',
  },
  name: { 
    fontSize: 24, 
    fontWeight: '700', 
    color: '#333', 
    marginBottom: 10,
    textAlign: 'center'
  },
  username: { 
    fontSize: 18, 
    color: '#666', 
    marginBottom: 10 
  },
  bio: { 
    fontSize: 16, 
    color: '#333', 
    textAlign: 'center', 
    marginBottom: 10,
    paddingHorizontal: 20
  },
  lastSeen: { 
    fontSize: 14, 
    color: '#666' 
  },
  errorText: { 
    fontSize: 16, 
    color: '#666', 
    textAlign: 'center', 
    marginBottom: 20 
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'absolute',
    top: 20,
    left: 20,
  },
  backButtonText: { 
    fontSize: 16, 
    color: '#007AFF', 
    marginLeft: 5 
  },
});

export default FriendProfile;