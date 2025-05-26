import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Animated, Platform, Linking } from 'react-native';
import tw from 'twrnc';
import { Video, ResizeMode } from 'expo-av';
import { Ionicons, Feather } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { LinearGradient } from 'expo-linear-gradient';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';

const VideoMessage = ({
  uri,
  fileName,
  fileSize,
  timestamp = new Date(),
  isSent = true,
  status,
  onRetry,
}) => {
  const videoRef = useRef(null);
  const [state, setState] = useState({
    isPlaying: false,
    isLoading: isSent,
    error: false,
    duration: 0,
    position: 0,
    playbackRate: 1.0,
    isFullscreen: false,
    downloaded: isSent,
    downloadProgress: 0,
    localUri: isSent ? uri : null,
    shouldPlay: false, // Control playback state explicitly
  });
  const opacityAnim = useRef(new Animated.Value(1)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  // Unique key for this video (to detect edits)
  const videoKey = useMemo(() => `${uri}-${timestamp}`, [uri, timestamp]);

  // Load download state from storage on mount
  useEffect(() => {
    const checkDownloadState = async () => {
      if (isSent) return;

      try {
        const storedData = await AsyncStorage.getItem(`video_${videoKey}`);
        if (storedData) {
          const { localUri } = JSON.parse(storedData);
          if (Platform.OS === 'web') {
            // On web, localUri is the original uri (from Linking.openURL)
            setState((prev) => ({
              ...prev,
              downloaded: true,
              localUri,
              isLoading: false,
            }));
          } else {
            // On mobile, verify the file exists
            const fileInfo = await FileSystem.getInfoAsync(localUri);
            if (fileInfo.exists) {
              setState((prev) => ({
                ...prev,
                downloaded: true,
                localUri,
                isLoading: false,
              }));
            } else {
              await AsyncStorage.removeItem(`video_${videoKey}`);
            }
          }
        }
      } catch (err) {
        console.warn('Error checking download state:', err);
      }
    };

    checkDownloadState();
  }, [videoKey, isSent]);

  // Handle video playback state changes
  useEffect(() => {
    const updatePlayback = async () => {
      if (!videoRef.current) return;
      try {
        if (state.shouldPlay) {
          await videoRef.current.playAsync();
        } else {
          await videoRef.current.pauseAsync();
        }
      } catch (err) {
        console.warn('Playback error:', err);
        setState((prev) => ({ ...prev, error: 'Failed to update playback state' }));
      }
    };
    updatePlayback();
  }, [state.shouldPlay]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      videoRef.current?.stopAsync().catch(() => {});
      videoRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  // Toggle play/pause
  const togglePlayPause = useCallback(async () => {
    setState((prev) => ({ ...prev, shouldPlay: !prev.shouldPlay }));
  }, []);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(async () => {
    if (!videoRef.current) return;
    try {
      if (state.isFullscreen) {
        await videoRef.current.dismissFullscreenPlayer();
      } else {
        await videoRef.current.presentFullscreenPlayer();
      }
      setState((prev) => ({ ...prev, isFullscreen: !prev.isFullscreen }));
    } catch (err) {
      console.warn('Fullscreen error:', err);
      setState((prev) => ({ ...prev, error: 'Failed to toggle fullscreen' }));
    }
  }, [state.isFullscreen]);

  // Change playback speed
  const changePlaybackRate = useCallback(
    async (rate) => {
      if (!videoRef.current) return;
      try {
        await videoRef.current.setRateAsync(rate, true);
        setState((prev) => ({ ...prev, playbackRate: rate }));
      } catch (err) {
        console.warn('Playback rate error:', err);
      }
    },
    []
  );

  // Seek video using slider
  const onSliderValueChange = useCallback(
    async (value) => {
      if (!videoRef.current) return;
      const newPosition = value * state.duration;
      try {
        await videoRef.current.setPositionAsync(newPosition);
        setState((prev) => ({ ...prev, position: newPosition }));
      } catch (err) {
        console.warn('Seek error:', err);
      }
    },
    [state.duration]
  );

  // Handle download for receivers
  const handleDownload = useCallback(async () => {
    if (Platform.OS === 'web') {
      try {
        await Linking.openURL(uri);
        setState((prev) => ({
          ...prev,
          downloaded: true,
          isLoading: false,
          localUri: uri,
        }));
        // Persist download state for web
        await AsyncStorage.setItem(
          `video_${videoKey}`,
          JSON.stringify({ localUri: uri })
        );
      } catch (err) {
        setState((prev) => ({
          ...prev,
          error: 'Failed to open video URL',
          isLoading: false,
        }));
      }
      return;
    }

    try {
      setState((prev) => ({ ...prev, isLoading: true, downloadProgress: 0 }));

      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted' && Platform.OS !== 'web') {
        throw new Error('Storage permission required to download the video');
      }

      if (!uri || !uri.startsWith('http')) {
        throw new Error('Invalid video URL');
      }

      const targetUri = `${FileSystem.cacheDirectory}${
        fileName || `video_${Date.now()}.mp4`
      }`;

      const downloadResumable = FileSystem.createDownloadResumable(
        uri,
        targetUri,
        {},
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          const progress = totalBytesWritten / totalBytesExpectedToWrite;
          setState((prev) => ({ ...prev, downloadProgress: progress }));
        }
      );

      const { uri: downloadedUri } = await downloadResumable.downloadAsync();

      const fileInfo = await FileSystem.getInfoAsync(downloadedUri);
      if (!fileInfo.exists) {
        throw new Error('Downloaded file not found');
      }

      if (Platform.OS !== 'web') {
        await MediaLibrary.saveToLibraryAsync(downloadedUri);
      }

      await AsyncStorage.setItem(
        `video_${videoKey}`,
        JSON.stringify({ localUri: downloadedUri })
      );

      setState((prev) => ({
        ...prev,
        downloaded: true,
        isLoading: false,
        downloadProgress: 0,
        localUri: downloadedUri,
      }));
    } catch (err) {
      console.warn('Download error:', err);
      setState((prev) => ({
        ...prev,
        error: err.message || 'Failed to download video',
        isLoading: false,
        downloadProgress: 0,
      }));
    }
  }, [uri, fileName, videoKey]);

  // Animate control overlay
  useEffect(() => {
    Animated.timing(opacityAnim, {
      toValue: state.isPlaying ? 0 : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [state.isPlaying, opacityAnim]);

  // Animate download button
  const animateDownloadButton = useCallback(() => {
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 1.2,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, [scaleAnim]);

  // Format duration
  const formatDuration = useCallback((millis) => {
    const minutes = Math.floor(millis / 60000);
    const seconds = Math.floor((millis % 60000) / 1000);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }, []);

  // Format timestamp
  const formattedTime = useMemo(() => {
    let formatted = 'Unknown time';
    try {
      const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
      if (date instanceof Date && !isNaN(date)) {
        formatted = date.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
      } else {
        const match = timestamp.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
        if (match) {
          let hours = parseInt(match[1], 10);
          const minutes = match[2];
          const period = match[3].toLowerCase();
          if (period === 'pm' && hours < 12) hours += 12;
          if (period === 'am' && hours === 12) hours = 0;
          formatted = `${hours}:${minutes}`;
        }
      }
    } catch (error) {
      console.warn('Error parsing timestamp:', error);
    }
    return formatted;
  }, [timestamp]);

  // Handle playback status updates
  const handlePlaybackStatus = useCallback(
    (playbackStatus) => {
      if (playbackStatus.didJustFinish && !playbackStatus.isLooping) {
        setState((prev) => ({
          ...prev,
          shouldPlay: false,
          position: 0,
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        isPlaying: playbackStatus.isPlaying,
        isLoading: playbackStatus.isBuffering,
        error: playbackStatus.error,
        duration: playbackStatus.durationMillis || prev.duration,
        position: playbackStatus.positionMillis || prev.position,
        isFullscreen: playbackStatus.isFullscreen || prev.isFullscreen,
      }));
    },
    []
  );

  // Format file size
  const formattedFileSize = useMemo(() => {
    if (typeof fileSize === 'number') {
      return `${(fileSize / 1024 / 1024).toFixed(2)} MB`;
    }
    return fileSize || 'Unknown size';
  }, [fileSize]);

  if (!uri) return null;

  if (!isSent && !state.downloaded) {
    return (
      <View style={tw`flex-row ${isSent ? 'justify-end' : 'justify-start'} mb-2`}>
        <TouchableOpacity
          onPress={() => {
            animateDownloadButton();
            handleDownload();
          }}
          style={tw`bg-gray-200 dark:bg-gray-700 rounded-xl p-4 shadow-sm w-64 h-64 justify-center items-center`}
          accessibilityLabel={`Download video: ${fileName || uri?.split('/').pop()}`}
        >
          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            {state.isLoading ? (
              <View style={tw`items-center`}>
                <ActivityIndicator size="large" color="#3B82F6" />
                <Text style={tw`text-gray-800 dark:text-gray-200 text-sm mt-2 font-medium`}>
                  Downloading: {(state.downloadProgress * 100).toFixed(0)}%
                </Text>
              </View>
            ) : (
              <View style={tw`items-center`}>
                <Feather name="download" size={28} color="#3B82F6" />
                <Text
                  style={tw`mt-2 text-gray-800 dark:text-gray-200 text-sm font-medium text-center`}
                  numberOfLines={1}
                >
                  {fileName || uri?.split('/').pop()}
                </Text>
                <Text style={tw`text-xs text-gray-500 dark:text-gray-400 font-medium`}>
                  {formattedFileSize}
                </Text>
                <Text style={tw`text-xs text-gray-500 dark:text-gray-400 font-medium mt-1`}>
                  {formattedTime}
                </Text>
              </View>
            )}
          </Animated.View>
        </TouchableOpacity>
      </View>
    );
  }

  if (state.error) {
    return (
      <View style={tw`flex-row ${isSent ? 'justify-end' : 'justify-start'} mb-2`}>
        <View
          style={tw`w-64 h-64 rounded-xl bg-gray-200 dark:bg-gray-700 justify-center items-center shadow-sm p-4`}
        >
          <Text style={tw`text-red-400 text-sm font-medium text-center`}>
            {state.error}
          </Text>
          <TouchableOpacity
            onPress={isSent ? () => setState((prev) => ({ ...prev, error: false })) : handleDownload}
            style={tw`mt-2 bg-blue-600 rounded-full px-4 py-2 shadow-md`}
          >
            <Text style={tw`text-white text-sm font-medium`}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={tw`flex-row ${isSent ? 'justify-end' : 'justify-start'} mb-2`}>
      <View style={tw`max-w-72 ${isSent ? 'bg-blue-500' : 'bg-gray-200'} rounded-xl p-2 shadow-sm`}>
        {/* Video Container */}
        <View style={tw`relative w-64 h-64 rounded-lg overflow-hidden bg-black`}>
          <Video
            ref={videoRef}
            source={{ uri: state.localUri || uri }}
            style={tw`w-full h-full rounded-lg`}
            resizeMode={ResizeMode.COVER}
            shouldPlay={state.shouldPlay}
            isLooping={false} // Explicitly disable looping
            onPlaybackStatusUpdate={handlePlaybackStatus}
            onError={(error) => {
              console.warn('Video error:', error);
              setState((prev) => ({ ...prev, error: 'Failed to load video' }));
            }}
          />
          {/* Overlay for Controls and Loading */}
          <Animated.View
            style={[tw`absolute inset-0 flex justify-center items-center bg-black bg-opacity-30`, { opacity: opacityAnim }]}
          >
            {state.isLoading && !state.error && (
              <ActivityIndicator size="large" color="#ffffff" />
            )}
            {!state.isLoading && !state.error && (
              <TouchableOpacity
                onPress={togglePlayPause}
                style={tw`bg-gray-800 bg-opacity-70 rounded-full p-3`}
              >
                <Ionicons
                  name={state.isPlaying ? 'pause' : 'play'}
                  size={24}
                  color="#ffffff"
                />
              </TouchableOpacity>
            )}
          </Animated.View>
          {/* Fullscreen Toggle */}
          <TouchableOpacity
            onPress={toggleFullscreen}
            style={tw`absolute top-2 left-2 bg-gray-800 bg-opacity-70 rounded-full p-1`}
          >
            <Ionicons
              name={state.isFullscreen ? 'contract' : 'expand'}
              size={18}
              color="#ffffff"
            />
          </TouchableOpacity>
          {/* Share/Download Icon */}
          <TouchableOpacity
            style={tw`absolute top-2 right-2 bg-gray-800 bg-opacity-70 rounded-full p-1`}
          >
            <Ionicons name="share-outline" size={18} color="#ffffff" />
          </TouchableOpacity>
        </View>
        {/* Time Slider */}
        <View style={tw`flex-row items-center mt-1 px-2`}>
          <Text style={tw`text-xs ${isSent ? 'text-white' : 'text-gray-600'} mr-2`}>
            {formatDuration(state.position)}
          </Text>
          <Slider
            style={tw`flex-1 h-4`}
            minimumValue={0}
            maximumValue={1}
            value={state.duration ? state.position / state.duration : 0}
            onValueChange={onSliderValueChange}
            minimumTrackTintColor="#3b82F6"
            maximumTrackTintColor="#d1d5db"
            thumbTintColor="#3b82F6"
          />
          <Text style={tw`text-xs ${isSent ? 'text-white' : 'text-gray-600'} ml-2`}>
            {formatDuration(state.duration)}
          </Text>
        </View>
        {/* Playback Speed Controls */}
        <View style={tw`flex-row justify-center mt-1 px-2`}>
          {[0.5, 1.0, 1.5, 2.0].map((rate) => (
            <TouchableOpacity
              key={rate}
              onPress={() => changePlaybackRate(rate)}
              style={tw`mx-1 px-2 py-1 rounded-full ${
                state.playbackRate === rate ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            >
              <Text
                style={tw`text-xs ${
                  state.playbackRate === rate ? 'text-white' : 'text-gray-600'
                }`}
              >
                {rate}x
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {/* Inline Filename, Size, Duration, Timestamp, and Status */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.7)']}
          style={tw`mt-1 p-2 rounded-b-xl`}
        >
          <View style={tw`flex-row items-center justify-between`}>
            <View style={tw`flex-1`}>
              <Text
                style={tw`text-white text-xs font-medium`}
                numberOfLines={1}
              >
                {fileName || uri?.split('/').pop()}
              </Text>
              <Text style={tw`text-gray-300 text-xs font-medium`}>
                {formattedFileSize}
              </Text>
            </View>
            <View style={tw`flex-row items-center`}>
              <Text style={tw`text-white text-xs font-medium mr-2`}>
                {formatDuration(state.duration)}
              </Text>
              <Text style={tw`text-gray-300 text-xs font-medium mr-2`}>
                {formattedTime}
              </Text>
              {isSent && status && (
                <TouchableOpacity
                  onPress={() => status === 'pending' && onRetry && onRetry()}
                  accessibilityLabel={
                    status === 'pending' ? 'Retry sending' : 'Message status'
                  }
                >
                  <Text
                    style={tw`text-xs font-medium ${
                      status === '✓✓' ? 'text-blue-300' : 'text-gray-300'
                    }`}
                  >
                    {status === 'pending' && onRetry ? 'Retry' : status}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </LinearGradient>
      </View>
    </View>
  );
};

export default VideoMessage;