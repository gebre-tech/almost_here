import React, { useState, useEffect, useCallback, useContext, useRef, useMemo } from 'react';
import {
  View, Text, Image, StyleSheet, TouchableOpacity, TextInput, Platform,
  ActivityIndicator, ScrollView
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import axios from 'axios';
import { AuthContext } from '../../context/AuthContext';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_URL, API_HOST, PLACEHOLDER_IMAGE } from '../utils/constants';
import debounce from 'lodash/debounce';

const WS_URL = `ws://${API_HOST}/ws/profile/`;

const COLORS = {
  primary: '#1e88e5',
  secondary: '#6b7280',
  background: '#f5f5f5',
  white: '#ffffff',
  error: '#ef4444',
  disabled: '#d1d5db',
  border: '#e5e7eb',
  text: '#111827',
  shadow: 'rgba(0, 0, 0, 0.1)',
};

function ProfileScreen() {
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [bio, setBio] = useState('');
  const [profileImage, setProfileImage] = useState(PLACEHOLDER_IMAGE);
  const [lastSeen, setLastSeen] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isWsConnected, setIsWsConnected] = useState(false);
  const { user } = useContext(AuthContext);
  const wsRef = useRef(null);

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');

      const response = await axios.get(`${API_URL}/profiles/profile/`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });

      const profileData = response.data;
      setUsername(profileData.user.username || '');
      setFirstName(profileData.user.first_name || '');
      setLastName(profileData.user.last_name || '');
      setBio(profileData.bio || '');
      setLastSeen(profileData.last_seen);
      setProfileImage(profileData.profile_picture
        ? `${profileData.profile_picture}?t=${Date.now()}`
        : PLACEHOLDER_IMAGE);
    } catch (error) {
      console.error('Fetch profile error:', error);
      if (error.response?.status === 404) {
        setUsername(user?.username || 'Your Name');
        setFirstName(user?.first_name || '');
        setLastName(user?.last_name || '');
        setBio('');
        setLastSeen(null);
        setProfileImage(PLACEHOLDER_IMAGE);
      } //else {
        //setError('Failed to load profile. Please try again.');
      //}
    } finally {
      setLoading(false);
    }
  }, [user]);

  const debouncedFetchProfile = useMemo(() => debounce(fetchProfile, 1000), [fetchProfile]);

  const setupWebSocket = useCallback(async () => {
    const token = await AsyncStorage.getItem('token');
    if (!token) return () => {};

    const connectWebSocket = () => {
      const ws = new WebSocket(`${WS_URL}?token=${token}`);
      ws.onopen = () => {
        console.log('Profile WebSocket connected');
        setIsWsConnected(true);
      };
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === 'last_seen_update') {
          setLastSeen(data.last_seen);
        } else if (data.type === 'profile_update') {
          setUsername(data.username || '');
          setFirstName(data.first_name || '');
          setLastName(data.last_name || '');
          setBio(data.bio || '');
          setProfileImage(
            data.profile_picture
              ? `${data.profile_picture}?t=${Date.now()}`
              : PLACEHOLDER_IMAGE
          );
        }
      };
      ws.onerror = (e) => console.error('Profile WebSocket error:', e);
      ws.onclose = () => {
        console.log('Profile WebSocket disconnected, reconnecting...');
        setIsWsConnected(false);
        setTimeout(connectWebSocket, 2000);
      };
      wsRef.current = ws;
    };

    connectWebSocket();
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const updateLastSeen = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && isWsConnected) {
      wsRef.current.send(JSON.stringify({ type: 'update_last_seen' }));
    }
  }, [isWsConnected]);

  const debouncedUpdateLastSeen = useMemo(() => debounce(updateLastSeen, 5000), [updateLastSeen]);

  const processImage = useCallback(async (asset) => {
    if (!['image/jpeg', 'image/png'].includes(asset.mimeType)) {
      setError('Only JPEG and PNG images are supported.');
      return null;
    }
    if (asset.fileSize > 5 * 1024 * 1024) {
      setError('Image must be under 5MB.');
      return null;
    }

    const manipulatedImage = await ImageManipulator.manipulateAsync(
      asset.uri,
      [{ resize: { width: 300, height: 300 } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
    );
    return manipulatedImage.uri;
  }, []);

  const pickFromGallery = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        setError('Permission to access photos denied.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });

      if (!result.canceled) {
        const uri = await processImage(result.assets[0]);
        if (uri) setProfileImage(uri);
      }
    } catch (error) {
      console.error('Pick image error:', error);
      setError('Failed to pick image.');
    }
  }, [processImage]);

  const captureWithCamera = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        setError('Permission to access camera denied.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });

      if (!result.canceled) {
        const uri = await processImage(result.assets[0]);
        if (uri) setProfileImage(uri);
      }
    } catch (error) {
      console.error('Capture image error:', error);
      setError('Failed to capture image.');
    }
  }, [processImage]);

  const validateInputs = useCallback(() => {
    if (!username || username.length < 3 || !/^[a-zA-Z0-9_]+$/.test(username)) {
      setError('Username must be 3+ characters (letters, numbers, underscores).');
      return false;
    }
    if (!firstName || firstName.length < 2 || !/^[a-zA-Z]+$/.test(firstName)) {
      setError('First name must be 2+ letters only.');
      return false;
    }
    if (!lastName || lastName.length < 2 || !/^[a-zA-Z]+$/.test(lastName)) {
      setError('Last name must be 2+ letters only.');
      return false;
    }
    return true;
  }, [username, firstName, lastName]);

  const updateProfile = useCallback(async () => {
    if (!validateInputs()) return;

    setLoading(true);
    setError('');
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');

      const formData = new FormData();
      formData.append('username', username);
      formData.append('first_name', firstName);
      formData.append('last_name', lastName);
      formData.append('bio', bio || '');

      if (profileImage && !profileImage.startsWith('http')) {
        if (Platform.OS !== 'web') {
          const fileInfo = await FileSystem.getInfoAsync(profileImage);
          if (!fileInfo.exists) throw new Error('Image file does not exist');
          formData.append('profile_picture', {
            uri: profileImage,
            name: 'profile.jpg',
            type: 'image/jpeg',
          });
        } else {
          const response = await fetch(profileImage);
          const blob = await response.blob();
          formData.append('profile_picture', blob, 'profile.jpg');
        }
      }

      const response = await axios.post(`${API_URL}/profiles/profile/`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
        timeout: 10000,
      });

      const updatedProfile = response.data;
      setProfileImage(updatedProfile.profile_picture
        ? `${updatedProfile.profile_picture}?t=${Date.now()}`
        : PLACEHOLDER_IMAGE);
      setUsername(updatedProfile.user.username || '');
      setFirstName(updatedProfile.user.first_name || '');
      setLastName(updatedProfile.user.last_name || '');
      setBio(updatedProfile.bio || '');
      setLastSeen(updatedProfile.last_seen);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'update_profile',
          username: updatedProfile.user.username,
          first_name: updatedProfile.user.first_name,
          last_name: updatedProfile.user.last_name,
          bio: updatedProfile.bio,
          profile_picture: updatedProfile.profile_picture,
        }));
      }

      setIsEditing(false);
      setError('');
    } catch (error) {
      console.error('Update profile error:', error);
      setError(`Failed to update profile: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  }, [username, firstName, lastName, bio, profileImage]);

  useEffect(() => {
    let cleanupWebSocket = () => {};
    const initialize = async () => {
      fetchProfile();
      const wsCleanup = await setupWebSocket();
      if (wsCleanup) cleanupWebSocket = wsCleanup;
    };

    initialize();

    const lastSeenInterval = setInterval(debouncedUpdateLastSeen, 300000);
    const fetchInterval = setInterval(debouncedFetchProfile, 300000);

    return () => {
      clearInterval(lastSeenInterval);
      clearInterval(fetchInterval);
      debouncedFetchProfile.cancel();
      debouncedUpdateLastSeen.cancel();
      cleanupWebSocket();
    };
  }, [fetchProfile, setupWebSocket, debouncedUpdateLastSeen, debouncedFetchProfile]);

  if (loading && !username) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <View style={styles.avatarContainer}>
        <Image
          source={{ uri: profileImage || PLACEHOLDER_IMAGE }}
          style={styles.avatar}
          resizeMode="cover"
          onError={(e) => {
            console.error('Image load error:', e.nativeEvent.error);
            setProfileImage(PLACEHOLDER_IMAGE);
          }}
        />
            {isEditing && (
              <View style={styles.avatarEditContainer}>
                <TouchableOpacity
                  style={styles.avatarEditButton}
                  onPress={pickFromGallery}
                  accessible
                  accessibilityLabel="Pick image from gallery"
                >
                  <MaterialCommunityIcons name="image" size={20} color={COLORS.white} />
                  <Text style={styles.avatarEditButtonText}>Gallery</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.avatarEditButton}
                  onPress={captureWithCamera}
                  accessible
                  accessibilityLabel="Take photo with camera"
                >
                  <MaterialCommunityIcons name="camera" size={20} color={COLORS.white} />
                  <Text style={styles.avatarEditButtonText}>Camera</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}

          {isEditing ? (
            <View style={styles.form}>
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Username</Text>
                <TextInput
                  style={styles.input}
                  value={username}
                  onChangeText={setUsername}
                  placeholder="Username"
                  placeholderTextColor={COLORS.secondary}
                  autoCapitalize="none"
                  accessibilityLabel="Username input"
                />
              </View>
              <View style={styles.inputContainer}>
                <Text style={styles.label}>First Name</Text>
                <TextInput
                  style={styles.input}
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="First Name"
                  placeholderTextColor={COLORS.secondary}
                  accessibilityLabel="First name input"
                />
              </View>
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Last Name</Text>
                <TextInput
                  style={styles.input}
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Last Name"
                  placeholderTextColor={COLORS.secondary}
                  accessibilityLabel="Last name input"
                />
              </View>
              <View style={styles.inputContainer}>
                <Text style={styles.label}>Bio</Text>
                <TextInput
                  style={[styles.input, styles.bioInput]}
                  value={bio}
                  onChangeText={setBio}
                  placeholder="Tell us about yourself"
                  placeholderTextColor={COLORS.secondary}
                  multiline
                  maxLength={200}
                  accessibilityLabel="Bio input"
                />
              </View>
              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={updateProfile}
                disabled={loading}
                accessibilityLabel="Save profile"
              >
                <Text style={styles.buttonText}>
                  {loading ? 'Saving...' : 'Save Changes'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.buttonSecondary}
                onPress={() => setIsEditing(false)}
                disabled={loading}
                accessibilityLabel="Cancel editing"
              >
                <Text style={styles.buttonSecondaryText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.details}>
              <Text style={styles.name}>
                {firstName || lastName ? `${firstName} ${lastName}`.trim() : 'No Name'}
              </Text>
              <Text style={styles.username}>
                @{username || 'No Username'}
              </Text>
              <Text style={styles.bio}>
                {bio || 'No bio provided'}
              </Text>
              <Text style={styles.lastSeen}>
                {lastSeen ? `Last seen: ${new Date(lastSeen).toLocaleString()}` : 'Last seen: Not available'}
              </Text>
              <TouchableOpacity
                style={styles.button}
                onPress={() => setIsEditing(true)}
                accessibilityLabel="Edit profile"
              >
                <Text style={styles.buttonText}>Edit Profile</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.buttonSecondary}
                onPress={fetchProfile}
                accessibilityLabel="Refresh profile"
              >
                <Text style={styles.buttonSecondaryText}>Refresh</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default React.memo(ProfileScreen);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 16,
    backgroundColor: COLORS.background,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    elevation: 4,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  avatarContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.background,
  },
  avatarEditContainer: {
    flexDirection: 'row',
    marginTop: 10,
    justifyContent: 'center',
  },
  avatarEditButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginHorizontal: 8,
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  avatarEditButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 6,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  details: {
    alignItems: 'center',
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  username: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.secondary,
    marginBottom: 12,
  },
  bio: {
    fontSize: 16,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  lastSeen: {
    fontSize: 14,
    color: COLORS.secondary,
    marginBottom: 20,
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.white,
  },
  bioInput: {
    height: 100,
    textAlignVertical: 'top',
    paddingVertical: 12,
  },
  button: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: COLORS.disabled,
  },
  buttonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  buttonSecondary: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonSecondaryText: {
    color: COLORS.primary,
    fontSize: 16,
    fontWeight: '500',
  },
  loadingText: {
    marginTop: 12,
    color: COLORS.text,
    fontSize: 16,
    textAlign: 'center',
  },
});