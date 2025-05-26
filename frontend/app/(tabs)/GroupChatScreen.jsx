import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  Modal,
  Animated,
  Alert,
  ActionSheetIOS,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Linking from 'expo-linking';
import tw from 'twrnc';
import Toast from 'react-native-toast-message';
import axios from 'axios';
import { API_HOST, API_URL } from '../utils/constants';
import { AuthContext } from '../../context/AuthContext';
import { Video, Audio } from 'expo-av'; // Added Audio import
import { Swipeable } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';

const GroupChatScreen = () => {
  const { groupId, groupName } = useRoute().params;
  const { user } = React.useContext(AuthContext);
  const navigation = useNavigation();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [profiles, setProfiles] = useState({});
  const [isTyping, setIsTyping] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [fullScreenImage, setFullScreenImage] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadedFiles, setDownloadedFiles] = useState(new Set());
  const [groupProfilePicture, setGroupProfilePicture] = useState(null);
  const [groupDetails, setGroupDetails] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [pinnedMessages, setPinnedMessages] = useState([]); // Changed to array for multiple pinned messages
  const ws = useRef(null);
  const flatListRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pageSize = 30;
  const storageKey = `group_messages_${groupId}`;
  const downloadedFilesKey = `downloaded_files_${groupId}`;
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [currentAudioUri, setCurrentAudioUri] = useState(null);
  const soundRef = useRef(null);

  // Update pinned messages
  useEffect(() => {
    const pinned = messages.filter((msg) => msg.is_pinned);
    setPinnedMessages(pinned);
  }, [messages]);

  // Scroll to a specific pinned message
  const scrollToPinnedMessage = useCallback((messageId) => {
    const index = messages.findIndex((msg) => msg.id === messageId);
    if (index !== -1) {
      flatListRef.current?.scrollToIndex({ index, animated: true });
    }
  }, [messages]);

  useEffect(() => {
    const loadDownloadedFiles = async () => {
      try {
        const storedFiles = await AsyncStorage.getItem(downloadedFilesKey);
        if (storedFiles) {
          setDownloadedFiles(new Set(JSON.parse(storedFiles)));
        }
      } catch (error) {
        console.error('Error loading downloaded files:', error);
      }
    };
    loadDownloadedFiles();
  }, []);

  useEffect(() => {
    const saveDownloadedFiles = async () => {
      try {
        await AsyncStorage.setItem(downloadedFilesKey, JSON.stringify([...downloadedFiles]));
      } catch (error) {
        console.error('Error saving downloaded files:', error);
      }
    };
    saveDownloadedFiles();
  }, [downloadedFiles]);

  const fetchGroupDetails = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      const response = await axios.get(`${API_URL}/groups/details/${groupId}/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setGroupDetails(response.data);
    } catch (error) {
      console.error('Error fetching group details:', error);
    }
  }, [groupId]);

  const fetchGroupProfilePicture = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      const response = await axios.get(`${API_URL}/groups/list/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const groupData = response.data || [];
      const group = groupData.find((g) => g.id === groupId);
      if (group && group.profile_picture) {
        let picUrl = group.profile_picture;
        if (!picUrl.startsWith('http')) {
          picUrl = `${API_URL}${picUrl}`;
        }
        setGroupProfilePicture(picUrl);
      } else {
        setGroupProfilePicture(null);
      }
    } catch (error) {
      console.error('Error fetching group profile picture:', error);
      setGroupProfilePicture(null);
    }
  }, [groupId]);

  const initializeWebSocket = useCallback(async () => {
    const token = await AsyncStorage.getItem('token');
    if (!token || ws.current?.readyState === WebSocket.OPEN) return;

    ws.current = new WebSocket(`ws://${API_HOST}/ws/groups/${groupId}/?token=${token}`);

    ws.current.onopen = () => console.log('WebSocket connected');
    ws.current.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'group_message') {
        setMessages((prev) => {
          const updated = prev.some((msg) => msg.id === data.message.id)
            ? prev.map((msg) => (msg.id === data.message.id ? data.message : msg))
            : [...prev, data.message].sort(
                (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
              );
          saveMessages(updated);
          return updated;
        });
        flatListRef.current?.scrollToEnd({ animated: true });
      } else if (data.type === 'group_message_deleted') {
        setMessages((prev) => {
          const updated = prev.filter((msg) => msg.id !== data.message_id);
          saveMessages(updated);
          return updated;
        });
        Toast.show({
          type: 'info',
          text1: 'Message Deleted',
          text2: data.message || `Message ${data.message_id} deleted by ${data.deleted_by || 'Unknown'}`,
        });
      } else if (data.type === 'typing') {
        if (data.user_id !== user?.id) {
          setIsTyping(data.first_name);
          clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setIsTyping(null), 2000);
        }
      } else if (data.type === 'group_deleted') {
        Toast.show({
          type: 'info',
          text1: 'Group Deleted',
          text2: data.message,
        });
        navigation.navigate('Groups');
      } else if (data.type === 'error') {
        Toast.show({
          type: 'error',
          text1: 'Error',
          text2: data.message || 'WebSocket error',
        });
      }
    };
    ws.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      Toast.show({
        type: 'error',
        text1: 'WebSocket Error',
        text2: 'Failed to connect to server. Using REST API as fallback.',
      });
    };
    ws.current.onclose = () => {
      console.log('WebSocket closed');
      setTimeout(initializeWebSocket, 3000);
    };
  }, [groupId, user, navigation]);

  const loadMessages = useCallback(async () => {
    try {
      const cached = await AsyncStorage.getItem(storageKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        setMessages(parsed);
        fetchProfiles(parsed);
        return parsed.length > 0;
      }
      return false;
    } catch (error) {
      console.error('Error loading messages:', error);
      return false;
    }
  }, [storageKey]);

  const saveMessages = useCallback(async (msgs) => {
    try {
      const limited = msgs.slice(-100);
      await AsyncStorage.setItem(storageKey, JSON.stringify(limited));
    } catch (error) {
      console.error('Error saving messages:', error);
    }
  }, [storageKey]);

  const fetchMessages = useCallback(
    async (pageNum = 1, reset = false) => {
      try {
        setIsLoadingMore(pageNum !== 1);
        setIsLoading(pageNum === 1);

        const token = await AsyncStorage.getItem('token');
        const response = await axios.get(
          `${API_URL}/groups/messages/${groupId}/?page=${pageNum}&page_size=${pageSize}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        const { results, next } = response.data;
        setMessages((prev) => {
          const newMessages = reset
            ? results
            : [...results, ...prev].sort(
                (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
              );
          const uniqueMessages = Array.from(
            new Map(newMessages.map((msg) => [msg.id, msg])).values()
          );
          saveMessages(uniqueMessages);
          fetchProfiles(uniqueMessages);
          return uniqueMessages;
        });

        setHasMore(!!next);
        setPage(next ? pageNum + 1 : 1);
      } catch (error) {
        Toast.show({
          type: 'error',
          text1: 'Error',
          text2: error.message || 'Failed to fetch messages',
        });
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [groupId, pageSize, saveMessages]
  );

  const fetchProfiles = useCallback(
    async (msgs) => {
      try {
        const token = await AsyncStorage.getItem('token');
        const senderIds = [...new Set(msgs.map((msg) => msg.sender?.id).filter(Boolean))];
        const newProfiles = { ...profiles };

        for (const id of senderIds) {
          if (newProfiles[id]) continue;
          const sender = msgs.find((msg) => msg.sender?.id === id)?.sender;
          if (!sender?.username) continue;

          const response = await axios.get(
            `${API_URL}/profiles/friend/${sender.username}/`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          newProfiles[id] = {
            ...response.data,
            is_online: response.data.last_seen
              ? new Date() - new Date(response.data.last_seen) < 5 * 60 * 1000
              : false,
          };
        }
        setProfiles(newProfiles);
      } catch (error) {
        console.error('Error fetching profiles:', error);
      }
    },
    [profiles]
  );

  const sendMessage = useCallback(() => {
    if (!inputText.trim() || ws.current?.readyState !== WebSocket.OPEN) return;

    const messageData = {
      type: 'group_message',
      message: inputText,
      group_id: groupId,
    };
    if (replyingTo) {
      messageData.parent_message_id = replyingTo.id;
    }
    ws.current.send(JSON.stringify(messageData));
    setInputText('');
    setReplyingTo(null);
  }, [inputText, groupId, replyingTo]);

  const editMessage = useCallback(
    (messageId, newMessage) => {
      if (!newMessage.trim() || ws.current?.readyState !== WebSocket.OPEN) return;

      const messageData = {
        type: 'edit_message',
        message_id: messageId,
        new_message: newMessage,
        group_id: groupId,
      };
      ws.current.send(JSON.stringify(messageData));
      setEditingMessage(null);
      setInputText('');
    },
    [groupId]
  );

  const deleteMessage = useCallback(
    (messageId) => {
      if (ws.current?.readyState !== WebSocket.OPEN) return;

      const messageData = {
        type: 'delete_message',
        message_id: messageId,
        group_id: groupId,
      };
      ws.current.send(JSON.stringify(messageData));
    },
    [groupId]
  );

  const pinMessage = useCallback(
    (messageId) => {
      if (ws.current?.readyState !== WebSocket.OPEN) return;

      const messageData = {
        type: 'pin_message',
        message_id: messageId,
        group_id: groupId,
      };
      ws.current.send(JSON.stringify(messageData));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [groupId]
  );

  const unpinMessage = useCallback(
    (messageId) => {
      if (ws.current?.readyState !== WebSocket.OPEN) return;

      const messageData = {
        type: 'unpin_message',
        message_id: messageId,
        group_id: groupId,
      };
      ws.current.send(JSON.stringify(messageData));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [groupId]
  );

  const sendTyping = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      const messageData = { type: 'typing', group_id: groupId };
      ws.current.send(JSON.stringify(messageData));
    }
  }, [groupId]);

  const pickAndSendFile = useCallback(async () => {
    try {
      let file, arrayBuffer, fileName, mimeType;

      if (Platform.OS === 'web') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '*/*';
        input.onchange = async (event) => {
          const selectedFile = event.target.files[0];
          if (!selectedFile) return;

          fileName = selectedFile.name;
          mimeType = selectedFile.type || 'application/octet-stream';

          const reader = new FileReader();
          reader.onload = () => {
            arrayBuffer = reader.result;
            setPendingFile({ fileName, mimeType, arrayBuffer });
            sendFile({ fileName, mimeType, arrayBuffer });
          };
          reader.onerror = () => {
            Toast.show({
              type: 'error',
              text1: 'Error',
              text2: 'Failed to read file',
            });
          };
          reader.readAsArrayBuffer(selectedFile);
        };
        input.click();
      } else {
        const result = await DocumentPicker.getDocumentAsync({
          type: '*/*',
          copyToCacheDirectory: true,
        });
        if (!result.canceled) {
          file = result.assets[0];
          const { uri, name, mimeType: docMimeType } = file;
          fileName = name;
          mimeType = docMimeType || 'application/octet-stream';

          const base64Data = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const binaryString = atob(base64Data);
          arrayBuffer = new ArrayBuffer(binaryString.length);
          const uint8Array = new Uint8Array(arrayBuffer);
          for (let i = 0; i < binaryString.length; i++) {
            uint8Array[i] = binaryString.charCodeAt(i);
          }

          setPendingFile({ uri, fileName, mimeType, arrayBuffer });
          sendFile({ fileName, mimeType, arrayBuffer, uri });
        }
      }
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: `Failed to pick file: ${error.message}`,
      });
    }
  }, []);

  const sendFile = useCallback(
    async ({ fileName, mimeType, arrayBuffer, uri }) => {
      const maxRetries = 3;
      let attempt = 0;

      const sendViaWebSocket = async () => {
        if (ws.current?.readyState === WebSocket.OPEN) {
          try {
            const metadata = {
              type: 'group_message',
              group_id: groupId,
              file_name: fileName,
              file_type: mimeType,
            };
            if (replyingTo) {
              metadata.parent_message_id = replyingTo.id;
            }
            ws.current.send(JSON.stringify(metadata));
            await new Promise((resolve) => setTimeout(resolve, 100));
            ws.current.send(arrayBuffer);
            setPendingFile(null);
            setReplyingTo(null);
            return true;
          } catch (error) {
            console.error('WebSocket send error:', error);
            return false;
          }
        }
        return false;
      };

      const sendViaRest = async () => {
        try {
          const token = await AsyncStorage.getItem('token');
          const formData = new FormData();
          formData.append('group_id', groupId);
          formData.append('message', '');
          formData.append('attachment', {
            uri: Platform.OS === 'web' ? URL.createObjectURL(new Blob([arrayBuffer], { type: mimeType })) : uri,
            name: fileName,
            type: mimeType,
          });
          formData.append('file_name', fileName);
          formData.append('file_type', mimeType);
          if (replyingTo) {
            formData.append('parent_message_id', replyingTo.id);
          }

          await axios.post(`${API_URL}/groups/message/send/`, formData, {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'multipart/form-data',
            },
          });
          fetchMessages(1, true);
          setPendingFile(null);
          setReplyingTo(null);
          return true;
        } catch (error) {
          console.error('REST API send error:', error);
          return false;
        }
      };

      while (attempt < maxRetries) {
        attempt++;
        if (await sendViaWebSocket()) return;
        if (await sendViaRest()) return;
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }

      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to upload file after multiple attempts',
      });
      setPendingFile(null);
      setReplyingTo(null);
    },
    [groupId, fetchMessages, replyingTo]
  );

  const getFileIcon = (fileType) => {
    if (fileType?.startsWith('image/')) return 'image';
    if (fileType?.startsWith('video/')) return 'video';
    if (fileType?.includes('pdf')) return 'picture-as-pdf';
    if (fileType?.includes('document') || fileType?.includes('msword') || fileType?.includes('text'))
      return 'description';
    return 'insert-drive-file';
  };

  const formatFileSize = (bytes) => {
    if (!bytes && bytes !== 0) return 'Unknown';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = parseFloat(bytes);
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  };

  const openFilePreview = (file) => {
    setFilePreview(file);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const closeFilePreview = () => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setFilePreview(null));
  };

  const downloadFile = async (url) => {
    setDownloading(true);
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
        Toast.show({
          type: 'success',
          text1: 'Success',
          text2: 'File download initiated',
        });
        setDownloadedFiles((prev) => new Set(prev).add(url));
      } else {
        throw new Error('Cannot open URL');
      }
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to download file',
      });
    } finally {
      setDownloading(false);
    }
  };

  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      fetchMessages(page);
    }
  }, [isLoadingMore, hasMore, page, fetchMessages]);

  const showMessageOptions = (item) => {
    const isCurrentUser = item.sender?.id === user?.id;
    const isAdminOrCreator =
      groupDetails?.admins?.some((admin) => admin.id === user?.id) ||
      groupDetails?.creator?.id === user?.id;
    const isSystemMessage = item.sender?.id === null;

    if (isSystemMessage && !isAdminOrCreator) return;

    const options = [];
    if (isCurrentUser || isAdminOrCreator) {
      if (item.message && !isSystemMessage) {
        options.push({
          title: 'Edit',
          action: () => {
            setEditingMessage(item);
            setInputText(item.message);
          },
        });
      }
      options.push({
        title: 'Delete',
        action: () => {
          Alert.alert(
            'Delete Message',
            'Are you sure you want to delete this message?',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => deleteMessage(item.id) },
            ]
          );
        },
      });
    }
    if (!isSystemMessage) {
      options.push({
        title: 'Reply',
        action: () => setReplyingTo(item),
      });
    }
    if (isAdminOrCreator) {
      options.push({
        title: item.is_pinned ? 'Unpin' : 'Pin',
        action: () => {
          if (item.is_pinned) {
            unpinMessage(item.id);
          } else {
            pinMessage(item.id);
          }
        },
      });
    }
    options.push({
      title: 'Cancel',
      action: () => {},
    });

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: options.map((opt) => opt.title),
          cancelButtonIndex: options.length - 1,
          destructiveButtonIndex: options.findIndex((opt) => opt.title === 'Delete'),
        },
        (buttonIndex) => {
          options[buttonIndex]?.action();
        }
      );
    } else {
      Alert.alert(
        'Message Options',
        '',
        options.map((opt) => ({
          text: opt.title,
          onPress: opt.action,
          style: opt.title === 'Delete' ? 'destructive' : opt.title === 'Cancel' ? 'cancel' : 'default',
        }))
      );
    }
  };

  const renderRightActions = (item) => {
    if (item.sender?.id === null) return null;
    return (
      <TouchableOpacity
        style={tw`bg-green-500 justify-center items-center w-20 rounded-r-lg`}
        onPress={() => {
          setReplyingTo(item);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }}
      >
        <Ionicons name="reply" size={24} color="white" />
        <Text style={tw`text-white text-xs mt-1`}>Reply</Text>
      </TouchableOpacity>
    );
  };

  const renderLeftActions = (item) => {
    const isAdminOrCreator =
      groupDetails?.admins?.some((admin) => admin.id === user?.id) ||
      groupDetails?.creator?.id === user?.id;
    if (!isAdminOrCreator || item.sender?.id === null) return null;
    return (
      <TouchableOpacity
        style={tw`bg-yellow-500 justify-center items-center w-20 rounded-l-lg`}
        onPress={() => {
          if (item.is_pinned) {
            unpinMessage(item.id);
          } else {
            pinMessage(item.id);
          }
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }}
      >
        <MaterialIcons
          name={item.is_pinned ? "push-pin" : "push-pin"}
          size={24}
          color="white"
        />
        <Text style={tw`text-white text-xs mt-1`}>
          {item.is_pinned ? 'Unpin' : 'Pin'}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderMessage = ({ item }) => {
    const isCurrentUser = item.sender?.id === user?.id;
    const isSystemMessage = item.sender?.id === null;
    const profile = profiles[item.sender?.id] || {};
    const senderName = isSystemMessage
      ? 'System Helper'
      : profile.user?.first_name || item.sender?.first_name || 'Unknown';
    const isDownloaded = downloadedFiles.has(item.file_url);

    const handlePlayAudio = async (uri) => {
      try {
        if (soundRef.current) {
          await soundRef.current.unloadAsync();
        }
        
        soundRef.current = new Audio.Sound();
        await soundRef.current.loadAsync({ uri });
        await soundRef.current.playAsync();
        setIsPlayingAudio(true);
        setCurrentAudioUri(uri);
        
        soundRef.current.setOnPlaybackStatusUpdate((status) => {
          if (status.didJustFinish) {
            setIsPlayingAudio(false);
            setCurrentAudioUri(null);
          }
        });
      } catch (error) {
        console.error('Error playing audio:', error);
      }
    };

    const handleStopAudio = async () => {
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        setIsPlayingAudio(false);
        setCurrentAudioUri(null);
      }
    };

    const messageContent = (
      <TouchableOpacity
        onLongPress={() => showMessageOptions(item)}
        style={tw`flex-row mb-2 ${isCurrentUser ? 'justify-end' : 'justify-start'} px-4`}
      >
        <View style={tw`max-w-3/4 flex-row ${isCurrentUser ? 'flex-row-reverse' : ''}`}>
          {!isCurrentUser && (
            <TouchableOpacity
              onPress={() =>
                item.sender?.username &&
                navigation.navigate('FriendProfile', { username: item.sender.username })
              }
            >
              <Image
                source={{
                  uri:
                    profile.profile_picture ||
                    'https://ui-avatars.com/api/?name=' + encodeURIComponent(senderName) + '&background=random',
                }}
                style={tw`w-8 h-8 rounded-full mr-2`}
              />
            </TouchableOpacity>
          )}
          <View
            style={tw`p-3 rounded-2xl ${
              isCurrentUser ? 'bg-blue-500' : 'bg-white border border-gray-200'
            } ${item.is_pinned ? 'border-2 border-yellow-400' : ''}`}
          >
            {!isCurrentUser && (
              <Text style={tw`text-xs font-semibold text-gray-600 mb-1`}>{senderName}</Text>
            )}
            {item.parent_message && (
              <View style={tw`bg-gray-100 rounded-lg p-2 mb-2`}>
                <Text style={tw`text-xs text-gray-600`}>
                  {item.parent_message.sender?.first_name || 'System'}
                </Text>
                <Text style={tw`text-xs text-gray-500`} numberOfLines={1}>
                  {item.parent_message.message || 'Attachment'}
                </Text>
              </View>
            )}
            {item.message && (
              <Text style={tw`${isCurrentUser ? 'text-white' : 'text-gray-800'}`}>
                {item.message}
              </Text>
            )}
            {item.file_url && (
              <View>
                {item.file_type?.startsWith('image/') ? (
                  <TouchableOpacity
                    onPress={() => setFullScreenImage(item.file_url)}
                    style={tw`mt-2`}
                  >
                    <Image
                      source={{ uri: item.file_url }}
                      style={tw`w-48 h-48 rounded-lg`}
                      resizeMode="cover"
                    />
                  </TouchableOpacity>
                ) : item.file_type?.startsWith('video/') ? (
                  <TouchableOpacity
                    onPress={() => {
                      openFilePreview({
                        url: item.file_url,
                        name: item.file_name || 'Unnamed File',
                        type: item.file_type,
                        size: item.file_size || 0,
                      });
                    }}
                    style={tw`mt-2`}
                  >
                    <Video
                      source={{ uri: item.file_url }}
                      style={tw`w-48 h-48 rounded-lg`}
                      useNativeControls
                      resizeMode="cover"
                      isMuted={true}
                    />
                  </TouchableOpacity>
                ) : item.file_type?.startsWith('audio/') ? (
                  <TouchableOpacity
                    onPress={() => {
                      if (currentAudioUri === item.file_url && isPlayingAudio) {
                        handleStopAudio();
                      } else {
                        handlePlayAudio(item.file_url);
                      }
                    }}
                    style={tw`flex-row items-center justify-center mt-2 bg-gray-100 rounded-full p-3`}
                  >
                    <Ionicons
                      name={currentAudioUri === item.file_url && isPlayingAudio ? "pause" : "play"}
                      size={24}
                      color="#6200EA"
                    />
                    <Text style={tw`ml-2 text-gray-800`}>
                      {currentAudioUri === item.file_url && isPlayingAudio ? "Playing..." : "Play Audio"}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    onPress={() => {
                      openFilePreview({
                        url: item.file_url,
                        name: item.file_name || 'Unnamed File',
                        type: item.file_type,
                        size: item.file_size || 0,
                      });
                    }}
                    style={tw`flex-row items-center mt-2`}
                  >
                    <MaterialIcons
                      name={getFileIcon(item.file_type)}
                      size={24}
                      color={isCurrentUser ? 'white' : '#6200EA'}
                      style={tw`mr-2`}
                    />
                    <Text style={tw`${isCurrentUser ? 'text-white' : 'text-gray-800'} underline`}>
                      {item.file_name || 'Unnamed File'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            <Text
              style={tw`text-xs ${isCurrentUser ? 'text-white/70' : 'text-gray-500'} mt-1 text-right`}
            >
              {new Date(item.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );

    return (
      <Swipeable
        renderRightActions={() => renderRightActions(item)}
        renderLeftActions={() => renderLeftActions(item)}
        overshootRight={false}
        overshootLeft={false}
        friction={1.5}
        tension={40}
      >
        {messageContent}
      </Swipeable>
    );
  };
 
  // Render a single pinned message in the header
  const renderPinnedMessage = ({ item }) => (
    <TouchableOpacity
      style={tw`flex-row items-center py-1 px-2`} // Compact padding
      onPress={() => scrollToPinnedMessage(item.id)}
    >
      <MaterialIcons name="push-pin" size={16} color="#6200EA" style={tw`mr-2`} />
      <View style={tw`flex-1`}>
        <Text style={tw`text-xs font-semibold text-gray-800`} numberOfLines={1}>
          Pinned Message
        </Text>
        <Text style={tw`text-xs text-gray-600`} numberOfLines={1}>
          {item.message || item.file_name || 'Attachment'}
        </Text>
      </View>
      <TouchableOpacity
        onPress={() => unpinMessage(item.id)}
        style={tw`p-1`}
      >
        <Ionicons name="close" size={16} color="#6200EA" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
  useEffect(() => {
    return () => {
      // Clean up audio when component unmounts
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, []);
  useEffect(() => {
    const setup = async () => {
      await loadMessages();
      await fetchMessages(1, true);
      await fetchGroupProfilePicture();
      await fetchGroupDetails();
      initializeWebSocket();
    };
    setup();

    return () => {
      ws.current?.close();
      clearTimeout(typingTimeoutRef.current);
    };
  }, [
    loadMessages,
    fetchMessages,
    fetchGroupProfilePicture,
    fetchGroupDetails,
    initializeWebSocket,
  ]);

  return (
    <SafeAreaView style={tw`flex-1 bg-gray-50`}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={tw`flex-1`}
      >
        {/* Header Container */}
        <View style={tw`bg-[#1a73e8] relative z-10`}>
          {/* Main Header */}
          <View style={tw`p-2 flex-row items-center justify-between h-16`}>
            <View style={tw`flex-row items-center flex-1`}>
              {groupProfilePicture ? (
                <TouchableOpacity
                  style={tw`mr-3`}
                  onPress={() => navigation.navigate('GroupInfo', { groupId })}
                >
                  <Image
                    source={{ uri: groupProfilePicture }}
                    style={tw`w-10 h-10 rounded-full`}
                    onError={() =>
                      console.log(`Failed to load profile picture for group ${groupName}`)
                    }
                  />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={tw`mr-3`}
                  onPress={() => navigation.navigate('GroupInfo', { groupId })}
                >
                  <View
                    style={tw`w-10 h-10 rounded-full bg-white flex items-center justify-center`}
                  >
                    <Text style={tw`text-lg font-bold text-[#1a73e8]`}>{groupName[0]}</Text>
                  </View>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={tw`flex-1`}
                onPress={() => navigation.navigate('GroupInfo', { groupId })}
              >
                <Text style={tw`text-lg font-bold text-white`}>{groupName}</Text>
                <Text style={tw`text-xs text-white/70`}>Tap for group info</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Pinned Messages Header */}
        {pinnedMessages.length > 0 && (
          <View style={tw`bg-gray-100 border-b border-gray-300 shadow-sm z-0 max-h-24`}> {/* Max height to limit space */}
            <FlatList
              data={pinnedMessages}
              renderItem={renderPinnedMessage}
              keyExtractor={(item) => `pinned-${item.id}`}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={tw`px-2 py-1`} // Minimal padding
            />
          </View>
        )}

        {/* Chat List */}
        {isLoading ? (
          <ActivityIndicator size="large" color="#6200EA" style={tw`flex-1`} />
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={tw`pb-20 ${pinnedMessages.length > 0 ? 'pt-2' : ''}`} // Dynamic top padding
            onEndReached={loadMore}
            onEndReachedThreshold={0.3}
            initialNumToRender={20}
            ListFooterComponent={
              isLoadingMore && (
                <ActivityIndicator size="small" color="#6200EA" style={tw`my-4`} />
              )
            }
            ListEmptyComponent={
              <View style={tw`flex-1 justify-center items-center`}>
                <Text style={tw`text-gray-500`}>Start the conversation!</Text> {/* Wrapped in Text */}
              </View>
            }
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            getItemLayout={(data, index) => ({
              length: 80,
              offset: 80 * index,
              index,
            })}
            onScrollToIndexFailed={(info) => {
              flatListRef.current?.scrollToOffset({
                offset: info.averageItemLength * info.index,
                animated: true,
              });
            }}
          />
        )}

        {/* Typing Indicator */}
        {isTyping && (
          <View style={tw`px-4 mb-2`}>
            <Text style={tw`text-gray-500 text-sm`}>{isTyping} is typing...</Text>
          </View>
        )}

        {/* Reply Preview */}
        {replyingTo && (
          <View style={tw`flex-row items-center bg-gray-100 rounded-lg p-2 mx-4 mb-2`}>
            <View style={tw`flex-1`}>
              <Text style={tw`text-xs text-gray-600`}>
                Replying to {replyingTo.sender?.first_name || 'System'}
              </Text>
              <Text style={tw`text-xs text-gray-500`} numberOfLines={1}>
                {replyingTo.message || 'Attachment'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setReplyingTo(null)}>
              <Ionicons name="close" size={20} color="#6200EA" />
            </TouchableOpacity>
          </View>
        )}

        {/* File Preview */}
        {pendingFile && (
          <View style={tw`flex-row items-center bg-gray-100 rounded-lg p-2 mx-4 mb-2`}>
            {pendingFile.mimeType?.startsWith('image/') ? (
              <Image
                source={{ uri: pendingFile.uri }}
                style={tw`w-12 h-12 rounded-md mr-2`}
              />
            ) : (
              <Text style={tw`text-gray-800 mr-2`}>{pendingFile.fileName}</Text>
            )}
            <TouchableOpacity onPress={() => setPendingFile(null)}>
              <Ionicons name="close" size={20} color="#6200EA" />
            </TouchableOpacity>
          </View>
        )}

        {/* Input Area */}
        <View style={tw`flex-row items-center p-3 bg-white border-t border-gray-200`}>
          <TouchableOpacity onPress={pickAndSendFile} style={tw`mr-3`}>
            <Ionicons name="attach" size={24} color="#6200EA" />
          </TouchableOpacity>
          <TextInput
            style={tw`flex-1 bg-gray-100 rounded-full px-4 py-2.5 text-gray-800`}
            placeholder={editingMessage ? 'Edit message...' : 'Type a message...'}
            value={inputText}
            onChangeText={(text) => {
              setInputText(text);
              sendTyping();
            }}
            onSubmitEditing={() => {
              if (editingMessage) {
                editMessage(editingMessage.id, inputText);
              } else {
                sendMessage();
              }
            }}
          />
          <TouchableOpacity
            onPress={() => {
              if (editingMessage) {
                editMessage(editingMessage.id, inputText);
              } else {
                sendMessage();
              }
            }}
            style={tw`ml-3`}
          >
            <Ionicons
              name={editingMessage ? 'checkmark' : 'send'}
              size={24}
              color="#6200EA"
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Full-Screen Image Modal */}
      <Modal
        visible={!!fullScreenImage}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setFullScreenImage(null)}
      >
        <View style={tw`flex-1 bg-black justify-center items-center`}>
          <TouchableOpacity
            style={tw`absolute top-10 right-5 bg-black/50 rounded-full p-2`}
            onPress={() => setFullScreenImage(null)}
          >
            <Ionicons name="close" size={30} color="white" />
          </TouchableOpacity>
          <Image
            source={{ uri: fullScreenImage }}
            style={tw`w-full h-full`}
            resizeMode="contain"
          />
        </View>
      </Modal>

      {/* File Preview Modal */}
      <Modal
        visible={!!filePreview}
        transparent={true}
        animationType="none"
        onRequestClose={closeFilePreview}
      >
        <View style={tw`flex-1 bg-black/50 justify-center items-center`}>
          <Animated.View
            style={[tw`bg-white rounded-2xl p-6 w-11/12 max-w-md`, { opacity: fadeAnim }]}
          >
            <View style={tw`flex-row items-center justify-between mb-4`}>
              <View style={tw`flex-row items-center`}>
                <MaterialIcons
                  name={getFileIcon(filePreview?.type)}
                  size={40}
                  color="#6200EA"
                  style={tw`mr-3`}
                />
                <View>
                  <Text
                    style={tw`text-lg font-semibold text-gray-800`}
                    numberOfLines={1}
                  >
                    {filePreview?.name}
                  </Text>
                  <Text style={tw`text-sm text-gray-500`}>
                    Size: {formatFileSize(filePreview?.size)}
                  </Text>
                </View>
              </View>
              <View style={tw`flex-row`}>
                <TouchableOpacity onPress={closeFilePreview} style={tw`mr-2`}>
                  <Text style={tw`text-red-500 font-semibold`}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={closeFilePreview}>
                  <Ionicons name="close" size={24} color="#6200EA" />
                </TouchableOpacity>
              </View>
            </View>

            {filePreview?.type?.startsWith('video/') && (
              <Video
                source={{ uri: filePreview.url }}
                style={tw`w-full h-48 rounded-lg mb-4`}
                useNativeControls
                resizeMode="contain"
                isMuted={true}
              />
            )}

            <TouchableOpacity
              onPress={() => downloadFile(filePreview?.url)}
              style={tw`bg-blue-500 rounded-full py-3 flex-row justify-center items-center`}
              disabled={downloading}
            >
              {downloading ? (
                <ActivityIndicator size="small" color="white" style={tw`mr-2`} />
              ) : (
                <Ionicons
                  name="download-outline"
                  size={20}
                  color="white"
                  style={tw`mr-2`}
                />
              )}
              <Text style={tw`text-white font-semibold`}>
                {downloading ? 'Downloading...' : 'Download File'}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>

      <Toast />
    </SafeAreaView>
  );
};

export default GroupChatScreen;
