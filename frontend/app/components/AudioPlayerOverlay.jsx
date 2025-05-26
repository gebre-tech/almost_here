import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import tw from 'twrnc';
import useAudioPlayerStore from './useAudioPlayerStore';
import Slider from '@react-native-community/slider'; // Updated import

const AudioPlayerOverlay = () => {
  const { currentAudio, isPlaying, progress, duration, togglePlayback, stopPlayback, seekTo } = useAudioPlayerStore();
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    console.log('AudioPlayerOverlay rendering, currentAudio:', currentAudio); // Debug log
    if (currentAudio) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [currentAudio, fadeAnim]);

  const formattedDuration = useCallback(() => {
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }, [duration]);

  const formattedProgress = useCallback(() => {
    const currentTime = progress * duration;
    const minutes = Math.floor(currentTime / 60);
    const seconds = Math.floor(currentTime % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }, [progress, duration]);

  if (!currentAudio) return null;

  return (
    <Animated.View
      style={[
        tw`bg-blue-600 p-3 flex-row items-center justify-between shadow-lg mx-3 rounded-xl absolute top-0 left-0 right-0 z-50`,
        { opacity: fadeAnim },
      ]}
    >
      <View style={tw`flex-1 flex-row items-center`}>
        <TouchableOpacity onPress={togglePlayback} style={tw`mr-3`} accessibilityLabel={isPlaying ? 'Pause audio' : 'Play audio'}>
          <Ionicons name={isPlaying ? 'pause-circle' : 'play-circle'} size={28} color="white" />
        </TouchableOpacity>
        <View style={tw`flex-1`}>
          <Text style={tw`text-white font-medium text-sm`} numberOfLines={1}>
            {currentAudio.fileName || currentAudio.uri.split('/').pop()}
          </Text>
          <View style={tw`flex-row items-center mt-1`}>
            <Text style={tw`text-blue-200 text-xs mr-2`}>{formattedProgress()}</Text>
            <Slider
              style={tw`flex-1`}
              minimumValue={0}
              maximumValue={1}
              value={progress}
              onSlidingComplete={(value) => seekTo(value)}
              minimumTrackTintColor="#ffffff"
              maximumTrackTintColor="#93C5FD"
              thumbTintColor="#ffffff"
            />
            <Text style={tw`text-blue-200 text-xs ml-2`}>{formattedDuration()}</Text>
          </View>
        </View>
      </View>
      <TouchableOpacity onPress={stopPlayback} style={tw`ml-3`} accessibilityLabel="Close audio player">
        <Ionicons name="close-circle" size={24} color="white" />
      </TouchableOpacity>
    </Animated.View>
  );
};

export default AudioPlayerOverlay;