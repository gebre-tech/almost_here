import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Image,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import tw from 'twrnc';
import { API_URL } from '../utils/constants';
import { useNavigation } from '@react-navigation/native';

// COLORS object to match Groups.js and ContactsScreen.js
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

const CreateGroupScreen = () => {
  const [groupName, setGroupName] = useState('');
  const [contacts, setContacts] = useState([]);
  const [contactProfiles, setContactProfiles] = useState({});
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigation = useNavigation();
  const inputRef = useRef(null);

  const fetchContacts = useCallback(async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      const response = await axios.get(`${API_URL}/contacts/list_with_profiles/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const contactsData = response.data || [];
      setContacts(contactsData);

      const profiles = {};
      for (const contact of contactsData) {
        try {
          const profileResponse = await axios.get(
            `${API_URL}/profiles/friend/${contact.friend.user.username}/`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const profileData = profileResponse.data;
          const now = new Date();
          const lastSeen = profileData.last_seen ? new Date(profileData.last_seen) : null;
          profileData.is_online = lastSeen && (now - lastSeen) < 5 * 60 * 1000;
          profiles[contact.friend_id] = profileData;
        } catch (error) {
          console.error(`Failed to fetch profile for ${contact.friend.user.username}:`, error);
          profiles[contact.friend_id] = null;
        }
      }
      setContactProfiles(profiles);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleMember = (memberId) => {
    setSelectedMembers((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId]
    );
  };

  const createGroup = async () => {
    if (!groupName.trim()) {
      Alert.alert('Error', 'Group name is required');
      return;
    }
    if (selectedMembers.length === 0) {
      Alert.alert('Error', 'Select at least one member');
      return;
    }
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      await axios.post(
        `${API_URL}/groups/create/`,
        { name: groupName, members: selectedMembers },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      Alert.alert('Success', 'Group created successfully');
      navigation.goBack();
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleError = (error) => {
    console.error('Error:', error);
    Alert.alert('Error', error.response?.data?.error || error.message || 'An error occurred');
  };

  const clearInput = () => {
    setGroupName('');
    inputRef.current?.focus();
  };

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const renderItem = ({ item }) => {
    const profile = contactProfiles[item.friend_id];
    return (
      <TouchableOpacity
        style={tw`flex-row items-center p-4 bg-white rounded-lg mx-4 my-1 shadow-sm border-b border-gray-100`}
        onPress={() => {
          if (item.friend.user.username) navigation.navigate('FriendProfile', { username: item.friend.user.username });
          else Alert.alert('Error', 'User profile unavailable');
        }}
      >
        <Image
          source={{
            uri: profile?.profile_picture || `https://ui-avatars.com/api/?name=${item.friend.user.first_name || item.friend.user.username}&background=random`,
          }}
          style={tw`w-12 h-12 rounded-full mr-3`}
        />
        <View style={tw`flex-1`}>
          <Text style={tw`text-lg font-semibold text-gray-800`}>
            {item.friend.user.first_name || item.friend.user.username}
          </Text>
          {profile && (
            <Text style={tw`text-sm text-gray-500`}>
              {profile.is_online ? 'Online' : `Last seen: ${profile.last_seen ? new Date(profile.last_seen).toLocaleString() : 'Unknown'}`}
            </Text>
          )}
        </View>
        <Ionicons
          name={selectedMembers.includes(item.friend_id) ? 'checkbox' : 'square-outline'}
          size={24}
          color={selectedMembers.includes(item.friend_id) ? '#007AFF' : '#9CA3AF'}
          onPress={() => toggleMember(item.friend_id)}
        />
      </TouchableOpacity>
    );
  };

  return (
    <View style={tw`flex-1 bg-gray-100`}>
      <View style={tw`p-4`}>
        <Text style={tw`text-lg font-semibold text-[${COLORS.text}] mb-2`}>Group Name</Text>
        <View style={tw`flex-row items-center bg-[${COLORS.background}] rounded-xl border border-[${COLORS.border}] shadow-sm px-4 py-3`}>
          <TextInput
            ref={inputRef}
            style={tw`flex-1 text-lg font-medium text-[${COLORS.text}]`}
            placeholder="Enter group name..."
            placeholderTextColor={COLORS.secondary}
            value={groupName}
            onChangeText={setGroupName}
            autoFocus={true}
            autoCapitalize="words"
          />
          {groupName.length > 0 && (
            <TouchableOpacity onPress={clearInput} accessibilityLabel="Clear group name">
              <Ionicons name="close-circle" size={20} color={COLORS.secondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>
      {loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={tw`flex-1 justify-center`} />
      ) : (
        <FlatList
          data={contacts}
          renderItem={renderItem}
          keyExtractor={(item) => item.friend_id.toString()}
          ListEmptyComponent={<Text style={tw`text-center mt-5 text-gray-500`}>No contacts available</Text>}
          contentContainerStyle={tw`pb-4`}
        />
      )}
      <TouchableOpacity
        style={tw`bg-[${COLORS.primary}] m-4 p-4 rounded-lg`}
        onPress={createGroup}
        disabled={loading}
      >
        <Text style={tw`text-white text-center font-semibold`}>Create Group</Text>
      </TouchableOpacity>
    </View>
  );
};

export default CreateGroupScreen;