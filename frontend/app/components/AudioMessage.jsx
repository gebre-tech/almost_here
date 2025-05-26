// app/components/AudioMessage.jsx
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { View, TouchableOpacity, ActivityIndicator, Text, Platform, Animated } from 'react-native';
import { ProgressViewIOS } from '@react-native-community/progress-view';
import { Audio } from 'expo-av';
import { Ionicons, Feather } from '@expo/vector-icons';
import tw from 'twrnc';

const AudioMessage = React.memo(({ uri, fileName, fileSize, timestamp, status, isSent, onRetry }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // Playback progress
  const [downloadProgress, setDownloadProgress] = useState(0); // Download progress
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloaded, setDownloaded] = useState(isSent);
  const soundRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(0)).current; // For fade-in animation

  const handleDownload = useCallback(async () => {
    try {
      setLoading(true);
      setDownloadProgress(0); // Reset download progress
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false, progressUpdateIntervalMillis: 100 },
        (status) => {
          if (status.isLoaded) {
            if (status.durationMillis) setDuration(status.durationMillis / 1000);
            if (status.positionMillis) setProgress(status.positionMillis / status.durationMillis);
          }
          // Simulate download progress (Expo AV doesn't provide this directly)
          if (status.didJustFinish) setDownloadProgress(1);
        },
        true // Enable download progress updates
      );

      // Simulate download progress (since Expo AV doesn't provide native progress)
      const simulateProgress = setInterval(() => {
        setDownloadProgress((prev) => {
          const next = prev + 0.1;
          if (next >= 1) {
            clearInterval(simulateProgress);
            return 1;
          }
          return next;
        });
      }, 300);

      soundRef.current = sound;
      setDownloaded(true);

      // Fade-in animation for the audio player
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } catch (err) {
      setError('Failed to download audio. Tap to retry.');
    } finally {
      setLoading(false);
    }
  }, [uri, fadeAnim]);

  useEffect(() => {
    if (downloaded && !soundRef.current) {
      handleDownload();
    }
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, [downloaded, handleDownload]);

  const handlePlayback = useCallback(async () => {
    try {
      setLoading(true);
      if (isPlaying) {
        await soundRef.current.pauseAsync();
        setIsPlaying(false);
      } else {
        await soundRef.current.playAsync();
        setIsPlaying(true);
      }
    } catch (err) {
      setError('Failed to play audio. Tap to retry.');
    } finally {
      setLoading(false);
    }
  }, [isPlaying]);

  const handleRetryDownload = useCallback(() => {
    setError(null);
    setDownloadProgress(0);
    handleDownload();
  }, [handleDownload]);

  const time = useMemo(() => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), [timestamp]);
  const formattedDuration = useMemo(() => {
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }, [duration]);

  if (!uri) return null;

  if (!isSent && !downloaded) {
    return (
      <TouchableOpacity
        onPress={handleDownload}
        style={tw`flex-row items-center bg-gray-200 dark:bg-gray-700 rounded-xl p-4 shadow-sm w-64 h-20 justify-center`}
        accessibilityLabel={`Download audio: ${fileName || uri?.split('/').pop()}`}
      >
        {loading ? (
          <View style={tw`flex-row items-center justify-center`}>
            <ActivityIndicator size="large" color="#3B82F6" style={tw`mr-3`} />
            <Text style={tw`text-gray-800 dark:text-gray-200 text-sm font-medium`}>Downloading...</Text>
            {Platform.OS === 'ios' ? (
              <ProgressViewIOS
                progress={downloadProgress}
                progressTintColor="#3B82F6"
                trackTintColor="#D1D5DB"
                style={tw`w-32 ml-3`}
              />
            ) : (
              <View style={tw`w-32 h-1 bg-gray-400 rounded-full ml-3`}>
                <View style={[tw`h-1 bg-blue-500 rounded-full`, { width: `${downloadProgress * 100}%` }]} />
              </View>
            )}
          </View>
        ) : (
          <>
            <Feather name="download" size={28} color="#3B82F6" />
            <Text style={tw`ml-3 text-gray-800 dark:text-gray-200 text-sm font-medium flex-1`} numberOfLines={1}>
              {fileName || uri?.split('/').pop()} {fileSize && `(${(fileSize / 1024 / 1024).toFixed(2)} MB)`}
            </Text>
            <Text style={tw`text-xs text-gray-500 dark:text-gray-400 mr-2 font-medium`}>{time}</Text>
          </>
        )}
      </TouchableOpacity>
    );
  }

  if (error) {
    return (
      <TouchableOpacity
        onPress={handleRetryDownload}
        style={tw`w-64 rounded-xl bg-gray-200 dark:bg-gray-700 p-3 shadow-sm justify-center items-center`}
      >
        <Text style={tw`text-red-500 dark:text-red-400 text-sm`}>{error}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <Animated.View style={[tw`w-64 rounded-xl bg-gray-200 dark:bg-gray-700 p-3 shadow-sm`, { opacity: fadeAnim }]}>
      <View style={tw`flex-row items-center`}>
        {loading ? (
          <ActivityIndicator size="small" color="#3B82F6" />
        ) : (
          <TouchableOpacity onPress={handlePlayback} accessibilityLabel={isPlaying ? 'Pause audio' : 'Play audio'}>
            <Ionicons name={isPlaying ? 'pause-circle' : 'play-circle'} size={28} color="#3B82F6" />
          </TouchableOpacity>
        )}
        <View style={tw`ml-3 flex-1`}>
          <Text style={tw`text-gray-800 dark:text-gray-200 font-medium text-sm`}>Audio Message</Text>
          <View style={tw`h-1 bg-gray-400 dark:bg-gray-600 rounded-full mt-1`}>
            <View style={[tw`h-1 bg-blue-500 rounded-full`, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={tw`text-gray-600 dark:text-gray-400 text-xs mt-1`}>{formattedDuration}</Text>
        </View>
      </View>
      {(fileName || fileSize) && (
        <Text style={tw`text-gray-600 dark:text-gray-400 text-xs font-medium mt-2`} numberOfLines={1}>
          {fileName || uri?.split('/').pop()} {fileSize && `(${(fileSize / 1024 / 1024).toFixed(2)} MB)`}
        </Text>
      )}
      <View style={tw`flex-row items-center justify-end mt-2`}>
        <Text style={tw`text-xs text-gray-500 dark:text-gray-400 mr-2 font-medium`}>{time}</Text>
        {isSent && (
          <TouchableOpacity onPress={status === 'pending' && onRetry ? onRetry : null}>
            <Text style={tw`text-xs font-medium ${status === '✓✓' ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'}`}>
              {status === 'pending' && onRetry ? 'Retry' : status}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
});

export default AudioMessage;