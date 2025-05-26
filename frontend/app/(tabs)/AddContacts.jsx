import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  Animated,
  ActivityIndicator,
} from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import debounce from 'lodash.debounce';
import { API_URL, API_HOST, PLACEHOLDER_IMAGE } from '../utils/constants';
import FriendProfile from './FriendProfile';

// Create a Stack Navigator
const Stack = createNativeStackNavigator();

// COLORS object to match RootNavigator, BottomTabs, and Groups
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

// Simple fuzzy matching function
const simpleFuzzyScore = (text, query) => {
  text = text.toLowerCase();
  query = query.toLowerCase();
  if (text === query) return 1.0;
  if (text.startsWith(query)) return 0.8;
  if (text.includes(query)) return 0.5;

  // Basic fuzzy matching: count matching characters in order
  let score = 0;
  let queryIndex = 0;
  for (let i = 0; i < text.length && queryIndex < query.length; i++) {
    if (text[i] === query[queryIndex]) {
      score += 1;
      queryIndex++;
    }
  }
  return queryIndex === query.length ? score / text.length : 0;
};

// AddContacts screen component
const AddContactsScreen = () => {
  const navigation = useNavigation();
  const [friendQuery, setFriendQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isFocused, setIsFocused] = useState(false);
  const [ws, setWs] = useState(null);
  const [pendingRequests, setPendingRequests] = useState(new Set());
  const [notification, setNotification] = useState(null);
  const inputRef = useRef(null);
  const inputAnim = useRef(new Animated.Value(0)).current;
  const notificationAnim = useRef(new Animated.Value(0)).current;
  const searchCache = useRef(new Map()).current; // Cache for search results

  const resetForm = useCallback(() => {
    setFriendQuery('');
    setError('');
    setSuggestions([]);
    inputRef.current?.blur();
    inputRef.current?.focus();
  }, []);

  const validateInput = (text) => {
    setFriendQuery(text);
    if (!text.trim()) {
      setError('Please enter a name or username');
      setSuggestions([]);
    } else if (text.length < 2) {
      setError('Input must be at least 2 characters');
      setSuggestions([]);
    } else {
      setError('');
      fetchSuggestions(text);
    }
  };

  const fetchSuggestions = useMemo(
    () =>
      debounce(async (query) => {
        if (searchCache.has(query)) {
          setSuggestions(searchCache.get(query));
          return;
        }

        setLoading(true);
        try {
          const token = await AsyncStorage.getItem('token');
          if (!token) {
            setError('Session expired. Please log in again.');
            setTimeout(() => navigation.navigate('Login'), 0); // Deferred navigation
            return;
          }

          // Fetch existing friends
          let friends = [];
          try {
            const friendsResponse = await axios.get(`${API_URL}/contacts/friends/`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            friends = friendsResponse.data.map((friend) => friend.username); // Adjust based on backend response
          } catch (err) {
            console.warn('Failed to fetch friends list:', err.message);
            // Continue without friends list to avoid blocking search
            friends = [];
          }

          // Fetch users with enhanced search
          const usersResponse = await axios.get(`${API_URL}/contacts/search/users/`, {
            headers: { Authorization: `Bearer ${token}` },
            params: { query },
          });

          const users = usersResponse.data.results || [];
          if (users.length === 0) {
            setSuggestions([]);
            setError('No users found matching your search.');
            return;
          }

          // Fetch profile pictures with fallback for 404 errors
          const profilePromises = users.map(async (user) => {
            try {
              const profileResponse = await axios.get(`${API_URL}/profiles/friend/${user.username}/`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              return {
                ...user,
                profile_picture: profileResponse.data.profile_picture || null,
                first_name: user.first_name || user.username, // Fallback to username if no first_name
                last_name: user.last_name || '', // Ensure last_name is always defined
              };
            } catch (err) {
              return {
                ...user,
                profile_picture: null,
                first_name: user.first_name || user.username,
                last_name: user.last_name || '',
              };
            }
          });

          let updatedSuggestions = await Promise.all(profilePromises);

          // Filter out existing friends
          updatedSuggestions = updatedSuggestions.filter((user) => !friends.includes(user.username));

          // Normalize query and split for multi-field search
          const queryLower = query.toLowerCase();
          const queryParts = queryLower.split(/\s+/).filter((part) => part.length > 0);

          // Filter and score suggestions
          updatedSuggestions = updatedSuggestions
            .map((user) => {
              const usernameLower = user.username.toLowerCase();
              const firstNameLower = user.first_name.toLowerCase();
              const lastNameLower = user.last_name.toLowerCase();
              const fullNameLower = `${firstNameLower} ${lastNameLower}`.trim();

              // Calculate relevance score using simpleFuzzyScore
              let relevanceScore = Math.max(
                simpleFuzzyScore(usernameLower, queryLower),
                simpleFuzzyScore(firstNameLower, queryLower),
                simpleFuzzyScore(lastNameLower, queryLower),
                simpleFuzzyScore(fullNameLower, queryLower)
              );

              // Boost scores for exact or prefix matches
              if (usernameLower === queryLower) relevanceScore += 2.0; // Exact username match
              else if (firstNameLower === queryLower) relevanceScore += 1.5; // Exact first name match
              else if (lastNameLower === queryLower) relevanceScore += 1.5; // Exact last name match
              else if (fullNameLower === queryLower) relevanceScore += 1.8; // Exact full name match
              else if (usernameLower.startsWith(queryLower)) relevanceScore += 1.0; // Username prefix
              else if (firstNameLower.startsWith(queryLower)) relevanceScore += 0.8; // First name prefix
              else if (lastNameLower.startsWith(queryLower)) relevanceScore += 0.8; // Last name prefix
              else if (fullNameLower.startsWith(queryLower)) relevanceScore += 0.9; // Full name prefix

              // Multi-field search: check if all query parts match
              const matchesAllParts = queryParts.every(
                (part) =>
                  usernameLower.includes(part) ||
                  firstNameLower.includes(part) ||
                  lastNameLower.includes(part) ||
                  fullNameLower.includes(part)
              );

              return {
                ...user,
                relevanceScore: matchesAllParts ? relevanceScore : 0, // Only include if all parts match
              };
            })
            .filter((user) => user.relevanceScore > 0) // Exclude non-matching results
            .sort((a, b) => b.relevanceScore - a.relevanceScore); // Sort by relevance (descending)

          if (updatedSuggestions.length === 0) {
            setSuggestions([]);
            setError('No users found matching your search.');
            return;
          }

          // Limit to top 5 results
          updatedSuggestions = updatedSuggestions.slice(0, 5);

          setSuggestions(updatedSuggestions);
          searchCache.set(query, updatedSuggestions); // Cache filtered and sorted results
        } catch (err) {
          const status = err.response?.status;
          setError(
            status === 401
              ? 'Session expired. Please log in again.'
              : status === 404
              ? 'User not found. Please check the input.'
              : 'Failed to load suggestions. Please try again.'
          );
          if (status === 401) {
            setTimeout(() => navigation.navigate('Login'), 0); // Deferred navigation
          }
        } finally {
          setLoading(false);
        }
      }, 300),
    [navigation]
  );

  const setupWebSocket = useCallback(async () => {
    const token = await AsyncStorage.getItem('token');
    if (!token) {
      setTimeout(() => {
        setError('Session expired. Please log in again.');
        setNotification('Session expired. Please log in again.');
      }, 0);
      return;
    }

    const websocket = new WebSocket(`ws://${API_HOST}/ws/contacts/?token=${token}`);

    websocket.onopen = () => console.log('WebSocket connected for AddContacts');
    websocket.onmessage = (e) => {
      const data = JSON.parse(e.data);
      const showNotification = (message) => {
        setTimeout(() => {
          setNotification(message);
          Animated.timing(notificationAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }).start();
          setTimeout(() => {
            Animated.timing(notificationAnim, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }).start(() => setNotification(null));
          }, 3000);
        }, 0);
      };

      setTimeout(() => {
        if (data.type === 'friend_request_sent') {
          showNotification(`Friend request sent to ${data.request.receiver.first_name}`);
          setPendingRequests((prev) => {
            const updated = new Set(prev);
            updated.delete(data.request.receiver.username);
            return updated;
          });
          // Update suggestions to mark pending request
          setSuggestions((prev) =>
            prev.map((user) =>
              user.username === data.request.receiver.username
                ? { ...user, has_pending_request: true }
                : user
            )
          );
          resetForm();
        } else if (data.type === 'friend_request_accepted') {
          showNotification(`${data.friend_first_name} accepted your friend request!`);
          // Update suggestions to mark as friend
          setSuggestions((prev) =>
            prev.map((user) =>
              user.username === data.friend_username
                ? { ...user, is_friend: true, has_pending_request: false }
                : user
            )
          );
        } else if (data.type === 'friend_request_rejected') {
          setPendingRequests((prev) => {
            const updated = new Set(prev);
            updated.delete(data.rejected_by_username);
            return updated;
          });
          // Update suggestions to remove pending request
          setSuggestions((prev) =>
            prev.map((user) =>
              user.username === data.rejected_by_username
                ? { ...user, has_pending_request: false }
                : user
            )
          );
          showNotification(`${data.rejected_by} rejected your friend request.`);
        } else if (data.type === 'friend_request_received') {
          showNotification(`New friend request from ${data.request.sender.first_name}`);
        } else if (data.type === 'error') {
          setPendingRequests((prev) => {
            const updated = new Set(prev);
            updated.delete(data.username || '');
            return updated;
          });
          showNotification(data.message);
        }
      }, 0);
    };
    websocket.onerror = () => {
      setTimeout(() => {
        setError('Unable to connect to the server. Please try again.');
        setNotification('Unable to connect to the server. Please try again.');
      }, 0);
    };
    websocket.onclose = () => console.log('WebSocket disconnected');

    setWs(websocket);
    return () => websocket.close();
  }, [resetForm, notificationAnim]);

  const handleSendFriendRequest = async (username, firstName, isFriend, hasPendingRequest) => {
    if (isFriend) {
      setError(`${firstName} is already your friend.`);
      setNotification(`${firstName} is already your friend.`);
      return;
    }
    if (hasPendingRequest || pendingRequests.has(username)) {
      setError(`A friend request to ${firstName} is already pending.`);
      setNotification(`A friend request to ${firstName} is already pending.`);
      return;
    }

    setLoading(true);
    setError('');
    setPendingRequests((prev) => new Set(prev).add(username));

    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        setError('Session expired. Please log in again.');
        setNotification('Session expired. Please log in again.');
        throw new Error('Session expired');
      }
      await axios.post(
        `${API_URL}/contacts/request/`,
        { username },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      if (ws) {
        ws.send(JSON.stringify({ type: 'friend_request', username }));
      }
    } catch (error) {
      setPendingRequests((prev) => {
        const updated = new Set(prev);
        updated.delete(username);
        return updated;
      });
      const message = error.response?.data?.error || `Failed to send friend request to ${firstName}. Please try again.`;
      setError(message);
      setNotification(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cleanup;
    const initializeWebSocket = async () => {
      cleanup = await setupWebSocket();
    };
    initializeWebSocket();
    inputRef.current?.focus();
    Animated.timing(inputAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
    return () => {
      if (cleanup) cleanup();
    };
  }, [setupWebSocket, inputAnim]);

  const renderSuggestion = ({ item }) => {
    const isOnline = item.last_seen && new Date() - new Date(item.last_seen) < 5 * 60 * 1000;
    const sendIconAnim = new Animated.Value(1);
    const senderName = `${item.first_name} ${item.last_name || ''}`.trim() || item.username;

    const handleSendPressIn = () => {
      Animated.spring(sendIconAnim, {
        toValue: 0.9,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }).start();
    };

    const handleSendPressOut = () => {
      Animated.spring(sendIconAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }).start();
    };

    const handleViewProfile = () => {
      navigation.navigate('FriendProfile', { username: item.username });
    };

    const isDisabled = loading || item.is_friend || item.has_pending_request || pendingRequests.has(item.username);
    const iconName = item.is_friend ? 'checkmark-circle' : item.has_pending_request ? 'hourglass-outline' : 'person-add-outline';
    const iconColor = item.is_friend ? COLORS.green : item.has_pending_request ? COLORS.yellow : isDisabled ? COLORS.disabled : COLORS.primary;

    return (
      <View style={styles.suggestionItem}>
        <TouchableOpacity style={styles.suggestionContent} onPress={handleViewProfile}>
          <View style={styles.avatarContainer}>
            <Image
              source={{
                uri:
                  item.profile_picture ||
                  PLACEHOLDER_IMAGE ||
                  `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName)}&background=random`,
              }}
              style={styles.suggestionAvatar}
              resizeMode="cover"
              defaultSource={{ uri: PLACEHOLDER_IMAGE }}
            />
            {isOnline && <View style={styles.onlineIndicator} />}
          </View>
          <View style={styles.suggestionTextContainer}>
            <Text style={styles.suggestionName}>
              {item.first_name} {item.last_name || ''}
            </Text>
            <Text style={styles.suggestionUsername}>@{item.username}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleSendFriendRequest(item.username, item.first_name, item.is_friend, item.has_pending_request)}
          onPressIn={handleSendPressIn}
          onPressOut={handleSendPressOut}
          style={styles.sendIconContainer}
          disabled={isDisabled}
        >
          <Animated.View style={{ transform: [{ scale: sendIconAnim }] }}>
            <Ionicons
              name={iconName}
              size={24}
              color={iconColor}
            />
          </Animated.View>
        </TouchableOpacity>
      </View>
    );
  };

  const inputTranslateY = inputAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [50, 0],
  });

  const inputOpacity = inputAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const notificationOpacity = notificationAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const notificationTranslateY = notificationAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-20, 0],
  });

  const clearNotification = () => {
    Animated.timing(notificationAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => setNotification(null));
  };

  return (
    <View style={styles.outerContainer}>
      <View style={styles.container}>
        {notification && (
          <Animated.View
            style={[
              styles.notificationContainer,
              {
                opacity: notificationOpacity,
                transform: [{ translateY: notificationTranslateY }],
              },
            ]}
          >
            <Text style={styles.notificationText}>{notification}</Text>
            <TouchableOpacity onPress={clearNotification}>
              <Ionicons name="close" size={20} color={COLORS.primary} />
            </TouchableOpacity>
          </Animated.View>
        )}

        <Animated.View
          style={[
            styles.inputWrapper,
            { transform: [{ translateY: inputTranslateY }], opacity: inputOpacity },
          ]}
        >
          <View style={[styles.inputContainer, error && styles.inputError]}>
            <Ionicons name="search-outline" size={24} color={COLORS.secondary} style={styles.inputIcon} />
            <TextInput
              ref={inputRef}
              style={[styles.input, isFocused && styles.inputFocused]}
              placeholder="Search by name or username..."
              placeholderTextColor={COLORS.secondary}
              value={friendQuery}
              onChangeText={validateInput}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={50}
              editable={!loading}
            />
            {friendQuery.length > 0 && (
              <TouchableOpacity onPress={() => setFriendQuery('')} style={styles.clearIcon}>
                <Ionicons name="close-circle" size={20} color={COLORS.secondary} />
              </TouchableOpacity>
            )}
          </View>
          {loading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={COLORS.primary} />
            </View>
          )}
          {suggestions.length > 0 && !error && (
            <View style={styles.suggestionsContainer}>
              <FlatList
                data={suggestions.slice(0, 5)}
                renderItem={renderSuggestion}
                keyExtractor={(item) => item.id?.toString() || item.username}
              />
            </View>
          )}
        </Animated.View>
        {error && !notification && <Text style={styles.errorText}>{error}</Text>}
      </View>
    </View>
  );
};

// Navigator component
const AddContactsNavigator = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AddContactsScreen" component={AddContactsScreen} />
      <Stack.Screen name="FriendProfile" component={FriendProfile} />
    </Stack.Navigator>
  );
};

export default AddContactsNavigator;

// Styles
const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: COLORS.background, // White background to match app
  },
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'flex-start',
  },
  notificationContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.cardBackground,
    padding: 12,
    borderRadius: 12,
    marginTop: 24,
    marginBottom: 10,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  notificationText: {
    fontSize: 14,
    color: COLORS.text,
    flex: 1,
    marginRight: 10,
  },
  inputWrapper: {
    width: '100%',
    marginTop: 24,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  inputIcon: {
    marginLeft: 12,
    marginRight: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.text,
  },
  inputFocused: {
    borderColor: COLORS.primary, // Blue focus to match app
  },
  inputError: {
    borderColor: COLORS.error,
  },
  clearIcon: {
    marginRight: 12,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
  },
  suggestionsContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 8,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    maxHeight: 300,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  suggestionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 12,
  },
  suggestionAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.border,
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    backgroundColor: COLORS.green,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  suggestionTextContainer: {
    flex: 1,
  },
  suggestionName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  suggestionUsername: {
    fontSize: 14,
    color: COLORS.secondary,
  },
  sendIconContainer: {
    padding: 8,
  },
  loadingContainer: {
    alignItems: 'center',
    padding: 10,
  },
});