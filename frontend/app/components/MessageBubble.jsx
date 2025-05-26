// app/components/MessageBubble.jsx
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import tw from 'twrnc';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable } from 'react-native-gesture-handler';
import { REACTION_EMOJIS } from '../utils/constants';
const MessageBubble = ({ isSent, children, onLongPress, onPress, reactions, showReactions }) => {
  return (
    <TouchableOpacity
      style={tw`max-w-[80%] relative ${isSent ? 'ml-auto' : 'mr-auto'}`}
      onLongPress={onLongPress}
      onPress={onPress}
    >
      <LinearGradient
        colors={isSent ? ['#60A5FA', '#3B82F6'] : ['#E5E7EB', '#D1D5DB']}
        style={tw`rounded-3xl p-3 shadow-sm relative ${
          isSent ? 'rounded-br-none' : 'rounded-bl-none'
        }`}
      >
        {children}
      </LinearGradient>
      {/* Tail */}
      <View
        style={tw`absolute bottom-0 ${
          isSent ? 'right-[-8px]' : 'left-[-8px]'
        } w-3 h-3 ${isSent ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
      >
        <View
          style={tw`absolute w-3 h-3 ${isSent ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'} rounded-full ${
            isSent ? 'right-0' : 'left-0'
          }`}
        />
      </View>
      {reactions?.length > 0 && (
        <View style={tw`flex-row mt-1 bg-gray-300 dark:bg-gray-600 rounded-full px-2 py-1 self-end shadow-sm`}>
          {reactions.map((emoji, idx) => (
            <Text key={idx} style={tw`text-sm mr-1`}>{emoji}</Text>
          ))}
        </View>
      )}
      {showReactions && (
        <View
          style={tw`absolute bottom-12 ${isSent ? 'right-0' : 'left-0'} bg-white dark:bg-gray-800 p-2 rounded-full shadow-lg flex-row border border-gray-200 dark:border-gray-700`}
        >
          {REACTION_EMOJIS.map((emoji) => (
            <Pressable key={emoji} onPress={() => showReactions(emoji)} style={tw`p-1`} accessibilityLabel={`React with ${emoji}`}>
              <Text style={tw`text-lg`}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
};

export default MessageBubble;