import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Animated,
} from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import tw from 'twrnc';
import Toast from 'react-native-toast-message';
import { API_HOST, API_URL } from '../utils/constants';
import { AuthContext } from '../../context/AuthContext';

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

const Groups = () => {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [lastMessages, setLastMessages] = useState({});
  const [unreadCounts, setUnreadCounts] = useState({});
  const navigation = useNavigation();
  const { user, accessToken, refreshAccessToken } = React.useContext(AuthContext);
  const ws = useRef(null);
  const scaleAnim = useState(new Animated.Value(1))[0];

  const processGroupProfilePicture = (profilePicture) => {
    if (!profilePicture) return null;
    return profilePicture.startsWith('http') ? profilePicture : `${API_URL}${profilePicture}`;
  };

  const fetchGroups = useCallback(async () => {
    try {
      setLoading(true);
      let token = accessToken;
      if (!token) {
        token = await refreshAccessToken();
        if (!token) throw new Error('No authentication token found');
      }
      const response = await axios.get(`${API_URL}/groups/list/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const groupData = (response.data || []).map(group => ({
        ...group,
        profile_picture: processGroupProfilePicture(group.profile_picture),
      }));
      setGroups(groupData);

      if (groupData.length === 0) {
        Toast.show({
          type: 'info',
          text1: 'No Groups',
          text2: "You might haven't joined any group",
          position: 'bottom',
        });
      }

      const lastMessagesData = {};
      const unreadCountsData = {};
      for (const group of groupData) {
        const lastMessage = await fetchLastMessage(group.id, token);
        lastMessagesData[group.id] = lastMessage;
        unreadCountsData[group.id] = await fetchUnreadCount(group.id, token);
      }
      setLastMessages(lastMessagesData);
      setUnreadCounts(unreadCountsData);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }, [user, accessToken, refreshAccessToken]);

  const fetchLastMessage = async (groupId, token) => {
    try {
      const response = await axios.get(`${API_URL}/groups/messages/${groupId}/`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { page: 1, page_size: 1 },
      });
      const messages = response.data.results || [];
      return messages.length > 0 ? messages[0] : null;
    } catch (error) {
      console.error(`Error fetching last message for group ${groupId}:`, error);
      return null;
    }
  };

  const fetchUnreadCount = async (groupId, token) => {
    try {
      const response = await axios.get(`${API_URL}/groups/messages/${groupId}/`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { page_size: 100 },
      });
      const messages = response.data.results || [];
      return messages.filter((msg) => !(msg.read_by || []).some((u) => u.id === user?.id)).length;
    } catch (error) {
      console.error(`Failed to fetch unread count for group ${groupId}:`, error);
      return 0;
    }
  };

  const searchGroups = useCallback(async (query) => {
    if (!query) return fetchGroups();
    try {
      setLoading(true);
      let token = accessToken;
      if (!token) {
        token = await refreshAccessToken();
        if (!token) throw new Error('No authentication token found');
      }
      const response = await axios.get(`${API_URL}/groups/list/`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { query },
      });
      const groupData = (response.data || []).map(group => ({
        ...group,
        profile_picture: processGroupProfilePicture(group.profile_picture),
      }));
      setGroups(groupData);

      if (groupData.length === 0) {
        Toast.show({
          type: 'info',
          text1: 'No Groups Found',
          text2: "You might haven't joined any group or no groups match your search",
          position: 'bottom',
        });
      }

      const lastMessagesData = {};
      const unreadCountsData = {};
      for (const group of groupData) {
        const lastMessage = await fetchLastMessage(group.id, token);
        lastMessagesData[group.id] = lastMessage;
        unreadCountsData[group.id] = await fetchUnreadCount(group.id, token);
      }
      setLastMessages(lastMessagesData);
      setUnreadCounts(unreadCountsData);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }, [fetchGroups, user, accessToken, refreshAccessToken]);

  const connectWebSocket = async () => {
    if (!user || groups.length === 0) {
      // Avoid WebSocket connection if no groups
      return;
    }

    let token = accessToken;
    if (!token) {
      token = await refreshAccessToken();
      if (!token) {
        Toast.show({
          type: 'error',
          text1: 'Authentication Error',
          text2: 'Failed to refresh token. Please log in again.',
          position: 'bottom',
        });
        return;
      }
    }

    ws.current = new WebSocket(`ws://${API_HOST}/ws/groups/?token=${token}`);
    ws.current.onopen = () => {
      console.log('Groups WebSocket connected');
    };
    ws.current.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'info' && data.message.includes("haven't joined any groups")) {
          Toast.show({
            type: 'info',
            text1: 'No Groups',
            text2: "You might haven't joined any group",
            position: 'bottom',
          });
          return;
        }
        if (data.type === 'group_message') {
          const message = data.message;
          const groupId = message.group_id || message.group?.id;
          setLastMessages((prev) => ({
            ...prev,
            [groupId]: message,
          }));
          if (user) {
            const readByUsers = message.read_by || [];
            const isUnread = !readByUsers.some((u) => u.id === user.id);
            setUnreadCounts((prev) => ({
              ...prev,
              [groupId]: isUnread ? (prev[groupId] || 0) + 1 : prev[groupId],
            }));
          }
        } else if (data.type === 'read_receipt') {
          const message = data.message;
          const groupId = message.group_id || message.group?.id;
          setLastMessages((prev) => ({
            ...prev,
            [groupId]: prev[groupId]?.id === message.id ? message : prev[groupId],
          }));
          if (user) {
            const readByUsers = message.read_by || [];
            const isUnread = !readByUsers.some((u) => u.id === user.id);
            setUnreadCounts((prev) => ({
              ...prev,
              [groupId]: isUnread ? prev[groupId] : Math.max((prev[groupId] || 1) - 1, 0),
            }));
          }
        } else if (data.type === 'group_deleted') {
          setGroups((prev) => prev.filter((group) => group.id !== parseInt(data.group_id)));
          setLastMessages((prev) => {
            const newMessages = { ...prev };
            delete newMessages[data.group_id];
            return newMessages;
          });
          setUnreadCounts((prev) => {
            const newCounts = { ...prev };
            delete newCounts[data.group_id];
            return newCounts;
          });
          Toast.show({
            type: 'info',
            text1: 'Group Deleted',
            text2: data.message,
            position: 'bottom',
          });
          navigation.navigate('Groups');
        } else if (data.type === 'ownership_transferred') {
          setGroups((prev) =>
            prev.map((group) =>
              group.id === parseInt(data.group_id)
                ? { ...group, creator: data.new_owner, admins: data.group_data.admins }
                : group
            )
          );
          Toast.show({
            type: 'info',
            text1: 'Ownership Transferred',
            text2: data.message,
            position: 'bottom',
          });
        }
      } catch (error) {
        console.error('WebSocket message parsing error:', error);
      }
    };
    ws.current.onerror = (error) => {
      Toast.show({
        type: 'error',
        text1: 'Connection Error',
        text2: 'Failed to connect to group chat. Retrying...',
        position: 'bottom',
      });
      setTimeout(connectWebSocket, 2000);
    };
    ws.current.onclose = () => {
      console.log('Groups WebSocket closed');
    };
  };

  const handleError = (error) => {
    console.error('Error:', error);
    Toast.show({
      type: 'error',
      text1: 'Error',
      text2: error.response?.data?.error || error.message || 'An error occurred',
      position: 'bottom',
    });
  };

  const handleIconPressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.9,
      friction: 5,
      tension: 40,
      useNativeDriver: true,
    }).start();
  };

  const handleIconPressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 5,
      tension: 40,
      useNativeDriver: true,
    }).start();
    navigation.navigate('CreateGroup');
  };

  useEffect(() => {
    if (accessToken) {
      fetchGroups();
    } else {
      refreshAccessToken().then((token) => {
        if (token) fetchGroups();
      });
    }
  }, [fetchGroups, accessToken, refreshAccessToken]);

  useEffect(() => {
    if (accessToken) {
      searchGroups(searchText);
    } else {
      refreshAccessToken().then((token) => {
        if (token) searchGroups(searchText);
      });
    }
  }, [searchText, searchGroups, accessToken, refreshAccessToken]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;

      if (accessToken) {
        fetchGroups();
      } else {
        refreshAccessToken().then((token) => {
          if (token) fetchGroups();
        });
      }

      connectWebSocket();

      return () => {
        if (ws.current) {
          ws.current.close();
          console.log('Groups WebSocket disconnected');
        }
      };
    }, [fetchGroups, user, accessToken, refreshAccessToken])
  );

  const renderGroup = ({ item }) => {
    const lastMessage = lastMessages[item.id];
    const unreadCount = unreadCounts[item.id] || 0;

    return (
      <TouchableOpacity
        style={tw`flex-row items-center p-3 bg-white border-b border-gray-200 rounded-lg mx-2 my-1 shadow-sm`}
        onPress={() => navigation.navigate('GroupChatScreen', { groupId: item.id, groupName: item.name })}
      >
        {item.profile_picture ? (
          <Image
            source={{ uri: item.profile_picture }}
            style={tw`w-12 h-12 rounded-full mr-3`}
            onError={() => console.log(`Failed to load profile picture for group ${item.name}`)}
          />
        ) : (
          <View style={tw`w-12 h-12 rounded-full bg-gray-300 flex items-center justify-center mr-3`}>
            <Text style={tw`text-lg font-bold text-white`}>{item.name[0]}</Text>
          </View>
        )}
        <View style={tw`flex-1`}>
          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-lg font-semibold text-gray-800`}>{item.name}</Text>
            {lastMessage?.timestamp && (
              <Text style={tw`text-xs text-gray-500`}>
                {new Date(lastMessage.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            )}
          </View>
          {lastMessage ? (
            <View style={tw`flex-row items-center`}>
              <Text
                style={tw`text-sm text-gray-500 flex-1`}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {lastMessage.sender?.first_name || lastMessage.sender?.username || 'Unknown'}: {lastMessage.message || (lastMessage.file_name ? 'Sent a file' : 'No message')}
              </Text>
              {unreadCount > 0 && (
                <View style={tw`bg-blue-500 rounded-full px-2 py-1 ml-2`}>
                  <Text style={tw`text-xs text-white font-semibold`}>{unreadCount}</Text>
                </View>
              )}
            </View>
          ) : (
            <Text style={tw`text-sm text-gray-500`}>No messages yet</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={tw`flex-1 bg-gray-100`}>
      <View style={tw`p-4`}>
        <View style={tw`flex-row items-center bg-white rounded-full px-3 py-2 border border-gray-200 shadow-sm`}>
          <Ionicons name="search" size={20} color="#9CA3AF" />
          <TextInput
            style={tw`flex-1 ml-2 text-base text-gray-800`}
            placeholder="Search groups..."
            placeholderTextColor="#9CA3AF"
            value={searchText}
            onChangeText={setSearchText}
            autoCapitalize="none"
          />
        </View>
      </View>
      {loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={tw`flex-1 justify-center`} />
      ) : (
        <View style={tw`flex-1`}>
          <View style={tw`flex-row items-start px-4 py-2`}>
            <Text style={tw`text-lg font-semibold text-gray-800 flex-1`}>
              Groups ({groups.length})
            </Text>
            <View style={tw`flex-col items-center`}>
              <TouchableOpacity
                style={tw`w-10 h-10 bg-[${COLORS.primary}] rounded-full items-center justify-center shadow-sm`}
                onPressIn={handleIconPressIn}
                onPressOut={handleIconPressOut}
                accessibilityLabel="Create new group"
                accessibilityRole="button"
                activeOpacity={0.8}
              >
                <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
                  <Ionicons name="add" size={28} color={COLORS.white} />
                </Animated.View>
              </TouchableOpacity>
              <Text style={tw`text-xs text-gray-600 mt-1`}>Create Group</Text>
            </View>
          </View>
          <FlatList
            data={groups}
            renderItem={renderGroup}
            keyExtractor={(item) => item.id.toString()}
            ListEmptyComponent={
              <Text style={tw`text-center mt-5 text-gray-500`}>No groups found</Text>
            }
            contentContainerStyle={tw`pb-4`}
          />
        </View>
      )}
    </View>
  );
};

export default Groups;