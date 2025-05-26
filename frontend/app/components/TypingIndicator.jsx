import React, { useEffect, useRef } from 'react';
import { View, Text, Animated } from 'react-native';
import tw from 'twrnc';

const TypingIndicator = ({ users, isGroup, friendName }) => {
  const dotAnim1 = useRef(new Animated.Value(0)).current;
  const dotAnim2 = useRef(new Animated.Value(0)).current;
  const dotAnim3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animateDots = () => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(dotAnim1, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dotAnim2, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dotAnim3, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dotAnim1, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.timing(dotAnim2, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.timing(dotAnim3, { toValue: 0, duration: 300, useNativeDriver: true }),
        ])
      ).start();
    };
    animateDots();
  }, [dotAnim1, dotAnim2, dotAnim3]);

  return (
    <View style={tw`flex-row items-center mx-4 mb-2 bg-gray-100 dark:bg-gray-800 rounded-xl p-2 shadow-sm`}>
      <Text style={tw`text-gray-600 dark:text-gray-300 text-xs italic font-medium mr-2`}>
        {isGroup ? `${users.join(', ')} typing` : `${friendName} is typing`}
      </Text>
      <Animated.View style={[tw`w-2 h-2 bg-blue-500 rounded-full mr-1`, { opacity: dotAnim1 }]} />
      <Animated.View style={[tw`w-2 h-2 bg-blue-500 rounded-full mr-1`, { opacity: dotAnim2 }]} />
      <Animated.View style={[tw`w-2 h-2 bg-blue-500 rounded-full`, { opacity: dotAnim3 }]} />
    </View>
  );
};

export default TypingIndicator;