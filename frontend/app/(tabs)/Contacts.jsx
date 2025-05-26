import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  Image,
  Pressable,
} from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import debounce from 'lodash/debounce';
import tw from 'twrnc';
import { AuthContext } from '../../context/AuthContext';
import { API_URL, API_HOST, PLACEHOLDER_IMAGE } from '../utils/constants';
import ChatScreen from './chatScreen';
import FriendProfile from './FriendProfile';

// COLORS object to match AddContactsScreen
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

const Stack = createStackNavigator();

const ContactsScreen = ({ navigation }) => {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedContactId, setSelectedContactId] = useState(null);
  const parentNavigation = useNavigation();
  const { user, logout } = React.useContext(AuthContext);
  const [ws, setWs] = useState(null);

  const fetchContacts = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      const response = await axios.get(`${API_URL}/contacts/list_with_profiles/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // Sort contacts alphabetically by first_name or username
      const sortedContacts = (response.data || []).sort((a, b) => {
        const nameA = (a.friend.user.first_name || a.friend.user.username || '').toLowerCase();
        const nameB = (b.friend.user.first_name || b.friend.user.username || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
      setContacts(sortedContacts);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const searchContacts = useCallback(
    debounce(async (query) => {
      if (!query) return fetchContacts();
      try {
        setLoading(true);
        const token = await AsyncStorage.getItem('token');
        if (!token) throw new Error('No authentication token found');
        const response = await axios.get(`${API_URL}/contacts/search/`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { query },
        });
        // Sort search results alphabetically
        const sortedContacts = (response.data.results || response.data || []).sort((a, b) => {
          const nameA = (a.friend.user.first_name || a.friend.user.username || '').toLowerCase();
          const nameB = (b.friend.user.first_name || b.friend.user.username || '').toLowerCase();
          return nameA.localeCompare(nameB);
        });
        setContacts(sortedContacts);
      } catch (error) {
        handleError(error);
      } finally {
        setLoading(false);
      }
    }, 300),
    [fetchContacts]
  );

  const startChat = useCallback(
    async (friendId, friendUsername) => {
      if (!user) {
        Alert.alert('Error', 'You must be logged in to start a chat.');
        parentNavigation.navigate('Login');
        return;
      }
      try {
        const token = await AsyncStorage.getItem('token');
        if (!token) throw new Error('No authentication token found');
        navigation.navigate('ChatScreen', {
          senderId: user.id,
          contactId: friendId,
          contactUsername: friendUsername,
        });
      } catch (error) {
        console.error('Start chat error:', {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data,
        });
        Alert.alert('Error', error.response?.data?.error || error.message || 'Failed to start chat');
      }
    },
    [user, navigation, parentNavigation]
  );

  const viewProfile = useCallback(
    (username) => {
      navigation.navigate('FriendProfile', { username });
    },
    [navigation]
  );

  const removeFriend = async (friendId) => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      await axios.delete(`${API_URL}/contacts/remove/${friendId}/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setContacts((prev) => prev.filter((contact) => contact.friend_id !== friendId));
      setSelectedContactId(null);
      Alert.alert('Success', 'Friend removed successfully');
    } catch (error) {
      if (error.response?.status === 404) {
        setContacts((prev) => prev.filter((contact) => contact.friend_id !== friendId));
        setSelectedContactId(null);
        Alert.alert('Info', 'Friend was already removed');
      } else {
        handleError(error);
      }
    }
  };

  const handleError = (error) => {
    console.error('Error:', error);
    if (error.response?.status === 401) {
      Alert.alert('Error', 'Session expired. Please log in again.', [
        {
          text: 'OK',
          onPress: async () => {
            await logout(parentNavigation);
            parentNavigation.navigate('Login');
          },
        },
      ]);
    } else {
      Alert.alert('Error', error.response?.data?.error || error.message || 'An error occurred');
    }
  };

  const setupWebSocket = useCallback(async () => {
    const token = await AsyncStorage.getItem('token');
    if (!token) return;
    const wsInstance = new WebSocket(`ws://${API_HOST}/ws/contacts/?token=${token}`);
    wsInstance.onopen = () => console.log('Contacts WebSocket connected');
    wsInstance.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log('Contacts WebSocket message:', data);
        if (data.type === 'friend_removed') {
          setContacts((prev) => prev.filter((contact) => contact.friend_id !== data.friend_id));
          Alert.alert('Notification', `${data.friend_first_name} removed you as a friend`);
        } else if (data.type === 'friend_request_accepted') {
          setContacts((prev) => {
            const newContacts = [...prev, data.contact];
            // Sort after adding new contact
            return newContacts.sort((a, b) => {
              const nameA = (a.friend.user.first_name || a.friend.user.username || '').toLowerCase();
              const nameB = (b.friend.user.first_name || b.friend.user.username || '').toLowerCase();
              return nameA.localeCompare(nameB);
            });
          });
          Alert.alert(
            'Notification',
            `${data.contact.friend.user.username} accepted your friend request`
          );
        }
      } catch (error) {
        console.error('WebSocket message parsing error:', error);
      }
    };
    wsInstance.onerror = (error) => {
      console.error('WebSocket error:', error);
      setTimeout(setupWebSocket, 2000);
    };
    wsInstance.onclose = () => console.log('Contacts WebSocket closed');
    setWs(wsInstance);
    return () => {
      if (wsInstance) wsInstance.close();
    };
  }, []);

  useEffect(() => {
    if (user) {
      fetchContacts();
      setupWebSocket();
    }
    return () => {
      if (ws) {
        ws.close();
        console.log('Contacts WebSocket cleanup');
      }
    };
  }, [user, fetchContacts, setupWebSocket]);

  useFocusEffect(
    useCallback(() => {
      const currentRoute = parentNavigation.getState()?.routes.find((r) => r.name === 'Contacts');
      if (currentRoute?.params?.refresh) {
        fetchContacts();
        parentNavigation.setParams({ refresh: false });
      }
    }, [fetchContacts, parentNavigation])
  );

  useEffect(() => {
    searchContacts(searchText);
  }, [searchText, searchContacts]);

  const renderItem = ({ item }) => {
    const isOnline =
      item.is_online ||
      (item.friend.last_seen && new Date() - new Date(item.friend.last_seen) < 5 * 60 * 1000);
    const isSelected = selectedContactId === item.friend_id;
    const senderName = item.friend.user.first_name || item.friend.user.username || 'Unknown';
    return (
      <Pressable
        style={tw`flex-row items-center p-4 bg-white rounded-lg mx-4 my-1 shadow-sm border-b border-gray-100 ${
          isSelected ? 'bg-red-50' : ''
        }`}
        onPress={() => {
          if (isSelected) {
            setSelectedContactId(null);
          } else {
            startChat(item.friend_id, item.friend.user.username);
          }
        }}
        onLongPress={() => {
          setSelectedContactId(item.friend_id);
        }}
        delayLongPress={300}
      >
        <TouchableOpacity
          style={tw`relative`}
          onPress={() => viewProfile(item.friend.user.username)}
        >
          <Image
            source={{
              uri:
                item.friend.profile_picture ||
                PLACEHOLDER_IMAGE ||
                `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName)}&background=random`,
            }}
            style={tw`w-12 h-12 rounded-full mr-3`}
            onError={() => console.log(`Failed to load profile picture for ${senderName}`)}
          />
          {isOnline && (
            <View
              style={tw`absolute bottom-0 right-2 w-5 h-5 bg-green-500 rounded-full border-2 border-white`}
            />
          )}
        </TouchableOpacity>
        <View style={tw`flex-1`}>
          <Text style={tw`text-lg font-semibold text-gray-800`}>
            {item.friend.user.first_name || item.friend.user.username}
          </Text>
          <Text style={tw`text-xs mt-1 ${isOnline ? 'text-green-500' : 'text-gray-500'}`}>
            {isOnline
              ? 'Online'
              : `Last seen: ${
                  item.friend.last_seen
                    ? new Date(item.friend.last_seen).toLocaleString()
                    : 'Unknown'
                }`}
          </Text>
        </View>
        {isSelected && (
          <TouchableOpacity
            onPress={() => removeFriend(item.friend_id)}
            style={tw`p-2`}
          >
            <Ionicons name="trash-outline" size={24} color="#EF4444" />
          </TouchableOpacity>
        )}
      </Pressable>
    );
  };

  if (!user) {
    return (
      <View style={tw`flex-1 justify-center items-center bg-gray-100`}>
        <Text style={tw`text-lg text-gray-600 mb-4`}>Please log in to view contacts.</Text>
        <TouchableOpacity
          style={tw`bg-blue-500 px-6 py-2 rounded-full`}
          onPress={() => parentNavigation.navigate('Login')}
        >
          <Text style={tw`text-white font-semibold`}>Go to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={tw`flex-1 bg-gray-100`}>
      <View style={tw`p-4`}>
        <TextInput
          style={tw`bg-white rounded-full px-4 py-2 text-gray-800 border border-gray-200 shadow-sm`}
          placeholder="Search contacts..."
          placeholderTextColor="#9CA3AF"
          value={searchText}
          onChangeText={setSearchText}
          autoCapitalize="none"
        />
      </View>
      {loading ? (
        <ActivityIndicator size="large" color="#007AFF" style={tw`flex-1 justify-center`} />
      ) : (
        <View style={tw`flex-1`}>
          <View style={tw`flex-row items-start px-4 py-2`}>
            <Text style={tw`text-lg font-semibold text-gray-800 flex-1`}>
              Contacts ({contacts.length})
            </Text>
            <View style={tw`flex-col items-center`}>
              <TouchableOpacity
                style={tw`w-10 h-10 bg-[${COLORS.primary}] rounded-full items-center justify-center shadow-sm`}
                onPress={() => parentNavigation.navigate('AddContacts')}
                accessibilityLabel="Add new contact"
                accessibilityRole="button"
              >
                <Ionicons name="add" size={28} color={COLORS.white} />
              </TouchableOpacity>
              <Text style={tw`text-xs text-gray-600 mt-1`}>Add Contact</Text>
            </View>
          </View>
          <FlatList
            data={contacts}
            renderItem={renderItem}
            keyExtractor={(item) => item.friend_id.toString()}
            ListEmptyComponent={
              <Text style={tw`text-center mt-5 text-gray-500`}>
                {searchText ? 'No contacts found' : 'No contacts available'}
              </Text>
            }
            contentContainerStyle={tw`pb-4`}
          />
        </View>
      )}
    </View>
  );
};

const Contacts = () => {
  return (
    <Stack.Navigator
      initialRouteName="ContactsScreen"
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="ContactsScreen" component={ContactsScreen} />
      <Stack.Screen name="ChatScreen" component={ChatScreen} />
      <Stack.Screen name="FriendProfile" component={FriendProfile} />
    </Stack.Navigator>
  );
};

export default Contacts;