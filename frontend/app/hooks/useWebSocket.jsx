import { useEffect, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_HOST } from '../utils/constants';

export const useWebSocket = ({ userId, receiverId = null, isGlobal = false }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [newMessageNotifications, setNewMessageNotifications] = useState({});
  const socketRef = useRef(null);
  const subscribersRef = useRef({});
  const tokenRef = useRef(null);

  const generateChatId = useCallback((senderId, receiverId) => {
    if (!senderId || !receiverId) return null;
    return `chat_${Math.min(senderId, receiverId)}_${Math.max(senderId, receiverId)}`;
  }, []);

  const connect = useCallback(async () => {
    if (!userId || (socketRef.current?.readyState === WebSocket.OPEN)) return;

    const token = await AsyncStorage.getItem('token');
    if (!token) {
      console.error('No token found for WebSocket connection');
      return;
    }
    tokenRef.current = token;

    const wsUrl = isGlobal
      ? `ws://${API_HOST}/ws/global/?token=${token}`
      : `ws://${API_HOST}/ws/chat/${userId}/${receiverId}/?token=${token}`;
    socketRef.current = new WebSocket(wsUrl);

    socketRef.current.onopen = () => {
      setIsConnected(true);
      console.log(`WebSocket connected (${isGlobal ? 'global' : 'chat'})`);
      if (!isGlobal) {
        socketRef.current.send(JSON.stringify({ request_history: true }));
      }
    };

    socketRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'last_seen_update') {
          setOnlineUsers((prev) => {
            const newSet = new Set(prev);
            if (data.last_seen) newSet.add(data.user_id || data.username);
            else newSet.delete(data.user_id || data.username);
            return newSet;
          });
        } else if (data.type === 'message' || !data.type) {
          const chatId = isGlobal
            ? generateChatId(data.sender, data.receiver)
            : generateChatId(userId, receiverId);
          if (!chatId) return;

          const message = {
            sender: data.sender,
            receiver: data.receiver,
            message: data.message || '',
            type: data.message_type || data.type || 'text',
            file_url: data.file_url,
            file_name: data.file_name,
            file_type: data.file_type,
            nonce: data.nonce,
            ephemeral_key: data.ephemeral_key,
            message_key: data.message_key,
            timestamp: data.timestamp || new Date().toISOString(),
            chat: { id: chatId, members: [{ id: data.sender }, { id: data.receiver }] },
          };

          if (subscribersRef.current['message']) {
            subscribersRef.current['message'].forEach((callback) =>
              callback({ chatId, message })
            );
          }
          if (isGlobal) {
            setNewMessageNotifications((prev) => ({
              ...prev,
              [chatId]: (prev[chatId] || 0) + 1,
            }));
          }
        } else if (data.type === 'message_delivered') {
          const { chat_id, message_id } = data;
          if (subscribersRef.current['message_delivered']) {
            subscribersRef.current['message_delivered'].forEach((callback) =>
              callback({ chatId: chat_id, messageId: message_id })
            );
          }
        } else if (data.type === 'message_seen') {
          const { chat_id, message_id } = data;
          if (subscribersRef.current['message_seen']) {
            subscribersRef.current['message_seen'].forEach((callback) =>
              callback({ chatId: chat_id, messageId: message_id })
            );
          }
        } else if (data.type === 'typing') {
          const { chat_id, username, isTyping } = data;
          if (subscribersRef.current['typing']) {
            subscribersRef.current['typing'].forEach((callback) =>
              callback({ chatId: chat_id, username, isTyping })
            );
          }
        }
      } catch (error) {
        console.error('WebSocket message parsing error:', error);
      }
    };

    socketRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
    };

    socketRef.current.onclose = () => {
      console.log('WebSocket closed');
      setIsConnected(false);
    };
  }, [userId, receiverId, isGlobal, generateChatId]);

  useEffect(() => {
    connect();
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [connect]);

  const sendMessage = useCallback(
    (message) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify(message));
      } else {
        console.error('WebSocket is not connected');
      }
    },
    []
  );

  const sendTypingStatus = useCallback(
    (chatId, isTyping, username) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: 'typing',
            chat_id: chatId,
            username,
            isTyping,
          })
        );
      }
    },
    []
  );

  const subscribeToEvent = useCallback((event, callback) => {
    if (!subscribersRef.current[event]) {
      subscribersRef.current[event] = [];
    }
    subscribersRef.current[event].push(callback);
    return () => {
      subscribersRef.current[event] = subscribersRef.current[event].filter((cb) => cb !== callback);
    };
  }, []);

  const clearNotifications = useCallback((chatId) => {
    setNewMessageNotifications((prev) => {
      const newNotifications = { ...prev };
      delete newNotifications[chatId];
      return newNotifications;
    });
  }, []);

  const retryConnection = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
    }
    connect();
  }, [connect]);

  return {
    isConnected,
    onlineUsers,
    newMessageNotifications,
    sendMessage,
    sendTypingStatus,
    subscribeToEvent,
    clearNotifications,
    retryConnection,
  };
};