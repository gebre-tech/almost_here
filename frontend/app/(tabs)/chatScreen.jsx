import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import 'react-native-get-random-values';
import {
  View, FlatList, TextInput, Text, TouchableOpacity, Platform,
  TouchableWithoutFeedback, Keyboard, Dimensions, Alert, SafeAreaView,Modal,
  KeyboardAvoidingView, Animated, ActivityIndicator
} from 'react-native';
import { ToastAndroid } from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Linking from 'expo-linking';
import * as Sharing from 'expo-sharing';
import { Image } from 'expo-image';
import { Video } from 'expo-av';
import axios from 'axios';
import tw from 'twrnc';
import { Modalize } from 'react-native-modalize';
import * as SQLite from 'expo-sqlite';
import debounce from 'lodash/debounce';
import * as Crypto from 'expo-crypto';
import { Buffer } from 'buffer';
import aesjs from 'aes-js';
import { API_HOST, API_URL, PLACEHOLDER_IMAGE_ICON, DEFAULT_AVATAR_ICON } from '../utils/constants';
import { AuthContext } from '../../context/AuthContext';
import MediaMessage from './MediaMessage';
import { NoiseNN, checkAESSupport, fetchReceiverPublicKey } from './cryptoUtils';

// Singleton for database initialization
const getDatabase = (() => {
  let dbInstance = null;
  return () => {
    if (!dbInstance) {
      try {
        dbInstance = SQLite.openDatabaseSync('chat.db');
      } catch (error) {
        console.error('(NOBRIDGE) ERROR Failed to initialize database:', error);
        throw error;
      }
    }
    return dbInstance;
  };
})();

export default function ChatScreen() {
  const route = useRoute();
  const { senderId, contactId, contactUsername } = route.params || {};
  const navigation = useNavigation();
  const { accessToken, refreshToken: refreshAuthToken, user } = useContext(AuthContext);

  const [senderIdState, setSenderId] = useState(null);
  const [receiverId, setReceiverId] = useState(null);
  const [email, setEmail] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [pendingFile, setPendingFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const flatListRef = useRef(null);
  const modalizeRef = useRef(null);
  const [fullScreenMedia, setFullScreenMedia] = useState(null);
  const [downloading, setDownloading] = useState({});
  const [downloadProgress, setDownloadProgress] = useState({});
  const [downloadedFiles, setDownloadedFiles] = useState(new Map());
  const [senderCachedFiles, setSenderCachedFiles] = useState(new Map());
  const noiseRef = useRef(null);
  const messageCache = useRef(new Map());
  const prevReceiverIdRef = useRef(null);
  const [friendProfile, setFriendProfile] = useState(null);
  const inputRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const storageKey = `downloaded_files_${senderId}_${contactId}`;
  const senderCacheKey = `sender_cached_files_${senderId}_${contactId}`;
  const db = getDatabase();
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000;
  const isModalClosingRef = useRef(false);
  const isMountedRef = useRef(false);
  const messageIdCounter = useRef(0); // For unique fallback IDs
  const isFlatListReady = useRef(false); // Track FlatList readiness

  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const scrollOffset = useRef(0);
  const contentHeight = useRef(0);
  const scrollViewHeight = useRef(0);

  const [editingMessage, setEditingMessage] = useState(null); // Track message being edited
  const [editText, setEditText] = useState(''); // Text for editing
  const editInputRef = useRef(null); // Ref for edit input field

  const handleEditMessage = useCallback(async (message) => {
    if (message.type !== 'text') {
      Alert.alert('Error', 'Only text messages can be edited.');
      return;
    }
    setEditingMessage(message);
    setEditText(message.message); // Set initial text for editing
    setTimeout(() => editInputRef.current?.focus(), 100); // Focus input after modal opens
  }, []);
  const submitEditMessage = useCallback(async () => {
    if (!editingMessage || !editText.trim()) {
      Alert.alert('Error', 'Edited message cannot be empty.');
      return;
    }

    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN || !noiseRef.current?.handshakeFinished) {
      Alert.alert('Error', 'Chat connection is not established.');
      return;
    }

    try {
      // Retrieve the original message key from SQLite
      let messageKey = retrieveMessageKey(editingMessage.id);
      let ephemeralKey = editingMessage.ephemeral_key; // Reuse the original ephemeral key
      let nonce, ciphertext;

      if (messageKey) {
        // Reuse the original message key
        console.log(`(NOBRIDGE) Reusing message key for edited message ID: ${editingMessage.id}`);
        const iv = Buffer.from(await Crypto.getRandomBytesAsync(16)); // Generate new nonce
        const textBytes = aesjs.utils.utf8.toBytes(editText);
        const aesCbc = new aesjs.ModeOfOperation.cbc(messageKey, iv);
        const encryptedBytes = aesCbc.encrypt(aesjs.padding.pkcs7.pad(textBytes));
        ciphertext = aesjs.utils.hex.fromBytes(encryptedBytes);
        nonce = iv.toString('hex');
      } else {
        // Fallback: Generate new key (not recommended unless necessary)
        console.log(`(NOBRIDGE) Original message key not found, generating new key for edited message ID: ${editingMessage.id}`);
        const { ciphertext: newCiphertext, nonce: newNonce, ephemeralKey: newEphemeralKey, messageKey: newMessageKey } = await encryptMessage(editText);
        ciphertext = newCiphertext;
        nonce = newNonce;
        ephemeralKey = newEphemeralKey;
        messageKey = newMessageKey;
        storeMessageKey(editingMessage.id, messageKey); // Store new key
      }

      const messageData = {
        type: 'edit_message',
        message_id: editingMessage.id,
        message: ciphertext,
        nonce,
        ephemeral_key: ephemeralKey,
        message_key: messageKey.toString('hex'), // Send the message key
      };

      socketRef.current.send(JSON.stringify(messageData));
      setEditingMessage(null);
      setEditText('');
      Keyboard.dismiss();
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Failed to edit message:', error);
      Alert.alert('Edit Failed', `Failed to edit message: ${error.message}`);
    }
  }, [editingMessage, editText, encryptMessage, retrieveMessageKey, storeMessageKey]);

  const handleDeleteMessage = useCallback(async (messageId) => {
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
          Alert.alert('Error', 'Chat connection is not established.');
          return;
      }

      try {
          // Store the message for potential reversion
          const deletedMessage = messages.find(msg => msg.id === messageId);
          setMessages(prev => prev.filter((msg) => msg.id !== messageId));
          messageCache.current.delete(messageId);

          const messageData = {
              type: 'delete_message',
              message_id: messageId,
              timestamp: new Date().toISOString()
          };

          socketRef.current.send(JSON.stringify(messageData));

          // Listen for server response
          const timeout = setTimeout(() => {
              // Revert if no confirmation within 5 seconds
              if (deletedMessage) {
                  setMessages(prev => [...prev, deletedMessage].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)));
                  messageCache.current.set(messageId, deletedMessage);
                  Alert.alert('Delete Failed', 'Failed to delete message: Timeout');
              }
          }, 5000);

          // Clear timeout on confirmation
          socketRef.current.addEventListener('message', (event) => {
              const data = JSON.parse(event.data);
              if (data.type === 'delete_confirmation' && data.message_id === messageId) {
                  clearTimeout(timeout);
                  if (Platform.OS === 'android') {
                      ToastAndroid.show('Message deleted successfully', ToastAndroid.SHORT);
                  } else {
                      Alert.alert('Success', 'Message deleted successfully');
                  }
              } else if (data.error && data.error.includes('Message not found') && data.message_id === messageId) {
                  clearTimeout(timeout);
                  // Revert optimistic update
                  if (deletedMessage) {
                      setMessages(prev => [...prev, deletedMessage].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)));
                      messageCache.current.set(messageId, deletedMessage);
                      Alert.alert('Delete Failed', 'Message could not be deleted.');
                  }
              }
          }, { once: true });
      } catch (error) {
          console.error('(NOBRIDGE) ERROR Failed to delete message:', error);
          Alert.alert('Delete Failed', `Failed to delete message: ${error.message}`);
          // Revert optimistic update
          const deletedMessage = messages.find(msg => msg.id === messageId);
          if (deletedMessage) {
              setMessages(prev => [...prev, deletedMessage].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)));
              messageCache.current.set(messageId, deletedMessage);
          }
      }
    }, [messages]);
  
  const estimateHeight = useCallback((item) => {
    if (item.type === 'text') {
      const lineCount = Math.ceil(item.message.length / 35);
      return Math.max(60, lineCount * 22 + 40); // 22px per line, 40px padding
    }
    if (item.type === 'photo') return Dimensions.get('window').width * 0.8;
    if (item.type === 'video') return Dimensions.get('window').width * 0.8 * 9/16;
    if (item.type === 'file') return 90;
    return 100;
  }, []);

  const handleScroll = useCallback((event) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    scrollOffset.current = offsetY;

    const threshold = contentHeight.current - scrollViewHeight.current - 200; // Show when 200px from bottom
    setShowScrollToBottom(offsetY < threshold && contentHeight.current > scrollViewHeight.current);

    if (offsetY < 100 && !loadingMore && hasMoreMessages) {
      loadMoreMessages();
    }
  }, [loadingMore, hasMoreMessages]);

  const scrollToBottom = useCallback((animated = true, retries = 3) => {
    if (!isMountedRef.current) {
      console.log('(NOBRIDGE) Component not mounted, skipping scroll');
      return;
    }
    if (!flatListRef.current || !isFlatListReady.current || messages.length === 0) {
      if (retries > 0) {
        console.log('(NOBRIDGE) Cannot scroll to bottom, retrying... Retries left:', retries);
        setTimeout(() => scrollToBottom(animated, retries - 1), 300); // Increased delay
      } else {
        console.log('(NOBRIDGE) Cannot scroll to bottom: FlatList not ready or no messages');
      }
      return;
    }
    try {
      flatListRef.current.scrollToEnd({ animated });
      console.log('(NOBRIDGE) Scrolled to bottom, messages:', messages.length);
    } catch (error) {
      console.error('(NOBRIDGE) ERROR during scrollToEnd:', error);
      if (retries > 0) {
        setTimeout(() => scrollToBottom(animated, retries - 1), 300);
      }
    }
  }, [messages.length]);

  // Debounced scroll to prevent excessive calls
  const debouncedScrollToBottom = useCallback(
    debounce((animated = true) => scrollToBottom(animated), 300, { leading: false, trailing: true }),
    [scrollToBottom]
  );

  // Trigger scroll when messages change and FlatList is ready
  useEffect(() => {
    if (isFlatListReady.current && messages.length > 0) {
      debouncedScrollToBottom(true);
    }
  }, [messages, debouncedScrollToBottom]);

  const loadMoreMessages = useCallback(async () => {
    if (loadingMore || !hasMoreMessages) return;

    setLoadingMore(true);
    try {
      const oldestMessage = messages[0];
      if (!oldestMessage) {
        setHasMoreMessages(false);
        return;
      }

      const response = await axios.get(
        `${API_URL}/chat/messages/?sender=${senderIdState}&receiver=${receiverId}&before=${oldestMessage.timestamp}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (response.data.length === 0) {
        setHasMoreMessages(false);
      } else {
        const decryptedMessages = await Promise.all(
          response.data.map(async (msg) => {
            const { normalizedMsg } = await processMessage(msg, true);
            return normalizedMsg;
          })
        );

        const previousContentHeight = contentHeight.current;
        setMessages(prev => [...decryptedMessages.reverse(), ...prev]);

        // Maintain scroll position
        setTimeout(() => {
          if (flatListRef.current) {
            const newOffset = scrollOffset.current + (contentHeight.current - previousContentHeight);
            console.log('(NOBRIDGE) Maintaining scroll position, newOffset:', newOffset);
            flatListRef.current.scrollToOffset({
              offset: newOffset > 0 ? newOffset : scrollOffset.current,
              animated: false
            });
          }
        }, 100); // Delay for layout update
      }
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Loading more messages:', error);
    } finally {
      setLoadingMore(false);
    }
  }, [messages, accessToken, senderIdState, receiverId]);

  // Initialize SQLite table for message keys
  useEffect(() => {
    try {
      db.execSync('CREATE TABLE IF NOT EXISTS message_keys (message_id TEXT PRIMARY KEY, message_key TEXT);');
      db.execSync('CREATE INDEX IF NOT EXISTS idx_message_id ON message_keys (message_id);');
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Error creating table or index:', error);
    }
  }, []);

  // Store message key in SQLite
  const storeMessageKey = useCallback((messageId, messageKey) => {
    try {
      if (!messageId || !messageKey || !/^[0-9a-f]{64}$/i.test(messageKey)) {
        throw new Error('Invalid messageId or messageKey');
      }
      db.runSync('INSERT OR REPLACE INTO message_keys (message_id, message_key) VALUES (?, ?)', [messageId, messageKey]);
      console.log(`(NOBRIDGE) Stored message key for ID: ${messageId}`);
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Error storing message key:', error);
    }
  }, []);

  // Retrieve message key from SQLite
  const retrieveMessageKey = useCallback((messageId) => {
    try {
      const result = db.getFirstSync('SELECT message_key FROM message_keys WHERE message_id = ?', [messageId]);
      if (result && result.message_key && /^[0-9a-f]{64}$/i.test(result.message_key)) {
        console.log(`(NOBRIDGE) Retrieved message key for ID: ${messageId}`);
        return Buffer.from(result.message_key, 'hex');
      }
      return null;
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Error retrieving message key:', error);
      return null;
    }
  }, []);

  // Generate UUID for message_id
  const getNextMessageId = useCallback(async () => {
    try {
      const uuid = await Crypto.randomUUID();
      console.log(`(NOBRIDGE) Generated UUID for message_id: ${uuid}`);
      return uuid;
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Generating UUID:', error);
      throw error;
    }
  }, []);

  useEffect(() => {
    checkAESSupport();
    navigation.setOptions({ headerShown: false });
    isMountedRef.current = true; // Set mounted flag

    const loadCachedFiles = async () => {
      try {
        // Load receiver's downloaded files
        const storedFiles = await AsyncStorage.getItem(storageKey);
        if (storedFiles) {
          setDownloadedFiles(new Map(JSON.parse(storedFiles)));
        }
        // Load sender's cached files
        const senderCached = await AsyncStorage.getItem(senderCacheKey);
        if (senderCached) {
          setSenderCachedFiles(new Map(JSON.parse(senderCached)));
        }
      } catch (error) {
        console.error('(NOBRIDGE) ERROR Loading cached files:', error);
      }
    };
    loadCachedFiles();

    return () => {
      isMountedRef.current = false; // Clear mounted flag
    };
  }, [navigation, storageKey, senderCacheKey]);

  useEffect(() => {
    const saveCachedFiles = async () => {
      try {
        await AsyncStorage.setItem(storageKey, JSON.stringify([...downloadedFiles]));
        await AsyncStorage.setItem(senderCacheKey, JSON.stringify([...senderCachedFiles]));
      } catch (error) {
        console.error('(NOBRIDGE) ERROR Saving cached files:', error);
      }
    };
    saveCachedFiles();
  }, [downloadedFiles, senderCachedFiles, storageKey, senderCacheKey]);

  const fetchFriendProfile = useCallback(async () => {
    if (!contactUsername || !accessToken) return;

    try {
      const response = await axios.get(`${API_URL}/profiles/friend/${contactUsername}/`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const profileData = response.data;
      const now = new Date();
      const lastSeen = profileData.last_seen ? new Date(profileData.last_seen) : null;
      profileData.is_online = lastSeen && (now - lastSeen) < 5 * 60 * 1000;
      
      // Ensure we always have a first name
      if (!profileData.user?.first_name) {
        profileData.user = profileData.user || {};
        profileData.user.first_name = contactUsername;
      }
      
      setFriendProfile(profileData);
    } catch (error) {
      // If profile fetch fails, create a minimal profile with first name
      setFriendProfile({ 
        user: { 
          first_name: contactUsername.split(' ')[0] || contactUsername 
        }, 
        is_online: false 
      });
    }
  }, [contactUsername, accessToken]);

  useEffect(() => {
    fetchFriendProfile();
    const interval = setInterval(fetchFriendProfile, 30000);
    return () => clearInterval(interval);
  }, [fetchFriendProfile]);

  const initializeParams = useCallback(async () => {
    try {
      if (!accessToken || !user) {
        Alert.alert('Error', 'Not authenticated. Please log in again.');
        navigation.reset({
          index: 0,
          routes: [{ name: 'Login' }],
        });
        return false;
      }

      const userEmail = user.email;
      const cachedSenderId = user.id.toString();

      setEmail(userEmail);
      const sId = senderId ? parseInt(senderId, 10) : parseInt(cachedSenderId, 10);
      const rId = contactId ? parseInt(contactId, 10) : null;

      if (!sId || !rId) {
        Alert.alert('Error', 'Invalid chat parameters.');
        navigation.reset({
          index: 0,
          routes: [{ name: 'Login' }],
        });
        return false;
      }

      setSenderId(sId);
      setReceiverId(rId);
      return true;
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Initialize params error:', error);
      Alert.alert('Error', 'Failed to initialize chat.');
      navigation.reset({
        index: 0,
        routes: [{ name: 'Login' }],
      });
      return false;
    }
  }, [senderId, contactId, navigation, accessToken, user]);

  const resetState = useCallback(() => {
    setMessages([]);
    setInputText('');
    setPendingFile(null);
    setIsUploading(false);
    setFullScreenMedia(null);
    setDownloading({});
    setDownloadProgress({});
    messageCache.current.clear();
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    noiseRef.current = null;
    reconnectAttemptsRef.current = 0;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    isFlatListReady.current = false; // Reset FlatList readiness
  }, []);

  useEffect(() => {
    if (receiverId && receiverId !== prevReceiverIdRef.current) {
      resetState();
      prevReceiverIdRef.current = receiverId;
    }
  }, [receiverId, resetState]);

  useFocusEffect(
    useCallback(() => {
      initializeParams();
    }, [initializeParams])
  );

  const normalizeMessage = useCallback((msg) => {
    let fileUrl = msg.file_url && !msg.file_url.startsWith('http')
      ? `${API_URL}${msg.file_url}`
      : msg.file_url || msg.file;

    // For sender's messages, prioritize local_uri, then file_url
    if (msg.sender === senderIdState && msg.local_uri) {
      fileUrl = msg.local_uri;
    }

    let type = msg.type || 'text';
    if (msg.file_type?.startsWith('image/')) type = 'photo';
    else if (msg.file_type?.startsWith('video/')) type = 'video';
    else if (msg.file_type?.startsWith('audio/')) type = 'audio';
    else if (msg.file_type) type = 'file';

    const fileSize = msg.file_size || (msg.arrayBuffer ? msg.arrayBuffer.byteLength : null);

    // Ensure unique ID with counter for fallback
    const fallbackId = `${msg.timestamp || new Date().toISOString()}-${msg.sender || 'unknown'}-${messageIdCounter.current++}`;

    return {
      ...msg,
      content: msg.message || msg.content || '',
      message: msg.message || msg.content || '',
      timestamp: msg.timestamp || msg.created_at || new Date().toISOString(),
      type,
      file_url: fileUrl || msg.local_uri || PLACEHOLDER_IMAGE_ICON,
      file_name: msg.file_name || (fileUrl ? fileUrl.split('/').pop() : 'unnamed_file'),
      file_type: msg.file_type || (fileUrl && fileUrl.includes('.mp4') ? 'video/mp4' : 'application/octet-stream'),
      file_size: fileSize,
      nonce: msg.nonce,
      ephemeral_key: msg.ephemeral_key,
      id: msg.message_id || fallbackId,
      local_uri: msg.local_uri || fileUrl,
    };
  }, [senderIdState]);

  const validateFileMessage = useCallback((msg) => {
    if (['photo', 'video', 'audio', 'file'].includes(msg.type) && (!msg.file_url && !msg.local_uri)) {
      return { ...msg, message: 'Failed to load file (missing data)', file_url: PLACEHOLDER_IMAGE_ICON };
    }
    return msg;
  }, []);

  const decryptMessage = useCallback(async (ciphertext, key, nonce) => {
    try {
      if (!ciphertext || !/^[0-9a-f]+$/i.test(ciphertext)) {
        throw new Error('Invalid ciphertext format');
      }
      if (!nonce || !/^[0-9a-f]{32}$/i.test(nonce)) {
        throw new Error('Invalid nonce format');
      }
      if (!key || key.length !== 32) {
        throw new Error('Invalid key length');
      }

      console.log(`(NOBRIDGE) Decrypting message with ciphertext: ${ciphertext}, nonce: ${nonce}, key: ${key.toString('hex')}`);
      const iv = Buffer.from(nonce, 'hex');
      const encryptedBytes = aesjs.utils.hex.toBytes(ciphertext);
      const aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
      const decryptedBytes = aesCbc.decrypt(encryptedBytes);
      const plaintext = aesjs.utils.utf8.fromBytes(aesjs.padding.pkcs7.strip(decryptedBytes));
      console.log(`(NOBRIDGE) Decryption successful for ciphertext: ${ciphertext}`);
      return plaintext;
    } catch (e) {
      console.error(`(NOBRIDGE) Decryption failed for ciphertext: ${ciphertext}`, e);
      return `[Decryption Failed: ${e.message}]`;
    }
  }, []);

  const processMessage = useCallback(async (msg, isHistory = false) => {
    console.log(`(NOBRIDGE) Processing message ID: ${msg.message_id || 'undefined'}, isHistory: ${isHistory}`);
    const messageId = `${msg.timestamp || ''}${msg.content || msg.message || ''}${msg.sender || ''}${msg.receiver || ''}${msg.file_url || ''}${msg.message_id || ''}`;

    if (messageCache.current.has(messageId)) {
      console.log(`(NOBRIDGE) Message ID: ${msg.message_id || 'undefined'} already in cache, skipping`);
      return { normalizedMsg: messageCache.current.get(messageId), keyUsedFromSQLite: false };
    }

    let processedMsg = { ...msg };
    let keyUsedFromSQLite = false;

    // Skip decryption for sender's multimedia messages
    if (msg.sender === senderIdState && ['photo', 'video', 'audio', 'file'].includes(msg.type)) {
      console.log(`(NOBRIDGE) Skipping decryption for sender's multimedia message ID: ${msg.message_id || 'undefined'}`);
      processedMsg = validateFileMessage(processedMsg);
    } else if (msg.type === 'text' && (msg.content || msg.message) && msg.nonce && msg.ephemeral_key) {
      console.log(`(NOBRIDGE) Processing text message ID: ${msg.message_id || 'undefined'}`);

      let key;
      if (msg.message_id) {
        key = retrieveMessageKey(msg.message_id);
        if (key && !msg.is_edited) { // Only use SQLite key for non-edited messages
          console.log(`(NOBRIDGE) Using SQLite key for text message ID: ${msg.message_id}`);
          keyUsedFromSQLite = true;
        }
      }

      if (!key || msg.is_edited) { // For edited messages, prioritize provided message_key
        if (msg.message_key && /^[0-9a-f]{64}$/i.test(msg.message_key)) {
          console.log(`(NOBRIDGE) Using provided message key for text message ID: ${msg.message_id || 'undefined'}`);
          key = Buffer.from(msg.message_key, 'hex');
          if (msg.message_id) {
            storeMessageKey(msg.message_id, msg.message_key); // Update SQLite with new key
          }
          keyUsedFromSQLite = false;
        } else {
          console.log(`(NOBRIDGE) Generating key for text message ID: ${msg.message_id || 'undefined'}`);
          try {
            const keyData = await noiseRef.current.generateMessageKey(msg.ephemeral_key);
            key = keyData.key;
            if (msg.message_id) {
              storeMessageKey(msg.message_id, key.toString('hex'));
            }
            console.log(`(NOBRIDGE) Stored generated key for text message ID: ${msg.message_id || 'undefined'}`);
          } catch (error) {
            console.error(`(NOBRIDGE) ERROR Failed to generate key for text Message ID: ${msg.message_id || 'undefined'}`, error);
            processedMsg.content = `[Key Generation Failed: ${error.message}]`;
          }
        }
      }

      if (key) {
        const ciphertext = msg.content || msg.message;
        processedMsg.content = await decryptMessage(ciphertext, key, msg.nonce);
        processedMsg.message = processedMsg.content;
      } else {
        processedMsg.content = `[Missing Key: Unable to decrypt]`;
        processedMsg.message = processedMsg.content;
      }
    } else if (['photo', 'video', 'audio', 'file'].includes(msg.type)) {
      console.log(`(NOBRIDGE) Processing multimedia message ID: ${msg.message_id || 'undefined'}`);
      processedMsg = validateFileMessage(processedMsg);
    } else {
      console.log(`(NOBRIDGE) Skipping message ID: ${msg.message_id || 'undefined'}, Type: ${msg.type}, Content: ${!!(msg.content || msg.message)}, Nonce: ${!!msg.nonce}, Ephemeral Key: ${!!msg.ephemeral_key}`);
    }

    const normalizedMsg = normalizeMessage(processedMsg);
    if (!isHistory) {
      setMessages(prev => {
        const existingIndex = prev.findIndex(m => m.id === normalizedMsg.id);
        if (existingIndex !== -1) {
          console.log(`(NOBRIDGE) Message ID: ${normalizedMsg.id} already in state, updating`);
          return prev.map((m, i) =>
            i === existingIndex
              ? { ...m, ...normalizedMsg, file_url: normalizedMsg.file_url || m.file_url, local_uri: senderCachedFiles.get(m.id) || m.local_uri }
              : m
          );
        }
        console.log(`(NOBRIDGE) Adding new message ID: ${normalizedMsg.id}`);
        return [...prev, normalizedMsg];
      });
      messageCache.current.set(messageId, normalizedMsg);
    }

    return { normalizedMsg, keyUsedFromSQLite };
  }, [decryptMessage, normalizeMessage, validateFileMessage, retrieveMessageKey, storeMessageKey, senderIdState, senderCachedFiles]);
  const connectWebSocket = useCallback(async () => {
    if (!accessToken || !senderIdState || !receiverId) {
      console.log('(NOBRIDGE) Missing required parameters for WebSocket connection');
      return;
    }

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      console.log('(NOBRIDGE) WebSocket already open');
      return;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const protocol = Platform.OS === 'web' || API_HOST.includes('https') ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${API_HOST}/ws/chat/${senderIdState}/${receiverId}/?token=${accessToken}`;
    console.log('(NOBRIDGE) Connecting to WebSocket:', wsUrl);

    try {
      socketRef.current = new WebSocket(wsUrl);
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Failed to create WebSocket:', error);
      scheduleReconnect();
      return;
    }

    noiseRef.current = new NoiseNN(senderIdState, receiverId, accessToken, email);

    try {
      await noiseRef.current.initialize();
    } catch (error) {
      console.error('(NOBRIDGE) ERROR NoiseNN initialization error:', error);
      Alert.alert('Error', 'Failed to initialize encryption. Please try again.');
      socketRef.current.close();
      fetchChatHistoryViaHttp();
      return;
    }

    let pingInterval = null;
    const sendPing = () => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'ping' }));
        console.log('(NOBRIDGE) Sent ping');
      }
    };

    socketRef.current.onopen = () => {
        console.log('(NOBRIDGE) WebSocket opened for contact', receiverId);
        reconnectAttemptsRef.current = 0;
        socketRef.current.send(JSON.stringify({ request_history: true, page: 1, page_size: 50 }));
        pingInterval = setInterval(sendPing, 30000);
        // Fetch recent messages to sync any missed deletions
        fetchChatHistoryViaHttp();
    };

    socketRef.current.onmessage = async (event) => {
      try {
        let messageData;
        if (typeof event === 'string') {
          messageData = event;
        } else if (event && typeof event === 'object' && 'data' in event) {
          messageData = event.data;
        } else {
          console.error('(NOBRIDGE) ERROR Unexpected WebSocket event structure:', JSON.stringify(event));
          return;
        }

        const data = JSON.parse(messageData);
        console.log('(NOBRIDGE) Received WebSocket data:', JSON.stringify(data));

        if (data.type === 'pong') {
          console.log('(NOBRIDGE) Received pong');
          return;
        }

        if (data.error) {
          console.error('(NOBRIDGE) ERROR WebSocket error:', data.error);
          if (data.error.includes('message_id must be unique')) {
            console.log('(NOBRIDGE) Duplicate message_id detected, UUID should prevent this');
          }
          return;
        }
        if (data.type === 'delete_message') {
            console.log(`(NOBRIDGE) Processing delete message ID: ${data.message_id}`);
            setMessages((prev) => {
                const deletedMessage = prev.find(msg => msg.id === data.message_id);
                if (deletedMessage && deletedMessage.file_url) {
                    // Clear from caches
                    setSenderCachedFiles(prev => {
                        const newMap = new Map(prev);
                        newMap.delete(data.message_id);
                        return newMap;
                    });
                    setDownloadedFiles(prev => {
                        const newMap = new Map(prev);
                        newMap.delete(deletedMessage.file_url);
                        return newMap;
                    });
                    // Delete local file if it exists
                    if (deletedMessage.local_uri && !deletedMessage.local_uri.startsWith('http')) {
                        FileSystem.deleteAsync(deletedMessage.local_uri).catch(e => console.error('(NOBRIDGE) ERROR Deleting local file:', e));
                    }
                }
                const newMessages = prev.filter((msg) => msg.id !== data.message_id);
                if (newMessages.length < prev.length) {
                    if (Platform.OS === 'android') {
                        ToastAndroid.show('Message deleted by sender', ToastAndroid.SHORT);
                    } else {
                        Alert.alert('Message Deleted', 'A message was deleted by the sender.');
                    }
                }
                return newMessages;
            });
            messageCache.current.delete(data.message_id);
            return;
        }
        if (data.type === 'delete_confirmation') {
              console.log(`(NOBRIDGE) Delete confirmation for message ID: ${data.message_id}`);
              if (Platform.OS === 'android') {
                ToastAndroid.show('Message deleted successfully', ToastAndroid.SHORT);
              } else {
                Alert.alert('Success', 'Message deleted successfully');
              }
              return;
            }

        if (data.type === 'chat_message' && data.is_edited) {
          console.log(`(NOBRIDGE) Processing edited message ID: ${data.message_id}`);
          const { normalizedMsg } = await processMessage(data);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === normalizedMsg.id
                ? { ...normalizedMsg, is_edited: true }
                : msg
            )
          );
          messageCache.current.set(normalizedMsg.id, normalizedMsg);
          return;
        }

        const messageId = `${data.timestamp || ''}${data.message || ''}${data.sender || ''}${data.receiver || ''}${data.file_url || ''}${data.message_id || ''}`;

        if (data.messages) {
          let sqliteKeyCount = 0;
          const decryptedMessages = await Promise.all(
            data.messages.map(async (msg) => {
              const { normalizedMsg, keyUsedFromSQLite } = await processMessage(msg, true);
              if (keyUsedFromSQLite) sqliteKeyCount += 1;
              return normalizedMsg;
            })
          );
          console.log(`(NOBRIDGE) Processed ${data.messages.length} history messages, ${sqliteKeyCount} used SQLite-stored encryption keys`);
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            return [...prev, ...decryptedMessages.filter((msg) => msg.type !== 'handshake' && !existingIds.has(msg.id))];
          });
        } else if (
          (data.sender === senderIdState && data.receiver === receiverId) ||
          (data.sender === receiverId && data.receiver === senderIdState)
        ) {
          if (messageCache.current.has(messageId)) {
            console.log(`(NOBRIDGE) Live message ID: ${data.message_id || 'undefined'} already in cache, skipping`);
            return;
          }

          const { normalizedMsg, keyUsedFromSQLite } = await processMessage(data);
          if (normalizedMsg.type !== 'handshake') {
            setMessages((prev) => {
              if (prev.some((msg) => msg.id === normalizedMsg.id)) {
                console.log(`(NOBRIDGE) Message ID: ${normalizedMsg.id} already in state, updating`);
                return prev.map((msg) =>
                  msg.id === normalizedMsg.id
                    ? { ...msg, file_url: normalizedMsg.file_url || msg.file_url, local_uri: senderCachedFiles.get(msg.id) || msg.local_uri }
                    : msg
                );
              }
              console.log(`(NOBRIDGE) Processed 1 live message, ${keyUsedFromSQLite ? 1 : 0} used SQLite-stored encryption keys`);
              return [...prev, normalizedMsg];
            });
          }
        }
      } catch (error) {
        console.error('(NOBRIDGE) ERROR Parsing WebSocket message:', error.message, 'Event:', JSON.stringify(event));
      }
    };

    socketRef.current.onclose = (event) => {
      console.log('(NOBRIDGE) LOG WebSocket closed for contact', receiverId, ': Code', event.code, 'Reason', event.reason || 'No reason provided');
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      scheduleReconnect();
    };

    const scheduleReconnect = () => {
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        const delay = baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current);
        console.log(`(NOBRIDGE) Attempting to reconnect in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1})`);
        reconnectTimeoutRef.current = setTimeout(async () => {
          reconnectAttemptsRef.current += 1;
          if (reconnectAttemptsRef.current > 2) {
            try {
              const newToken = await refreshAuthToken();
              if (!newToken) {
                Alert.alert('Error', 'Session expired. Please log in again.');
                navigation.reset({
                  index: 0,
                  routes: [{ name: 'Login' }],
                });
                return;
              }
            } catch (error) {
              console.error('(NOBRIDGE) ERROR Failed to refresh token:', error);
              Alert.alert('Error', 'Failed to refresh session. Please log in again.');
              navigation.reset({
                index: 0,
                routes: [{ name: 'Login' }],
              });
              return;
            }
          }
          connectWebSocket();
        }, delay);
      } else {
        console.log('(NOBRIDGE) Max reconnection attempts reached for contact', receiverId);
        Alert.alert('Connection Error', 'Unable to connect to chat server. Falling back to HTTP for history.');
        fetchChatHistoryViaHttp();
      }
    };
  }, [accessToken, senderIdState, receiverId, email, navigation, senderCachedFiles]);

  const fetchChatHistoryViaHttp = useCallback(async () => {
      if (!accessToken) return;

      try {
          const response = await axios.get(`${API_URL}/chat/messages/?sender=${senderIdState}&receiver=${receiverId}`, {
              headers: { Authorization: `Bearer ${accessToken}` },
          });
          const messages = response.data;
          console.log('(NOBRIDGE) Fetched chat history via HTTP:', messages.length, 'messages');
          let sqliteKeyCount = 0;
          const decryptedMessages = await Promise.all(
              messages.map(async (msg) => {
                  const { normalizedMsg, keyUsedFromSQLite } = await processMessage(msg, true);
                  if (keyUsedFromSQLite) sqliteKeyCount += 1;
                  return normalizedMsg;
              })
          );
          console.log(`(NOBRIDGE) Processed ${messages.length} HTTP history messages, ${sqliteKeyCount} used SQLite-stored encryption keys`);
          setMessages(decryptedMessages.filter(msg => msg.type !== 'handshake')); // Replace state to ensure deleted messages are removed
      } catch (error) {
          console.error('(NOBRIDGE) ERROR Failed to fetch chat history via HTTP:', error);
          if (error.response?.status === 401) {
              const newToken = await refreshAuthToken();
              if (newToken) {
                  fetchChatHistoryViaHttp();
              } else {
                  Alert.alert('Error', 'Session expired. Please log in again.');
                  navigation.reset({
                      index: 0,
                      routes: [{ name: 'Login' }],
                  });
              }
          } else {
              Alert.alert('Error', 'Failed to load chat history.');
          }
      }
  }, [senderIdState, receiverId, accessToken, refreshAuthToken, navigation]);

  const encryptMessage = useCallback(async (plaintext) => {
    try {
      const { publicKey, key } = await noiseRef.current.generateMessageKey();
      const iv = Buffer.from(await Crypto.getRandomBytesAsync(16));
      const textBytes = aesjs.utils.utf8.toBytes(plaintext);
      const aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
      const encryptedBytes = aesCbc.encrypt(aesjs.padding.pkcs7.pad(textBytes));
      const ciphertext = aesjs.utils.hex.fromBytes(encryptedBytes);
      return {
        ciphertext,
        nonce: iv.toString('hex'),
        ephemeralKey: publicKey.toString('hex'),
        messageKey: key.toString('hex'),
      };
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Encrypting message:', error);
      throw error;
    }
  }, []);

  const encryptFile = useCallback(async (arrayBuffer) => {
    try {
      const { publicKey, key } = await noiseRef.current.generateMessageKey();
      const iv = Buffer.from(await Crypto.getRandomBytesAsync(16));
      const fileBytes = new Uint8Array(arrayBuffer);
      const paddedBytes = aesjs.padding.pkcs7.pad(fileBytes);
      const aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
      const encryptedBytes = aesCbc.encrypt(paddedBytes);
      return {
        encryptedData: Buffer.from(encryptedBytes),
        nonce: iv.toString('hex'),
        ephemeralKey: publicKey.toString('hex'),
        messageKey: key.toString('hex'),
      };
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Encrypting file:', error);
      throw error;
    }
  }, []);

  const sendMessage = useCallback(async () => {
    if (!senderIdState || !receiverId || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN || !noiseRef.current?.handshakeFinished || !inputText.trim()) {
      Alert.alert('Cannot Send Message', 'Chat connection is not established or message is empty.');
      return;
    }

    try {
      const { ciphertext, nonce, ephemeralKey, messageKey } = await encryptMessage(inputText);
      const messageId = await getNextMessageId();
      storeMessageKey(messageId, messageKey);

      const messageData = {
        sender: senderIdState,
        receiver: receiverId,
        message: ciphertext,
        nonce,
        ephemeral_key: ephemeralKey,
        message_key: messageKey,
        type: 'text',
        timestamp: new Date().toISOString(),
        message_id: messageId,
      };

      socketRef.current.send(JSON.stringify(messageData));

      const { normalizedMsg } = await processMessage(messageData);
      setMessages(prev => {
        if (prev.some(msg => msg.id === normalizedMsg.id)) {
          console.log(`(NOBRIDGE) Message ID: ${normalizedMsg.id} already in state, skipping send`);
          return prev;
        }
        return [...prev, normalizedMsg];
      });
      setInputText('');
      Keyboard.dismiss();
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Failed to send message:', error);
      Alert.alert('Send Failed', 'Failed to send message: ' + error.message);
    }
  }, [senderIdState, receiverId, inputText, encryptMessage, getNextMessageId, storeMessageKey]);

  const validateFile = useCallback((fileData) => {
    if (!fileData.uri || !fileData.fileName || !fileData.mimeType || !fileData.arrayBuffer) {
      throw new Error('Invalid file data: missing required fields');
    }
    const maxFileSize = 100 * 1024 * 1024; // 100MB limit
    if (fileData.fileSize > maxFileSize) {
      throw new Error('File size exceeds 100MB limit');
    }
    return true;
  }, []);

  const cacheSenderFile = useCallback(async (fileData, messageId) => {
    try {
      const { uri, fileName, arrayBuffer, mimeType } = fileData;
      const extension = mimeType.startsWith('image/') ? 'jpg' :
                        mimeType.startsWith('video/') ? 'mp4' :
                        mimeType.startsWith('audio/') ? 'mp3' : fileName.split('.').pop() || 'file';
      const cacheUri = `${FileSystem.documentDirectory}sender_${messageId}.${extension}`;
      
      if (Platform.OS === 'web') {
        const blob = new Blob([arrayBuffer], { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);
        setSenderCachedFiles(prev => {
          const newMap = new Map(prev);
          newMap.set(messageId, blobUrl);
          return newMap;
        });
        return blobUrl;
      } else {
        await FileSystem.writeAsStringAsync(
          cacheUri,
          Buffer.from(arrayBuffer).toString('base64'),
          { encoding: FileSystem.EncodingType.Base64 }
        );
        const fileInfo = await FileSystem.getInfoAsync(cacheUri);
        if (!fileInfo.exists) {
          throw new Error('Failed to cache sender file');
        }
        setSenderCachedFiles(prev => {
          const newMap = new Map(prev);
          newMap.set(messageId, cacheUri);
          return newMap;
        });
        return cacheUri;
      }
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Caching sender file:', error);
      return fileData.uri;
    }
  }, []);

  const reconnectAndRetry = useCallback(async (maxRetries = 3, retryDelay = 2000) => {
    let attempts = 0;
    while (attempts < maxRetries) {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN && noiseRef.current?.handshakeFinished) {
        console.log('(NOBRIDGE) WebSocket is open and handshake complete, proceeding');
        return true;
      }

      console.log('(NOBRIDGE) WebSocket not open or handshake incomplete, attempting to reconnect... Attempt:', attempts + 1);
      try {
        // Close existing socket if it exists
        if (socketRef.current) {
          socketRef.current.close();
          socketRef.current = null;
        }

        // Attempt to reconnect
        await connectWebSocket();

        // Wait for WebSocket to open and handshake to complete
        let waitAttempts = 10;
        while (waitAttempts > 0) {
          if (
            socketRef.current &&
            socketRef.current.readyState === WebSocket.OPEN &&
            noiseRef.current?.handshakeFinished
          ) {
            console.log('(NOBRIDGE) WebSocket reconnected and handshake complete');
            return true;
          }
          await new Promise(resolve => setTimeout(resolve, 500));
          waitAttempts--;
        }

        console.log('(NOBRIDGE) WebSocket did not open or handshake incomplete in time');
      } catch (error) {
        console.error('(NOBRIDGE) ERROR Failed to reconnect WebSocket:', error);
      }

      attempts++;
      if (attempts < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempts))); // Exponential backoff
      }
    }

    console.log('(NOBRIDGE) Max reconnect attempts reached for sendFile');
    return false;
  }, [connectWebSocket]);

  const sendFile = useCallback(async (fileData) => {
    if (!senderIdState || !receiverId || !noiseRef.current?.handshakeFinished) {
      Alert.alert('Cannot Send File', 'Chat connection is not established.');
      return;
    }
    if (isUploading) {
      Alert.alert('Upload in Progress', 'Please wait until the current upload is complete.');
      return;
    }

    try {
      setIsUploading(true);
      validateFile(fileData);
      const { uri, fileName, mimeType, arrayBuffer, fileSize } = fileData;
      const { encryptedData, nonce, ephemeralKey, messageKey } = await encryptFile(arrayBuffer);
      const messageId = await getNextMessageId();
      storeMessageKey(messageId, messageKey);
      console.log(`(NOBRIDGE) Stored multimedia message key for ID: ${messageId}`);

      const metadata = {
        sender: senderIdState,
        receiver: receiverId,
        file_name: fileName || `file_${Date.now()}`,
        file_type: mimeType || 'application/octet-stream',
        file_size: fileSize || arrayBuffer.byteLength,
        file_url: null,
        nonce,
        ephemeral_key: ephemeralKey,
        message_key: messageKey,
        type: mimeType.startsWith('image/') ? 'photo' : mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('audio/') ? 'audio' : 'file',
        timestamp: new Date().toISOString(),
        message_id: messageId,
        local_uri: uri,
      };

      const normalizedMsg = normalizeMessage(metadata);
      setMessages(prev => {
        if (prev.some(msg => msg.id === normalizedMsg.id)) {
          console.log(`(NOBRIDGE) File message ID: ${normalizedMsg.id} already in state, skipping`);
          return prev;
        }
        return [...prev, normalizedMsg];
      });

      const cachedUri = await cacheSenderFile({ uri, fileName, arrayBuffer, mimeType }, messageId);
      setMessages(prev => prev.map(msg =>
        msg.id === messageId ? { ...msg, local_uri: cachedUri } : msg
      ));

      // Ensure WebSocket is connected and Noise handshake is complete
      const isConnected = await reconnectAndRetry(3, 2000);
      if (!isConnected || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN || !noiseRef.current?.handshakeFinished) {
        throw new Error('WebSocket connection or handshake could not be established');
      }

      // Send metadata with timeout
      console.log('(NOBRIDGE) Sending file metadata for message ID:', messageId);
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout sending metadata'));
        }, 10000); // 10-second timeout
        socketRef.current.send(JSON.stringify(metadata));
        clearTimeout(timeout);
        resolve();
      });

      // Wait briefly to ensure metadata is processed
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify WebSocket is still open before sending file data
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket closed before sending file data');
      }

      // Send encrypted file data with timeout
      console.log('(NOBRIDGE) Sending encrypted file data for message ID:', messageId);
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout sending file data'));
        }, 30000); // 30-second timeout for file data
        socketRef.current.send(encryptedData);
        clearTimeout(timeout);
        resolve();
      });

      setPendingFile(null);
      Keyboard.dismiss();
      Alert.alert('Success', 'File sent successfully');
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Failed to send encrypted file:', error);
      Alert.alert('File Send Failed', `Failed to send file: ${error.message}`);
      // Optionally, remove the failed message from state
      setMessages(prev => prev.filter(msg => msg.id !== messageId));
    } finally {
      setIsUploading(false);
    }
  }, [senderIdState, receiverId, encryptFile, getNextMessageId, storeMessageKey, isUploading, validateFile, normalizeMessage, cacheSenderFile, reconnectAndRetry]);

  const pickFile = useCallback(async () => {
    if (isUploading) {
      Alert.alert('Upload in Progress', 'Please wait until the current upload is complete.');
      return;
    }

    try {
      Keyboard.dismiss();
      const isWeb = Platform.OS === 'web';
      let fileData;

      if (isWeb) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.txt';
        input.onchange = async (event) => {
          const file = event.target.files[0];
          if (!file) return;

          const reader = new FileReader();
          reader.onload = async (e) => {
            const arrayBuffer = e.target.result;
            const mimeType = file.type || 'application/octet-stream';
            fileData = {
              uri: URL.createObjectURL(file),
              fileName: file.name,
              mimeType,
              arrayBuffer,
              fileSize: file.size || arrayBuffer.byteLength,
            };
            try {
              validateFile(fileData);
              setPendingFile(fileData);
            } catch (error) {
              Alert.alert('Invalid File', error.message);
            }
          };
          reader.readAsArrayBuffer(file);
        };
        input.click();
      } else {
        const permission = await DocumentPicker.getDocumentAsync({
          type: ['image/*', 'video/*', 'audio/*', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'],
          copyToCacheDirectory: true,
        });
        if (permission.canceled) {
          Alert.alert('Permission Denied', 'Please allow access to files to proceed.');
          return;
        }
        const file = permission.assets[0];
        const { uri, name, mimeType, size } = file;
        const base64Data = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const binaryString = atob(base64Data);
        const arrayBuffer = new ArrayBuffer(binaryString.length);
        const uint8Array = new Uint8Array(arrayBuffer);
        for (let i = 0; i < binaryString.length; i++) uint8Array[i] = binaryString.charCodeAt(i);

        fileData = {
          uri,
          fileName: name,
          mimeType,
          arrayBuffer,
          fileSize: size || arrayBuffer.byteLength,
        };
        try {
          validateFile(fileData);
          setPendingFile(fileData);
        } catch (error) {
          Alert.alert('Invalid File', error.message);
        }
      }
    } catch (error) {
      console.error('(NOBRIDGE) ERROR pickFile Error:', error);
      Alert.alert('File Pick Failed', 'Failed to pick file: ' + error.message);
    }
  }, [isUploading, validateFile]);

  const formatTimestamp = useCallback((timestamp) => {
    try {
      const date = new Date(timestamp.replace(/[\u00A0]/g, ' '));
      return isNaN(date.getTime()) ? 'Invalid time' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Formatting timestamp:', error);
      return 'Invalid time';
    }
  }, []);

  const formatFileSize = useCallback((bytes) => {
    try {
      if (!bytes && bytes !== 0) return 'Unknown';
      const units = ['B', 'KB', 'MB', 'GB'];
      let size = parseFloat(bytes);
      let unitIndex = 0;
      while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
      }
      return `${size.toFixed(2)} ${units[unitIndex]}`;
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Formatting file size:', error);
      return 'Unknown';
    }
  }, []);

  const openFile = useCallback(async (uri, fileType = 'application/octet-stream', fileName = 'downloaded_file') => {
    try {
      if (!uri) {
        throw new Error('No file URI provided');
      }

      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }

      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists) {
        throw new Error('File does not exist at the specified URI');
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: fileType,
          dialogTitle: `Share ${fileName}`,
        });
      } else {
        if (await Linking.canOpenURL(uri)) {
          await Linking.openURL(uri);
        } else {
          Alert.alert('Error', 'Cannot open or share this file type.');
        }
      }
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Failed to open file:', error);
      Alert.alert('File Open Failed', `Failed to open file: ${error.message}`);
    }
  }, []);

  const downloadFile = useCallback(async (uri, fileName, nonce, ephemeralKey, fileType, messageId) => {
    setDownloading(prev => ({ ...prev, [messageId]: true }));
    setDownloadProgress(prev => ({ ...prev, [messageId]: 0 }));

    try {
      let downloadUri;
      let decryptedBytes;

      if (nonce && ephemeralKey && noiseRef.current?.handshakeFinished) {
        let key = retrieveMessageKey(messageId);
        if (key) {
          console.log(`(NOBRIDGE) Using SQLite key for multimedia download ID: ${messageId}`);
        } else {
          console.log(`(NOBRIDGE) Generating key for multimedia download ID: ${messageId}`);
          const keyData = await noiseRef.current.generateMessageKey(ephemeralKey);
          key = keyData.key;
          storeMessageKey(messageId, key.toString('hex'));
          console.log(`(NOBRIDGE) Stored generated key for multimedia download ID: ${messageId}`);
        }

        const tempFile = `${FileSystem.cacheDirectory}encrypted_${Date.now()}`;
        const downloadRes = await FileSystem.downloadAsync(uri, tempFile, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });

        if (downloadRes.status !== 200) {
          throw new Error(`Failed to fetch file: ${downloadRes.status}`);
        }

        setDownloadProgress(prev => ({ ...prev, [messageId]: 50 }));

        const encryptedData = await FileSystem.readAsStringAsync(tempFile, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const encryptedBytes = Buffer.from(encryptedData, 'base64');
        const iv = Buffer.from(nonce, 'hex');
        const aesCbc = new aesjs.ModeOfOperation.cbc(key, iv);
        decryptedBytes = aesCbc.decrypt(encryptedBytes);
        decryptedBytes = aesjs.padding.pkcs7.strip(decryptedBytes);

        await FileSystem.deleteAsync(tempFile).catch(() => {});
      } else {
        const tempFile = `${FileSystem.cacheDirectory}raw_${Date.now()}`;
        const downloadRes = await FileSystem.downloadAsync(uri, tempFile, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });

        if (downloadRes.status !== 200) {
          throw new Error(`Failed to fetch file: ${downloadRes.status}`);
        }

        setDownloadProgress(prev => ({ ...prev, [messageId]: 50 }));

        const rawData = await FileSystem.readAsStringAsync(tempFile, {
          encoding: FileSystem.EncodingType.Base64,
        });
        decryptedBytes = Buffer.from(rawData, 'base64');

        await FileSystem.deleteAsync(tempFile).catch(() => {});
      }

      if (Platform.OS === 'web') {
        const blob = new Blob([decryptedBytes], { type: fileType });
        downloadUri = URL.createObjectURL(blob);
      } else {
        const extension = fileType.startsWith('image/') ? 'jpg' :
                         fileType.startsWith('video/') ? 'mp4' :
                         fileType.startsWith('audio/') ? 'mp3' : fileName.split('.').pop() || 'file';
        downloadUri = `${FileSystem.documentDirectory}downloaded_${messageId}.${extension}`;
        await FileSystem.writeAsStringAsync(downloadUri, Buffer.from(decryptedBytes).toString('base64'), {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      setDownloadedFiles((prev) => {
        const newMap = new Map(prev);
        newMap.set(uri, downloadUri);
        return newMap;
      });

      setDownloadProgress(prev => ({ ...prev, [messageId]: 100 }));

      if (Platform.OS === 'web') {
        const blob = await (await fetch(downloadUri)).blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        Alert.alert('File Downloaded', `File saved to ${downloadUri}`);
      }
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Failed to download file:', error);
      Alert.alert('Download Failed', 'Failed to download file: ' + error.message);
    } finally {
      setDownloading(prev => {
        const newState = { ...prev };
        delete newState[messageId];
        return newState;
      });
      setDownloadProgress(prev => {
        const newState = { ...prev };
        delete newState[messageId];
        return newState;
      });
    }
  }, [accessToken, retrieveMessageKey, storeMessageKey]);

  const handleContainerPress = useCallback((event) => {
    const { locationY } = event.nativeEvent;
    const screenHeight = Dimensions.get('window').height;
    const headerHeight = 80;
    const inputAreaHeight = 100;

    if (locationY > headerHeight && locationY < screenHeight - inputAreaHeight) {
      return;
    }

    Keyboard.dismiss();
  }, []);

  const focusInput = useCallback(() => {
    if (!pendingFile && !isUploading) {
      inputRef.current?.focus();
    }
  }, [pendingFile, isUploading]);

  const getFileIcon = useCallback((fileType) => {
    if (fileType?.startsWith('image/')) return 'image';
    if (fileType?.startsWith('video/')) return 'video';
    if (fileType?.includes('pdf')) return 'picture-as-pdf';
    if (fileType?.includes('document') || fileType?.includes('msword') || fileType?.includes('text')) return 'description';
    return 'insert-drive-file';
  }, []);

  const getValidMediaUri = useCallback((uri) => {
    if (!uri || uri === PLACEHOLDER_IMAGE_ICON) {
      console.warn('(NOBRIDGE) Invalid media URI, falling back to placeholder');
      return PLACEHOLDER_IMAGE_ICON;
    }
    return uri;
  }, []);

  const openFilePreview = useCallback((file) => {
    if (file.type === 'photo' || file.type === 'video') {
      const validatedUri = getValidMediaUri(file.url);
      setFullScreenMedia({ uri: validatedUri, type: file.type });
      modalizeRef.current?.open();
    } else {
      Alert.alert('Preview Not Available', 'Preview is only available for images and videos.');
    }
  }, [getValidMediaUri]);

  const debouncedCloseFilePreview = useCallback(
    debounce(() => {
      if (isModalClosingRef.current) return;
      isModalClosingRef.current = true;
      console.log('(NOBRIDGE) Closing full-screen media preview');
      setFullScreenMedia(null);
      modalizeRef.current?.close();
      setTimeout(() => {
        isModalClosingRef.current = false;
      }, 500);
    }, 500, { leading: true, trailing: false }),
    []
  );

  const wrapText = useCallback((text, maxWidth) => {
    try {
      const words = text.split(' ');
      const lines = [];
      let currentLine = '';

      words.forEach((word, index) => {
        const testLine = currentLine + (currentLine ? ' ' : '') + word;
        const testWidth = new TextEncoder().encode(testLine).length;

        if (testWidth > maxWidth) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }

        if (index === words.length - 1) {
          lines.push(currentLine);
        }
      });

      return lines.join('\n');
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Wrapping text:', error);
      return text;
    }
  }, []);

  const renderMessage = useCallback(
      ({ item, index }) => {
        const isCurrentUser = item.sender === senderIdState;
        const messageId = item.id;
        const isDownloaded = isCurrentUser ? true : downloadedFiles.has(item.file_url);
        const localUri = isCurrentUser
          ? senderCachedFiles.get(messageId) || item.local_uri || item.file_url
          : downloadedFiles.get(item.file_url);
        const screenWidth = Dimensions.get('window').width * 0.75;
        const wrappedMessage = item.type === 'text' ? wrapText(item.message, screenWidth / 8) : item.message;
        const displayName = friendProfile?.user?.first_name || contactUsername || 'Unknown User';
        return (
          <TouchableOpacity
            onLongPress={() => {
              if (isCurrentUser) {
                Alert.alert(
                  'Message Options',
                  '',
                  [
                    {
                      text: 'Edit',
                      onPress: () => handleEditMessage(item),
                      style: item.type === 'text' ? 'default' : 'cancel',
                      isDisabled: item.type !== 'text', // Disable for non-text messages
                    },
                    {
                      text: 'Delete',
                      onPress: () => handleDeleteMessage(item.id),
                      style: 'destructive',
                    },
                    {
                      text: 'Cancel',
                      style: 'cancel',
                    },
                  ],
                  { cancelable: true }
                );
              }
            }}
            delayLongPress={300}
            disabled={!isCurrentUser} // Disable long press for non-sender messages
          >
            <Animated.View
              style={[tw`flex-row mb-2 ${isCurrentUser ? 'justify-end' : 'justify-start'} px-4`, { opacity: fadeAnim }]}
            >
              <View style={tw`max-w-[75%] flex-row ${isCurrentUser ? 'flex-row-reverse' : ''}`}>
                {!isCurrentUser && (
                  
                <TouchableOpacity
                  onPress={() => navigation.navigate('FriendProfile', { username: contactUsername })}
                  accessibilityLabel={`View ${friendProfile?.user?.first_name || contactUsername}'s profile`}
                >
                  {friendProfile?.profile_picture ? (
                    <Image
                      source={{ uri: friendProfile.profile_picture }}
                      style={tw`w-8 h-8 rounded-full mr-2 border border-gray-200`}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      accessibilityLabel={`${friendProfile?.user?.first_name || contactUsername}'s avatar`}
                      onError={() => {
                        // Fallback to default avatar on image load error
                        setFriendProfile((prev) => ({
                          ...prev,
                          profile_picture: null,
                        }));
                      }}
                    />
                  ) : (
                    <View
                      style={tw`w-8 h-8 rounded-full mr-2 bg-gray-300 flex items-center justify-center border border-gray-200`}
                    >
                      <Text style={tw`text-lg font-bold text-white`}>
                        {friendProfile?.user?.first_name?.charAt(0).toUpperCase() ||
                          contactUsername?.charAt(0).toUpperCase() || 'U'}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
                )}
                <View
                style={tw`p-3 rounded-2xl shadow-md ${
                  isCurrentUser ? 'bg-blue-500' : 'bg-white border border-gray-100'
                }`}
              >
                {!isCurrentUser && (
                  <Text style={tw`text-xs font-semibold text-gray-600 mb-1`}>
                    {displayName}
                  </Text>
                )}
                {item.type === 'text' && (
                  <Text
                    style={tw`${
                      isCurrentUser ? 'text-white text-base font-medium' : 'text-gray-800 text-base font-medium'
                    }`}
                    accessibilityLabel="Message text"
                  >
                    {wrappedMessage}
                    {item.is_edited && (
                      <Text style={tw`text-xs ${isCurrentUser ? 'text-white/70' : 'text-gray-500'}`}> (edited)</Text>
                    )}
                  </Text>
                )}
                  {(item.type === 'photo' || item.type === 'video' || item.type === 'audio' || item.type === 'file') && (
                    <View style={tw`mt-2`}>
                      <MediaMessage
                        item={item}
                        isCurrentUser={isCurrentUser}
                        isDownloaded={isDownloaded}
                        localUri={localUri || item.file_url || PLACEHOLDER_IMAGE_ICON}
                        onFullScreen={() => {
                          if (item.file_type?.startsWith('image/') || item.file_type?.startsWith('video/')) {
                            openFilePreview({
                              url: localUri || item.file_url || PLACEHOLDER_IMAGE_ICON,
                              type: item.type,
                            });
                          }
                        }}
                        onDownload={() => {
                          if (!isCurrentUser) {
                            downloadFile(
                              item.file_url,
                              item.file_name,
                              item.nonce,
                              item.ephemeral_key,
                              item.file_type,
                              messageId
                            );
                          }
                        }}
                        onOpen={() =>
                          openFile(localUri || item.file_url || PLACEHOLDER_IMAGE_ICON, item.file_type, item.file_name)
                        }
                        formatFileSize={formatFileSize}
                        downloading={downloading}
                        downloadProgress={downloadProgress}
                        messageId={messageId}
                        noise={noiseRef.current}
                        retrieveMessageKey={retrieveMessageKey}
                        onEdit={handleEditMessage}
                        onDelete={handleDeleteMessage}
                        isEditable={isCurrentUser} // Pass isEditable prop
                      />
                    </View>
                  )}
                  <Text
                    style={tw`text-xs ${isCurrentUser ? 'text-white/70' : 'text-gray-500'} mt-1 text-right`}
                    accessibilityLabel="Message timestamp"
                  >
                    {formatTimestamp(item.timestamp)}
                  </Text>
                </View>
              </View>
            </Animated.View>
          </TouchableOpacity>
        );
      },
      [
        senderIdState,
        friendProfile,
        contactUsername,
        downloadedFiles,
        senderCachedFiles,
        downloading,
        downloadProgress,
        navigation,
        fadeAnim,
        wrapText,
        formatTimestamp,
        openFilePreview,
        downloadFile,
        openFile,
        retrieveMessageKey,
        handleEditMessage,
        handleDeleteMessage,
      ]
    );

  const getItemLayout = useCallback((data, index) => {
    if (!data || index >= data.length) {
      return { length: 120, offset: 120 * index, index }; // Fallback
    }
    const item = data[index];
    const length = estimateHeight(item);
    const offset = data.slice(0, index).reduce((sum, msg) => sum + estimateHeight(msg), 0);
    return { length, offset, index };
  }, [estimateHeight]);

  const renderPendingFile = useCallback(() => {
    if (!pendingFile) return null;

    const screenWidth = Dimensions.get('window').width * 0.6;
    const wrapFileName = (name) => {
      try {
        const words = name.split(/([._-])/);
        const lines = [];
        let currentLine = '';

        words.forEach((word, index) => {
          const testLine = currentLine + (currentLine ? '' : '') + word;
          const testWidth = new TextEncoder().encode(testLine).length;

          if (testWidth > screenWidth / 8) {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }

          if (index === words.length - 1) {
            lines.push(currentLine);
          }
        });

        return lines.join('\n');
      } catch (error) {
        console.error('(NOBRIDGE) ERROR Wrapping file name:', error);
        return name;
      }
    };

    const wrappedFileName = wrapFileName(pendingFile.fileName);

    return (
      <View style={tw`flex-row items-center bg-white rounded-lg p-3 mx-4 mb-2 shadow-md border border-gray-100`}>
        {isUploading ? (
          <View style={tw`flex-1 items-center justify-center`}>
            <ActivityIndicator size="small" color="#6200EA" />
            <Text style={tw`text-gray-600 mt-2`}>Uploading...</Text>
          </View>
        ) : (
          <>
            {pendingFile.mimeType?.startsWith('image/') ? (
              <Image
                source={{ uri: pendingFile.uri }}
                style={tw`w-12 h-12 rounded-md mr-3`}
                contentFit="cover"
                cachePolicy="memory-disk"
                accessibilityLabel={`Preview of ${pendingFile.fileName}`}
              />
            ) : pendingFile.mimeType?.startsWith('video/') ? (
              <View style={tw`w-12 h-12 rounded-md mr-3 bg-gray-200 flex items-center justify-center`}>
                <Ionicons name="play" size={24} color="#6200EA" />
                <Text style={tw`absolute text-white text-xs`}>Video</Text>
              </View>
            ) : pendingFile.mimeType?.startsWith('audio/') ? (
              <View style={tw`w-12 h-12 rounded-md mr-3 bg-gray-200 flex items-center justify-center`}>
                <Ionicons name="mic" size={24} color="#6200EA" />
              </View>
            ) : (
              <MaterialIcons name={getFileIcon(pendingFile.mimeType)} size={24} color="#6200EA" style={tw`mr-3`} />
            )}
            <View style={tw`flex-1`}>
              <Text style={tw`text-gray-800 font-semibold`} accessibilityLabel={`File name: ${pendingFile.fileName}`}>
                {wrappedFileName}
              </Text>
              <Text style={tw`text-gray-500 text-xs mt-1`}>Size: {formatFileSize(pendingFile.fileSize)}</Text>
            </View>
            <TouchableOpacity
              onPress={() => setPendingFile(null)}
              style={tw`p-2`}
              accessibilityLabel="Cancel file upload"
            >
              <Ionicons name="close" size={20} color="#6200EA" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => sendFile(pendingFile)}
              style={tw`bg-blue-500 rounded-full p-2`}
              disabled={isUploading}
              accessibilityLabel="Send file"
            >
              <Ionicons name="send" size={20} color="white" />
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }, [pendingFile, formatFileSize, getFileIcon, sendFile, isUploading]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, []);

  useEffect(() => {
    if (accessToken && senderIdState && receiverId && email) {
      connectWebSocket();
      fetchChatHistoryViaHttp();
    }

    return () => {
      // Only cleanup if not uploading
      if (isUploading) {
        console.log('(NOBRIDGE) Upload in progress, delaying WebSocket cleanup');
        return;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (socketRef.current && socketRef.current.readyState !== WebSocket.CLOSED) {
        console.log('(NOBRIDGE) Closing WebSocket on cleanup');
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [accessToken, senderIdState, receiverId, email, connectWebSocket, fetchChatHistoryViaHttp, isUploading]);
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      debouncedCloseFilePreview.cancel();
      debouncedScrollToBottom.cancel();
    };
  }, [debouncedCloseFilePreview, debouncedScrollToBottom]);

return (
    <SafeAreaView style={tw`flex-1 bg-gray-50`}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={tw`flex-1`}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
      >
        <TouchableWithoutFeedback onPress={handleContainerPress}>
          <View style={tw`flex-1 bg-gray-50`}>
            <View style={tw`bg-blue-600 p-4 flex-row items-center justify-between shadow-lg`}>
              <View style={tw`flex-row items-center flex-1`}>
                <TouchableOpacity
                  style={tw`mr-3`}
                  onPress={() => navigation.navigate('FriendProfile', { username: contactUsername })}
                  accessibilityLabel={`View ${friendProfile?.user?.first_name || contactUsername}'s profile`}
                >
                  {friendProfile?.profile_picture ? (
                    <Image
                      source={{ uri: friendProfile.profile_picture }}
                      style={tw`w-10 h-10 rounded-full border-2 border-white`}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      accessibilityLabel={`${friendProfile?.user?.first_name || contactUsername}'s avatar`}
                      onError={() => {
                        // Fallback to default avatar on image load error
                        setFriendProfile((prev) => ({
                          ...prev,
                          profile_picture: null,
                        }));
                      }}
                    />
                  ) : (
                    <View
                      style={tw`w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center border-2 border-white`}
                    >
                      <Text style={tw`text-lg font-bold text-white`}>
                        {friendProfile?.user?.first_name?.charAt(0).toUpperCase() ||
                          contactUsername?.charAt(0).toUpperCase() || 'U'}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={tw`flex-1`}
                  onPress={() => navigation.navigate('FriendProfile', { username: contactUsername })}
                >
                  <Text style={tw`text-lg font-bold text-white`}>
                    {friendProfile?.user?.first_name || contactUsername || 'Unknown User'}
                  </Text>
                  <Text style={tw`text-xs text-white/80`}>
                    {friendProfile?.is_online ? 'Online' : 'Offline'}
                  </Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                accessibilityLabel="Go back"
              >
                <Ionicons name="arrow-back" size={24} color="white" />
              </TouchableOpacity>
            </View>

            <FlatList
              ref={flatListRef}
              data={messages}
              renderItem={renderMessage}
              keyExtractor={(item) => item.id}
              contentContainerStyle={tw`pb-20 pt-2 flex-grow`}
              initialNumToRender={10}
              maxToRenderPerBatch={5}
              windowSize={11}
              removeClippedSubviews={Platform.OS !== 'web'}
              inverted={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              onContentSizeChange={(w, h) => {
                contentHeight.current = h;
              }}
              onLayout={(e) => {
                scrollViewHeight.current = e.nativeEvent.layout.height;
                isFlatListReady.current = true; // Mark FlatList as ready
                if (messages.length > 0) {
                  debouncedScrollToBottom(true); // Scroll after layout
                }
              }}
              ListFooterComponent={
                loadingMore ? (
                  <View style={tw`py-4 justify-center items-center`}>
                    <ActivityIndicator size="small" color="#6200EA" />
                  </View>
                ) : null
              }
              ListHeaderComponent={<View style={tw`pt-2`} />}
              getItemLayout={getItemLayout}
            />
            {showScrollToBottom && (
              <TouchableOpacity
                style={tw`absolute bottom-24 right-4 bg-blue-500 rounded-full p-3 shadow-lg`}
                onPress={() => debouncedScrollToBottom(true)}
                accessibilityLabel="Scroll to bottom"
              >
                <Ionicons name="arrow-down" size={24} color="white" />
              </TouchableOpacity>
            )}

            {renderPendingFile()}

            <View style={tw`flex-row items-center p-3 bg-white border-t border-gray-200 shadow-lg`}>
              <TouchableOpacity
                onPress={pickFile}
                style={tw`mr-3 p-2 ${isUploading ? 'opacity-50' : ''}`}
                disabled={isUploading}
                accessibilityLabel="Attach file"
              >
                <Ionicons name="attach" size={24} color={isUploading ? '#ccc' : '#6200EA'} />
              </TouchableOpacity>
              <TextInput
                ref={inputRef}
                style={tw`flex-1 bg-gray-100 rounded-full px-4 py-2.5 text-gray-800 shadow-sm`}
                placeholder="Type a message..."
                value={inputText}
                onChangeText={setInputText}
                onSubmitEditing={sendMessage}
                onPressIn={focusInput}
                autoFocus={false}
                returnKeyType="send"
                multiline={true}
                maxLength={1000}
                accessibilityLabel="Message input"
              />
              <TouchableOpacity
                onPress={sendMessage}
                style={tw`ml-3 p-2`}
                disabled={!inputText.trim()}
                accessibilityLabel="Send message"
              >
                <Ionicons name="send" size={24} color={inputText.trim() ? '#6200EA' : '#ccc'} />
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
        {/* Edit Message Modal */}
        <Modal
          visible={!!editingMessage}
          transparent={true}
          animationType="slide"
          onRequestClose={() => {
            setEditingMessage(null);
            setEditText('');
          }}
        >
          <View style={tw`flex-1 justify-end bg-black/50`}>
            <View style={tw`bg-white p-4 rounded-t-2xl`}>
              <Text style={tw`text-lg font-bold mb-4`}>Edit Message</Text>
              <TextInput
                ref={editInputRef}
                style={tw`bg-gray-100 rounded-lg p-3 mb-4 text-gray-800`}
                value={editText}
                onChangeText={setEditText}
                multiline={true}
                maxLength={1000}
                accessibilityLabel="Edit message input"
              />
              <View style={tw`flex-row justify-end`}>
                <TouchableOpacity
                  onPress={() => {
                    setEditingMessage(null);
                    setEditText('');
                  }}
                  style={tw`p-3 mr-4`}
                  accessibilityLabel="Cancel edit"
                >
                  <Text style={tw`text-blue-500 font-semibold`}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={submitEditMessage}
                  style={tw`bg-blue-500 rounded-lg p-3`}
                  accessibilityLabel="Save edited message"
                >
                  <Text style={tw`text-white font-semibold`}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        <Modalize
          ref={modalizeRef}
          adjustToContentHeight={false}
          modalHeight={Dimensions.get('window').height}
          handlePosition="outside"
          onClose={debouncedCloseFilePreview}
          modalStyle={tw`bg-black flex-1`}
          panGestureEnabled={true}
          withHandle={true}
          scrollViewProps={{
            showsVerticalScrollIndicator: false,
            scrollEventThrottle: 16,
          }}
          onOverlayPress={debouncedCloseFilePreview}
          useNativeDriver={true}
          disableScrollIfPossible={true}
        >
          <View style={tw`flex-1 justify-center items-center p-4 bg-black`}>
            <TouchableOpacity
              style={tw`absolute top-4 right-4 z-50 bg-black/70 rounded-full p-3`}
              onPress={debouncedCloseFilePreview}
              accessibilityLabel="Close media preview"
            >
              <Ionicons name="close" size={30} color="white" />
            </TouchableOpacity>
            {fullScreenMedia?.type === 'photo' && (
              <Image
                source={{ uri: fullScreenMedia.uri }}
                style={tw`w-full h-full max-w-[95%] max-h-[85%]`}
                contentFit="contain"
                cachePolicy="memory-disk"
                placeholder={PLACEHOLDER_IMAGE_ICON}
                accessibilityLabel="Full screen image"
                onError={(error) => {
                  console.error('(NOBRIDGE) ERROR Loading full-screen image:', error);
                  Alert.alert('Error', 'Failed to load image.');
                }}
              />
            )}
            {fullScreenMedia?.type === 'video' && (
              <Video
                source={{ uri: fullScreenMedia.uri }}
                style={tw`w-full h-full max-w-[95%] max-h-[85%]`}
                useNativeControls
                resizeMode="contain"
                isLooping={false}
                shouldPlay={true}
                accessibilityLabel="Full screen video"
                onError={(error) => {
                  console.error('(NOBRIDGE) ERROR Loading full-screen video:', error);
                  Alert.alert('Error', 'Failed to load video.');
                }}
              />
            )}
          </View>
        </Modalize>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}