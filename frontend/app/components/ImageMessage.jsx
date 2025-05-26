import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, TouchableOpacity, ActivityIndicator, Text, Image, Modal, Pressable, Platform, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, Ionicons } from '@expo/vector-icons';
import tw from 'twrnc';
import { PinchGestureHandler, State } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ImageMessage = React.memo(({ uri, fileName, fileSize, isSent, timestamp, status, onRetry }) => {
  const [state, setState] = useState({
    loading: false,
    error: null,
    downloaded: isSent,
    downloadProgress: 0,
    localUri: isSent ? uri : null,
    isFullscreen: false,
  });

  // Zoom state using Reanimated
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);

  // Unique key for this image (to detect edits)
  const imageKey = useMemo(() => `${uri}-${timestamp}`, [uri, timestamp]);

  // Load download state from storage on mount
  useEffect(() => {
    const checkDownloadState = async () => {
      if (isSent) return;

      try {
        const storedData = await AsyncStorage.getItem(`image_${imageKey}`);
        if (storedData) {
          const { localUri } = JSON.parse(storedData);
          if (Platform.OS === 'web') {
            setState((prev) => ({
              ...prev,
              downloaded: true,
              localUri,
              loading: false,
            }));
          } else {
            const fileInfo = await FileSystem.getInfoAsync(localUri);
            if (fileInfo.exists) {
              setState((prev) => ({
                ...prev,
                downloaded: true,
                localUri,
                loading: false,
              }));
            } else {
              await AsyncStorage.removeItem(`image_${imageKey}`);
            }
          }
        }
      } catch (err) {
        console.warn('Error checking download state:', err);
      }
    };

    checkDownloadState();
  }, [imageKey, isSent]);

  const onPinchGestureEvent = useCallback((event) => {
    scale.value = savedScale.value * event.nativeEvent.scale;
    focalX.value = event.nativeEvent.focalX;
    focalY.value = event.nativeEvent.focalY;
  }, []);

  const onPinchStateChange = useCallback((event) => {
    if (event.nativeEvent.state === State.END) {
      savedScale.value = scale.value;
      if (scale.value < 1) {
        scale.value = withSpring(1);
        savedScale.value = 1;
      }
    }
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handleDownload = useCallback(async () => {
    if (Platform.OS === 'web') {
      try {
        await Linking.openURL(uri);
        setState((prev) => ({
          ...prev,
          downloaded: true,
          loading: false,
          localUri: uri,
        }));
        await AsyncStorage.setItem(
          `image_${imageKey}`,
          JSON.stringify({ localUri: uri })
        );
      } catch (err) {
        setState((prev) => ({
          ...prev,
          error: 'Failed to open image URL',
          loading: false,
        }));
      }
      return;
    }

    try {
      setState((prev) => ({ ...prev, loading: true, downloadProgress: 0 }));

      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted' && Platform.OS !== 'web') {
        throw new Error('Storage permission required to download the image');
      }

      if (!uri || !uri.startsWith('http')) {
        throw new Error('Invalid image URL');
      }

      const targetUri = `${FileSystem.cacheDirectory}${
        fileName || `image_${Date.now()}.jpg`
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
        `image_${imageKey}`,
        JSON.stringify({ localUri: downloadedUri })
      );

      setState((prev) => ({
        ...prev,
        downloaded: true,
        loading: false,
        downloadProgress: 0,
        localUri: downloadedUri,
      }));
    } catch (err) {
      console.warn('Download error:', err);
      setState((prev) => ({
        ...prev,
        error: err.message || 'Failed to download image',
        loading: false,
        downloadProgress: 0,
      }));
    }
  }, [uri, fileName, imageKey]);

  const time = useMemo(() => {
    let formattedTime = 'Unknown time';
    try {
      const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
      if (date instanceof Date && !isNaN(date)) {
        formattedTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        const match = timestamp.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
        if (match) {
          let hours = parseInt(match[1], 10);
          const minutes = match[2];
          const period = match[3].toLowerCase();
          if (period === 'pm' && hours < 12) hours += 12;
          if (period === 'am' && hours === 12) hours = 0;
          formattedTime = `${hours}:${minutes}`;
        }
      }
    } catch (error) {
      console.warn('Error parsing timestamp:', error);
    }
    return formattedTime;
  }, [timestamp]);

  const formattedFileSize = useMemo(() => {
    if (typeof fileSize === 'number') {
      return `${(fileSize / 1024 / 1024).toFixed(2)} MB`;
    }
    return fileSize || 'Unknown size';
  }, [fileSize]);

  if (!uri) return null;

  if (!isSent && !state.downloaded) {
    return (
      <TouchableOpacity
        onPress={handleDownload}
        style={tw`flex-row items-center bg-gray-200 dark:bg-gray-700 rounded-xl p-4 shadow-sm w-64 h-64 justify-center`}
        accessibilityLabel={`Download image: ${fileName || uri?.split('/').pop()}`}
      >
        {state.loading ? (
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
              {time}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  const renderImage = () => (
    <PinchGestureHandler onGestureEvent={onPinchGestureEvent} onHandlerStateChange={onPinchStateChange}>
      <Animated.View style={[tw`w-full h-full`, animatedStyle]}>
        <Image
          source={{ uri: state.localUri || uri }}
          style={tw`w-full h-full rounded-xl shadow-sm`}
          resizeMode="contain"
          onLoadStart={() => setState((prev) => ({ ...prev, loading: true }))}
          onLoad={() => setState((prev) => ({ ...prev, loading: false }))}
          onError={() => {
            setState((prev) => ({
              ...prev,
              loading: false,
              error: 'Failed to load image',
            }));
          }}
        />
      </Animated.View>
    </PinchGestureHandler>
  );

  return (
    <>
      <View style={tw`relative w-64 h-64 rounded-xl shadow-lg overflow-hidden`}>
        {state.loading && !state.error && (
          <View style={tw`absolute inset-0 flex justify-center items-center bg-gray-200 dark:bg-gray-700 rounded-xl`}>
            <ActivityIndicator size="large" color="#3B82F6" />
          </View>
        )}
        {state.error ? (
          <View style={tw`w-64 h-64 rounded-xl bg-gray-200 dark:bg-gray-700 justify-center items-center`}>
            <Text style={tw`text-red-500 dark:text-red-400 text-sm`}>{state.error}</Text>
            <TouchableOpacity
              onPress={isSent ? () => setState((prev) => ({ ...prev, error: null })) : handleDownload}
              style={tw`mt-2 bg-blue-600 rounded-full px-4 py-2 shadow-md`}
            >
              <Text style={tw`text-white text-sm font-medium`}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {renderImage()}
            {/* Fullscreen Toggle Button */}
            <TouchableOpacity
              onPress={() => setState((prev) => ({ ...prev, isFullscreen: true }))}
              style={tw`absolute top-2 right-2 bg-gray-800 bg-opacity-70 rounded-full p-1`}
            >
              <Ionicons name="expand" size={18} color="#ffffff" />
            </TouchableOpacity>
          </>
        )}
        <LinearGradient
          colors={['rgba(0,0,0,0.7)', 'rgba(0,0,0,0.4)']}
          style={tw`absolute bottom-0 left-0 right-0 p-2 rounded-b-xl`}
        >
          <View style={tw`flex-row items-center justify-between`}>
            <Text style={tw`text-white text-xs font-medium`} numberOfLines={1}>
              {fileName || uri?.split('/').pop()} ({formattedFileSize})
            </Text>
            <View style={tw`flex-row items-center`}>
              <Text style={tw`text-xs text-white mr-2 font-medium`}>{time}</Text>
              {isSent && status && (
                <TouchableOpacity
                  onPress={() => status === 'pending' && onRetry && onRetry()}
                  accessibilityLabel={status === 'pending' ? 'Retry sending' : 'Message status'}
                >
                  <Text style={tw`text-xs font-medium ${status === '✓✓' ? 'text-blue-300' : 'text-gray-200'}`}>
                    {status === 'pending' && onRetry ? 'Retry' : status}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </LinearGradient>
      </View>

      {/* Fullscreen Modal */}
      <Modal
        visible={state.isFullscreen}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setState((prev) => ({ ...prev, isFullscreen: false }))}
      >
        <View style={tw`flex-1 bg-black justify-center items-center`}>
          {renderImage()}
          <TouchableOpacity
            onPress={() => setState((prev) => ({ ...prev, isFullscreen: false }))}
            style={tw`absolute top-10 right-5 bg-gray-800 bg-opacity-70 rounded-full p-2`}
          >
            <Ionicons name="close" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
});

export default ImageMessage;