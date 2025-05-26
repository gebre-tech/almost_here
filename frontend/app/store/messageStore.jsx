import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { persist, devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

const ENABLE_LOGS = true;
const logger = {
  info: (...args) => ENABLE_LOGS && console.log('[MessageStore]', ...args),
  error: (...args) => console.error('[MessageStore]', ...args),
  warn: (...args) => console.warn('[MessageStore]', ...args),
};

const initialState = {
  messages: {}, // { [chatId]: { [messageId]: message } }
  typingUsers: {}, // { [chatId]: string[] }
};

const useMessageStore = create(
  devtools(
    persist(
      immer((set, get) => ({
        ...initialState,
        addMessage: (chatId, message) => {
          const messageId = message.messageId || `${message.timestamp}-${message.sender}`;
          if (!messageId) {
            logger.error('Skipping message without ID:', message);
            return;
          }
          set((state) => {
            if (!state.messages[chatId]) state.messages[chatId] = {};
            if (state.messages[chatId][messageId]) {
              logger.info(`Message ${messageId} already exists in chat ${chatId}, skipping`);
              return;
            }
            state.messages[chatId][messageId] = {
              ...message,
              status: message.status || 'sent',
              chatId,
              messageId,
            };
            logger.info(`Added message ${messageId} to chat ${chatId}`);
          });
        },
        updateMessage: (chatId, messageId, updates) => {
          set((state) => {
            if (!state.messages[chatId]?.[messageId]) {
              logger.error(`Message ${messageId} not found in chat ${chatId}`);
              return;
            }
            state.messages[chatId][messageId] = {
              ...state.messages[chatId][messageId],
              ...updates,
            };
            logger.info(`Updated message ${messageId} in chat ${chatId}`);
          });
        },
        deleteMessage: (chatId, messageId) => {
          set((state) => {
            if (!state.messages[chatId]?.[messageId]) {
              logger.error(`Message ${messageId} not found in chat ${chatId}`);
              return;
            }
            delete state.messages[chatId][messageId];
            if (Object.keys(state.messages[chatId]).length === 0) {
              delete state.messages[chatId];
            }
            logger.info(`Deleted message ${messageId} from chat ${chatId}`);
          });
        },
        setMessages: (chatId, messages) => {
          set((state) => {
            const safeMessages = Array.isArray(messages) ? messages : [];
            state.messages[chatId] = {};
            safeMessages.forEach((msg) => {
              const key = msg.messageId || `${msg.timestamp}-${msg.sender}`;
              if (key) {
                state.messages[chatId][key] = {
                  ...msg,
                  status: msg.status || 'sent',
                  chatId,
                  messageId: key,
                };
              }
            });
            logger.info(`Set ${safeMessages.length} messages for chat ${chatId}`);
          });
        },
        addTypingUser: (chatId, username) => {
          set((state) => {
            const chatTypingUsers = state.typingUsers[chatId] || [];
            if (chatTypingUsers.includes(username)) return;
            state.typingUsers[chatId] = [...chatTypingUsers, username].slice(-3);
            logger.info(`Added typing user ${username} to chat ${chatId}`);
          });
        },
        removeTypingUser: (chatId, username) => {
          set((state) => {
            const chatTypingUsers = state.typingUsers[chatId] || [];
            state.typingUsers[chatId] = chatTypingUsers.filter((u) => u !== username);
            if (state.typingUsers[chatId].length === 0) {
              delete state.typingUsers[chatId];
            }
            logger.info(`Removed typing user ${username} from chat ${chatId}`);
          });
        },
        clearMessages: (chatId) => {
          set((state) => {
            delete state.messages[chatId];
            delete state.typingUsers[chatId];
            logger.info(`Cleared messages and typing users for chat ${chatId}`);
          });
        },
        clearAll: () => {
          set(() => ({
            messages: {},
            typingUsers: {},
          }));
          logger.info('Cleared all messages and typing users');
        },
        getMessagesForChat: (senderId, receiverId) => {
          const chatId = `chat_${Math.min(senderId, receiverId)}_${Math.max(senderId, receiverId)}`;
          const messages = get().messages[chatId] || {};
          return Object.values(messages).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        },
      })),
      {
        name: 'message-store',
        storage: {
          getItem: async (name) => {
            try {
              const value = await AsyncStorage.getItem(name);
              if (!value) {
                logger.info(`No data found in AsyncStorage for ${name}`);
                return initialState;
              }
              const parsed = JSON.parse(value);
              if (!parsed || typeof parsed !== 'object' || typeof parsed.messages !== 'object') {
                logger.warn(`Invalid data in AsyncStorage for ${name}, resetting to initial state`);
                await AsyncStorage.removeItem(name);
                return initialState;
              }
              logger.info(`Successfully hydrated store from AsyncStorage for ${name}`);
              return parsed;
            } catch (error) {
              logger.error(`Failed to parse AsyncStorage data for ${name}:`, error);
              await AsyncStorage.removeItem(name);
              return initialState;
            }
          },
          setItem: async (name, value) => {
            try {
              await AsyncStorage.setItem(name, JSON.stringify(value));
              logger.info(`Saved state to AsyncStorage for ${name}`);
            } catch (error) {
              logger.error(`Failed to save state to AsyncStorage for ${name}:`, error);
            }
          },
          removeItem: async (name) => {
            try {
              await AsyncStorage.removeItem(name);
              logger.info(`Removed AsyncStorage data for ${name}`);
            } catch (error) {
              logger.error(`Failed to remove AsyncStorage data for ${name}:`, error);
            }
          },
        },
      }
    ),
    { name: 'MessageStore' }
  )
);

export default useMessageStore;