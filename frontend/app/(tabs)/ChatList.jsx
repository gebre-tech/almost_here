import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Alert,
  StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import tw from 'twrnc';
import { AuthContext } from '../../context/AuthContext';
import { API_URL, API_HOST, PLACEHOLDER_IMAGE } from '../utils/constants';
import aesjs from 'aes-js';
import { Buffer } from 'buffer';
import { x25519 } from '@noble/curves/ed25519';
import * as Crypto from 'expo-crypto';

// Import decryption logic from ChatScreen
async function fetchReceiverPublicKey(receiverId, token) {
  try {
    const response = await fetch(`${API_URL}/auth/user/${receiverId}/public_key/`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });
    const data = await response.json();
    if (response.ok) {
      console.log("(NOBRIDGE) LOG Fetched receiver_public_key:", data.public_key);
      return data.public_key;
    }
    console.error("(NOBRIDGE) ERROR Failed to fetch receiver public key:", data);
    return null;
  } catch (error) {
    console.error("(NOBRIDGE) ERROR Fetch receiver public key error:", error.message);
    return null;
  }
}

class NoiseNN {
  constructor(senderId, receiverId, token, email) {
    this.senderId = senderId;
    this.receiverId = receiverId;
    this.token = token;
    this.email = email;
    this.baseKeyPair = null;
    this.remoteBasePublicKey = null;
    this.baseSharedSecret = null;
    this.handshakeFinished = false;
  }

  async initialize() {
    try {
      const [privateKeyHex, publicKeyHex] = await Promise.all([
        AsyncStorage.getItem(`private_key_${this.email}`),
        AsyncStorage.getItem(`public_key_${this.email}`),
      ]);

      console.log(`(NOBRIDGE) LOG Initializing NoiseNN for sender ${this.senderId}, receiver ${this.receiverId}`);
      console.log(`(NOBRIDGE) LOG Private Key: ${privateKeyHex}, Public Key: ${publicKeyHex}`);

      if (!privateKeyHex || !publicKeyHex || !this.isValidKeyPair(privateKeyHex, publicKeyHex)) {
        throw new Error("Keys not found or invalid.");
      }

      this.baseKeyPair = {
        privateKey: Buffer.from(privateKeyHex, 'hex'),
        publicKey: Buffer.from(publicKeyHex, 'hex'),
      };

      const receiverPublicKeyHex = await fetchReceiverPublicKey(this.receiverId, this.token);
      console.log(`(NOBRIDGE) LOG Receiver Public Key: ${receiverPublicKeyHex}`);

      if (receiverPublicKeyHex && this.isValidPublicKey(receiverPublicKeyHex)) {
        await AsyncStorage.setItem(`receiver_public_key_${this.receiverId}`, receiverPublicKeyHex);
        this.remoteBasePublicKey = Buffer.from(receiverPublicKeyHex, 'hex');
        const rawSharedSecret = x25519.scalarMult(this.baseKeyPair.privateKey, this.remoteBasePublicKey);
        this.baseSharedSecret = Buffer.from(rawSharedSecret.slice(0, 32));
        this.handshakeFinished = true;
        console.log(`(NOBRIDGE) LOG Handshake finished, Shared Secret: ${this.baseSharedSecret.toString('hex')}`);
      } else {
        throw new Error("Failed to fetch or validate receiver's public key.");
      }
    } catch (error) {
      console.error("(NOBRIDGE) ERROR NoiseNN initialization failed:", error.message);
      throw error;
    }
  }

  async generateKeyPair() {
    const privateKey = Buffer.from(x25519.utils.randomPrivateKey());
    const publicKey = Buffer.from(x25519.getPublicKey(privateKey));
    return { privateKey, publicKey };
  }

  isValidPublicKey(publicKeyHex) {
    try {
      const publicKey = Buffer.from(publicKeyHex, 'hex');
      return publicKey.length === 32;
    } catch (error) {
      return false;
    }
  }

  isValidKeyPair(privateKeyHex, publicKeyHex) {
    try {
      const privateKey = Buffer.from(privateKeyHex, 'hex');
      const publicKey = Buffer.from(publicKeyHex, 'hex');
      const computedPublicKey = Buffer.from(x25519.getPublicKey(privateKey));
      return privateKey.length === 32 && publicKey.length === 32 && computedPublicKey.equals(publicKey);
    } catch (error) {
      return false;
    }
  }

  async generateMessageKey(remoteEphemeralPublicKey = null) {
    if (!this.handshakeFinished) {
      throw new Error("Handshake not completed.");
    }

    const ephemeralKeyPair = remoteEphemeralPublicKey ? null : await this.generateKeyPair();
    const ephPubKey = remoteEphemeralPublicKey ? Buffer.from(remoteEphemeralPublicKey, 'hex') : ephemeralKeyPair.publicKey;

    const normalizedSharedSecret = Buffer.from(this.baseSharedSecret).slice(0, 32);
    const normalizedEphPubKey = Buffer.from(ephPubKey).slice(0, 32);

    const concatBytes = new Uint8Array(64);
    concatBytes.set(normalizedSharedSecret, 0);
    concatBytes.set(normalizedEphPubKey, 32);

    const messageKey = await Crypto.digest(
      Crypto.CryptoDigestAlgorithm.SHA256,
      concatBytes
    );
    const key = Buffer.from(messageKey).slice(0, 32);

    console.log(`(NOBRIDGE) LOG Generated Message Key: ${key.toString('hex')}`);

    return {
      publicKey: ephemeralKeyPair ? ephemeralKeyPair.publicKey : null,
      key,
    };
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' }, // White background
});

const ChatListItem = memo(({ item, navigateToChat, userId }) => {
  const { contact, lastMessage, timestamp, isOnline, unreadCount } = item;

  // Format timestamp for display (e.g., "Sun", "Mon", or time if today)
  const formatTimestamp = (date) => {
    if (!date) return '';
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return `${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')} ${date.getHours() >= 12 ? 'PM' : 'AM'}`;
    }
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[date.getDay()];
  };

  // Determine message preview
  let messagePreview = '';
  let isSentMessage = false;
  if (lastMessage) {
    if (lastMessage.decryptedContent) {
      messagePreview = lastMessage.decryptedContent;
    } else if (lastMessage.file) {
      messagePreview = lastMessage.file_type?.startsWith('image/') ? 'Photo' : 'File';
    } else {
      messagePreview = '[Encrypted]';
    }
    // Check if the message was sent by the current user
    isSentMessage = lastMessage.sender === userId;
  }

  // Prepare the name for the avatar fallback
  const senderName = contact.friend.user.first_name || contact.friend.user.username || 'Unknown';

  return (
    <TouchableOpacity
      style={tw`flex-row items-center p-3 bg-white mx-2 my-0.5 border-b border-gray-200`}
      onPress={() => navigateToChat(contact.friend_id, contact.friend.user.username)}
    >
      <View style={tw`relative`}>
        <Image
          source={{
            uri:
              contact.friend.profile_picture ||
              PLACEHOLDER_IMAGE ||
              `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName)}&background=random`,
          }}
          style={tw`w-10 h-10 rounded-full mr-3`}
          onError={() => console.log(`Failed to load profile picture for ${senderName}`)}
        />
        {isOnline && (
          <View
            style={tw`absolute bottom-0 right-2 w-4 h-4 bg-green-500 rounded-full border-2 border-white`}
          />
        )}
      </View>
      <View style={tw`flex-1`}>
        <Text style={tw`text-base font-semibold text-black`}>
          {contact.friend.user.first_name || contact.friend.user.username}
        </Text>
        <Text
          style={tw`text-xs mt-1 ${isSentMessage ? 'text-teal-600' : 'text-blue-600'}`}
          numberOfLines={1}
        >
          {messagePreview || 'No messages yet'}
        </Text>
      </View>
      <View style={tw`flex-col items-end`}>
        <Text style={tw`text-xs text-gray-600`}>{formatTimestamp(timestamp)}</Text>
        {unreadCount > 0 && (
          <View style={tw`bg-red-500 rounded-full px-2 py-0.5 mt-1`}>
            <Text style={tw`text-xs text-white`}>{unreadCount}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
});

const ChatList = () => {
  const [chatList, setChatList] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigation = useNavigation();
  const { user, logout } = React.useContext(AuthContext);
  const [ws, setWs] = useState(null);
  const [token, setToken] = useState(null);
  const [email, setEmail] = useState(null);
  const messageCache = useRef(new Map()); // Cache decrypted messages per contact

  const initializeParams = useCallback(async () => {
    try {
      let [token, userEmail] = await Promise.all([
        AsyncStorage.getItem('token'),
        AsyncStorage.getItem('user_email'),
      ]);

      if (!token || !userEmail) {
        const res = await axios.get(`${API_URL}/auth/profile/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        userEmail = res.data.email;
        await AsyncStorage.setItem('user_email', userEmail);
      }

      if (!token || !userEmail) {
        console.error('Missing required AsyncStorage items:', { token, userEmail });
        Alert.alert('Error', 'Authentication data missing. Please log in again.');
        navigation.navigate('index');
        return false;
      }

      setToken(token);
      setEmail(userEmail);
      console.log(`(NOBRIDGE) LOG Initialized params - Token: ${token}, Email: ${userEmail}`);
      return true;
    } catch (error) {
      console.error('Initialize params error:', error.message);
      Alert.alert('Error', 'Failed to initialize chat list. Please try again.');
      navigation.navigate('index');
      return false;
    }
  }, [navigation]);

  const fetchMessagesForContact = useCallback(async (senderId, receiverId, token, email) => {
    const wsUrl = `ws://${API_HOST}/ws/chat/${senderId}/${receiverId}/?token=${token}`;
    const socket = new WebSocket(wsUrl);
    const noise = new NoiseNN(senderId, receiverId, token, email);
    let messages = [];

    try {
      await noise.initialize();

      return new Promise((resolve) => {
        socket.onopen = () => {
          console.log(`(NOBRIDGE) LOG WebSocket opened for contact ${receiverId}`);
          socket.send(JSON.stringify({ request_history: true }));
        };

        socket.onmessage = async (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.messages) {
              const decryptedMessages = await Promise.all(data.messages.map(async (msg) => {
                if (msg.type === 'text' && msg.message && msg.nonce && msg.ephemeral_key) {
                  try {
                    const { key } = await noise.generateMessageKey(msg.ephemeral_key);
                    const iv = Buffer.from(msg.nonce, 'hex');
                    const encryptedBytes = aesjs.utils.hex.toBytes(msg.message);
                    const aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
                    const decryptedBytes = aesCbc.decrypt(encryptedBytes);
                    const decryptedText = aesjs.utils.utf8.fromBytes(aesjs.padding.pkcs7.strip(decryptedBytes));
                    return { ...msg, decryptedContent: decryptedText };
                  } catch (e) {
                    return { ...msg, decryptedContent: "[Decryption Failed]" };
                  }
                }
                return msg;
              }));

              messages = decryptedMessages
                .filter((msg) => msg.type !== 'handshake')
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
              socket.close();
              resolve(messages);
            }
          } catch (error) {
            console.error(`(NOBRIDGE) ERROR Parsing message for contact ${receiverId}:`, error.message);
            socket.close();
            resolve([]);
          }
        };

        socket.onerror = (error) => {
          console.error(`(NOBRIDGE) ERROR WebSocket error for contact ${receiverId}:`, error.message);
          socket.close();
          resolve([]);
        };

        socket.onclose = () => {
          console.log(`(NOBRIDGE) LOG WebSocket closed for contact ${receiverId}`);
          resolve(messages);
        };
      });
    } catch (error) {
      console.error(`(NOBRIDGE) ERROR NoiseNN init failed for contact ${receiverId}:`, error.message);
      socket.close();
      return [];
    }
  }, []);

  const fetchChatList = useCallback(async () => {
    if (!user || !token || !email) return;
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');

      // Fetch contacts to get profile information
      const contactsResponse = await axios.get(`${API_URL}/contacts/list_with_profiles/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const contacts = contactsResponse.data || [];
      console.log(`(NOBRIDGE) LOG Fetched ${contacts.length} contacts`);

      // Fetch messages and calculate unread counts for each contact
      const chatPromises = contacts.map(async (contact) => {
        const isOnline =
          contact.is_online ||
          (contact.friend.last_seen && new Date() - new Date(contact.friend.last_seen) < 5 * 60 * 1000);

        // Fetch all messages for this contact
        const messages = await fetchMessagesForContact(user.id, contact.friend_id, token, email);
        const lastMessage = messages.length > 0 ? messages[0] : null;

        if (lastMessage) {
          messageCache.current.set(contact.friend_id, lastMessage);
        }

        // Fetch last seen timestamp for this chat
        const lastSeenTimestamp = await AsyncStorage.getItem(`lastSeen_${contact.friend_id}`);
        const lastSeen = lastSeenTimestamp ? new Date(lastSeenTimestamp) : new Date(0);

        // Count unread messages (received messages after last seen)
        const unreadCount = messages.filter(
          (msg) => msg.sender !== user.id && new Date(msg.created_at) > lastSeen
        ).length;

        return {
          contact,
          lastMessage,
          timestamp: lastMessage ? new Date(lastMessage.created_at) : null,
          isOnline,
          unreadCount,
        };
      });

      const chatData = await Promise.all(chatPromises);
      // Sort by timestamp, most recent first
      const sortedChatData = chatData
        .filter((chat) => chat.lastMessage) // Only include chats with messages
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      setChatList(sortedChatData);
      console.log(`(NOBRIDGE) LOG Fetched and decrypted ${sortedChatData.length} chats`);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }, [user, token, email, fetchMessagesForContact]);

  const handleError = (error) => {
    console.error('Error:', error.message);
    if (error.response?.status === 401) {
      Alert.alert('Error', 'Session expired. Please log in again.', [
        {
          text: 'OK',
          onPress: async () => {
            await logout(navigation);
            navigation.navigate('Login');
          },
        },
      ]);
    } else {
      Alert.alert('Error', error.response?.data?.error || error.message || 'An error occurred');
    }
  };

  const setupWebSocket = useCallback(async () => {
    if (!token || !user) return;

    const wsInstance = new WebSocket(`ws://${API_HOST}/ws/global/?token=${token}`);
    wsInstance.onopen = () => console.log('ChatList WebSocket connected');
    wsInstance.onmessage = async (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log('ChatList WebSocket message:', data);

        if (data.type === 'last_seen_update') {
          setChatList((prev) =>
            prev.map((chat) => {
              if (chat.contact.friend.user.username === data.username) {
                return {
                  ...chat,
                  contact: {
                    ...chat.contact,
                    friend: {
                      ...chat.contact.friend,
                      last_seen: data.last_seen,
                    },
                  },
                };
              }
              return chat;
            })
          );
        } else if (data.type === 'chat_message') {
          // Handle new message in real-time
          const { sender, receiver, message, nonce, ephemeral_key, created_at } = data;
          const contactId = sender === user.id ? receiver : sender; // Identify the contact

          // Fetch and decrypt the new message
          const noise = new NoiseNN(user.id, contactId, token, email);
          await noise.initialize();
          let decryptedContent = '[Encrypted]';
          if (message && nonce && ephemeral_key) {
            try {
              const { key } = await noise.generateMessageKey(ephemeral_key);
              const iv = Buffer.from(nonce, 'hex');
              const encryptedBytes = aesjs.utils.hex.toBytes(message);
              const aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
              const decryptedBytes = aesCbc.decrypt(encryptedBytes);
              decryptedContent = aesjs.utils.utf8.fromBytes(aesjs.padding.pkcs7.strip(decryptedBytes));
            } catch (error) {
              console.error(`(NOBRIDGE) ERROR Decrypting new message for contact ${contactId}:`, error.message);
              decryptedContent = '[Decryption Failed]';
            }
          }

          // Fetch last seen timestamp for this chat
          const lastSeenTimestamp = await AsyncStorage.getItem(`lastSeen_${contactId}`);
          const lastSeen = lastSeenTimestamp ? new Date(lastSeenTimestamp) : new Date(0);

          // Update the chat list with the new message
          setChatList((prev) => {
            const updatedChatList = [...prev];
            const chatIndex = updatedChatList.findIndex(
              (chat) => chat.contact.friend_id === contactId
            );

            const newMessage = {
              ...data,
              decryptedContent,
              created_at: created_at || new Date().toISOString(),
            };

            const isUnread = sender !== user.id && new Date(newMessage.created_at) > lastSeen;

            if (chatIndex !== -1) {
              // Update existing chat
              updatedChatList[chatIndex] = {
                ...updatedChatList[chatIndex],
                lastMessage: newMessage,
                timestamp: new Date(newMessage.created_at),
                unreadCount: isUnread
                  ? updatedChatList[chatIndex].unreadCount + 1
                  : updatedChatList[chatIndex].unreadCount,
              };
            } else {
              // Fetch contact info for new chat
              const contactsResponse = axios.get(`${API_URL}/contacts/list_with_profiles/`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const contacts = contactsResponse.data || [];
              const contact = contacts.find((c) => c.friend_id === contactId);
              if (contact) {
                const isOnline =
                  contact.is_online ||
                  (contact.friend.last_seen && new Date() - new Date(contact.friend.last_seen) < 5 * 60 * 1000);
                updatedChatList.push({
                  contact,
                  lastMessage: newMessage,
                  timestamp: new Date(newMessage.created_at),
                  isOnline,
                  unreadCount: isUnread ? 1 : 0,
                });
              }
            }

            // Sort by timestamp, most recent first
            return updatedChatList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          });

          // Update cache
          messageCache.current.set(contactId, newMessage);
        }
      } catch (error) {
        console.error('WebSocket message parsing error:', error.message);
      }
    };
    wsInstance.onerror = (error) => {
      console.error('WebSocket error:', error.message);
      setTimeout(setupWebSocket, 2000);
    };
    wsInstance.onclose = () => console.log('ChatList WebSocket closed');
    setWs(wsInstance);

    return () => {
      if (wsInstance) wsInstance.close();
    };
  }, [token, user, email, fetchChatList]);

  useEffect(() => {
    initializeParams().then((success) => {
      if (success && user) {
        fetchChatList();
        setupWebSocket();
      }
    });

    // Periodic refresh every 30 seconds as a fallback
    const interval = setInterval(fetchChatList, 30000);

    return () => {
      clearInterval(interval);
      if (ws) {
        ws.close();
        console.log('ChatList WebSocket cleanup');
      }
    };
  }, [user, fetchChatList, setupWebSocket, initializeParams]);

  useFocusEffect(
    useCallback(() => {
      if (user && token && email) fetchChatList();
    }, [user, token, email, fetchChatList])
  );

  const navigateToChat = (contactId, contactUsername) => {
    if (!user) {
      Alert.alert('Error', 'You must be logged in to start a chat.');
      navigation.navigate('Login');
      return;
    }
    // Update last seen timestamp when entering the chat
    const now = new Date().toISOString();
    AsyncStorage.setItem(`lastSeen_${contactId}`, now).then(() => {
      // Reset unread count for this chat
      setChatList((prev) =>
        prev.map((chat) =>
          chat.contact.friend_id === contactId ? { ...chat, unreadCount: 0 } : chat
        )
      );
      navigation.navigate('ChatScreen', {
        senderId: user.id,
        contactId,
        contactUsername,
      });
    });
  };

  const navigateToContacts = () => {
    navigation.navigate('Contacts', { refresh: true });
  };

  if (!user) {
    return (
      <View style={tw`flex-1 justify-center items-center bg-gray-100`}>
        <Text style={tw`text-lg text-gray-600 mb-4`}>Please log in to view chats.</Text>
        <TouchableOpacity
          style={tw`bg-blue-500 px-6 py-2 rounded-full`}
          onPress={() => navigation.navigate('Login')}
        >
          <Text style={tw`text-white font-semibold`}>Go to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator size="large" color="#007AFF" style={tw`flex-1 justify-center`} />
      ) : (
        <FlatList
          data={chatList}
          renderItem={({ item }) => (
            <ChatListItem item={item} navigateToChat={navigateToChat} userId={user.id} />
          )}
          keyExtractor={(item) => item.contact.friend_id.toString()}
          ListEmptyComponent={
            <Text style={tw`text-center mt-5 text-gray-500`}>No chats available</Text>
          }
          contentContainerStyle={tw``} // Removed pb-16 since bottom nav bar is gone
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
        />
      )}
      <TouchableOpacity
        style={tw`absolute bottom-5 right-5 bg-blue-500 rounded-full p-4 shadow-lg`} // Adjusted position
        onPress={navigateToContacts}
      >
        <Ionicons name="chatbubble-outline" size={24} color="white" />
      </TouchableOpacity>
    </View>
  );
};

export default ChatList;