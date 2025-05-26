import React, { memo, useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, Platform, Dimensions, Animated, ActivityIndicator, Modal } from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Audio, Video } from 'expo-av';
import * as Progress from 'react-native-progress';
import * as FileSystem from 'expo-file-system';
import aesjs from 'aes-js';
import { Buffer } from 'buffer';
import tw from 'twrnc';
import { PLACEHOLDER_IMAGE_ICON } from '../utils/constants';

const MediaMessage = memo(({
  item,
  isCurrentUser,
  isDownloaded,
  localUri,
  onFullScreen,
  onDownload,
  onOpen,
  formatFileSize,
  downloading,
  downloadProgress,
  messageId,
  noise,
  retrieveMessageKey,
  onEdit,
  onDelete,
  isEditable,
}) => {
  const [decryptedUri, setDecryptedUri] = useState(localUri || null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playbackObj, setPlaybackObj] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState(null);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const videoRef = useRef(null);
  const screenWidth = Dimensions.get('window').width * 0.6;
  const screenHeight = Dimensions.get('window').height * 0.3;

  const handleLongPress = useCallback(() => {
    if (isEditable) {
      Alert.alert(
        'Message Options',
        '',
        [
          {
            text: 'Edit',
            onPress: () => onEdit(item),
            style: item.type === 'text' ? 'default' : 'cancel',
            isDisabled: item.type !== 'text',
          },
          {
            text: 'Delete',
            onPress: () => onDelete(item.message_id),
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
  }, [isEditable, onEdit, onDelete, item]);

  const wrapFileName = useCallback((name) => {
    const maxWidth = screenWidth / 8;
    const words = name.split(/([._-])/);
    const lines = [];
    let currentLine = '';

    words.forEach((word, index) => {
      const testLine = currentLine + (currentLine ? '' : '') + word;
      const testWidth = new TextEncoder().encode(testLine).length;

      if (testWidth > maxWidth) {
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
  }, [screenWidth]);

  const wrappedFileName = wrapFileName(item.file_name);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.95, useNativeDriver: true }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start();
  };

  const handleAudioPlayPause = useCallback(async () => {
    if (!playbackObj || !decryptedUri) return;

    try {
      if (isPlaying) {
        await playbackObj.pauseAsync();
        setIsPlaying(false);
      } else {
        await playbackObj.playAsync();
        setIsPlaying(true);
      }
    } catch (e) {
      console.error('(NOBRIDGE) ERROR Audio play/pause error:', e);
      setError('Failed to play audio');
    }
  }, [playbackObj, isPlaying, decryptedUri]);

  const handleVideoPlayPause = useCallback(async () => {
    if (!videoRef.current) return;

    try {
      if (isPlaying) {
        await videoRef.current.pauseAsync();
        setIsPlaying(false);
      } else {
        await videoRef.current.playAsync();
        setIsPlaying(true);
      }
    } catch (e) {
      console.error('(NOBRIDGE) ERROR Video play/pause error:', e);
      setError('Failed to play video');
    }
  }, [isPlaying]);

  const toggleFullScreen = useCallback(() => {
    if (isDownloaded && decryptedUri && (item.file_type.startsWith('image/') || item.file_type.startsWith('video/'))) {
      setIsFullScreen(!isFullScreen);
      if (item.file_type.startsWith('video/') && isPlaying) {
        videoRef.current?.pauseAsync();
        setIsPlaying(false);
      }
    }
  }, [isDownloaded, decryptedUri, item.file_type, isPlaying, isFullScreen]);

  useEffect(() => {
    let isActive = true;

    const decryptFile = async () => {
      try {
        if (!item.file_url) {
          throw new Error('Missing file URI');
        }

        if (isCurrentUser && localUri) {
          // Sender's file: use localUri directly
          if (isActive) {
            setDecryptedUri(localUri);
            setIsLoading(false);
          }
          return;
        }

        if (!isDownloaded) {
          if (isActive) {
            setDecryptedUri(null);
            setIsLoading(false);
          }
          return;
        }

        if (localUri) {
          // Already downloaded file
          if (isActive) {
            setDecryptedUri(localUri);
            setIsLoading(false);
          }
          return;
        }

        if (!noise?.handshakeFinished || !item.nonce || !item.ephemeral_key) {
          if (isActive) {
            setError('Cannot decrypt file: missing encryption data or handshake incomplete');
            setDecryptedUri(PLACEHOLDER_IMAGE_ICON);
            setIsLoading(false);
          }
          return;
        }

        let key = retrieveMessageKey(messageId);
        if (key) {
          console.log(`(NOBRIDGE) Using SQLite key for multimedia message ID: ${messageId}`);
        } else {
          console.log(`(NOBRIDGE) Generating key for multimedia message ID: ${messageId}`);
          const keyData = await noise.generateMessageKey(item.ephemeral_key);
          key = keyData.key;
        }

        // Use the downloaded file from downloadFile
        const extension = item.file_type.startsWith('image/') ? 'jpg' :
                         item.file_type.startsWith('video/') ? 'mp4' :
                         item.file_type.startsWith('audio/') ? 'mp3' : item.file_name.split('.').pop() || 'file';
        const tempUri = `${FileSystem.documentDirectory}downloaded_${messageId}.${extension}`;

        const fileInfo = await FileSystem.getInfoAsync(tempUri);
        if (!fileInfo.exists) {
          throw new Error('Decrypted file not found');
        }

        if (isActive) {
          setDecryptedUri(tempUri);
          setIsLoading(false);
        }
      } catch (e) {
        if (isActive) {
          console.error('(NOBRIDGE) ERROR Decrypting file:', e);
          setError(e.message || 'Failed to load file');
          setDecryptedUri(PLACEHOLDER_IMAGE_ICON);
          setIsLoading(false);
        }
      }
    };

    decryptFile();

    return () => {
      isActive = false;
      if (decryptedUri && decryptedUri !== item.file_url && !localUri && Platform.OS !== 'web') {
        FileSystem.deleteAsync(decryptedUri).catch(() => {});
      }
    };
  }, [item.file_url, item.nonce, item.ephemeral_key, item.file_type, item.file_name, isDownloaded, localUri, noise, messageId, retrieveMessageKey, isCurrentUser]);

  useEffect(() => {
    if (item.file_type.startsWith('audio/') && decryptedUri && isDownloaded) {
      const loadAudio = async () => {
        try {
          const { sound } = await Audio.Sound.createAsync(
            { uri: decryptedUri },
            { shouldPlay: false },
            (status) => {
              setPlaybackStatus(status);
              if (status.didJustFinish) {
                setIsPlaying(false);
              }
            }
          );
          setPlaybackObj(sound);
        } catch (e) {
          console.error('(NOBRIDGE) ERROR Loading audio:', e);
          setError('Failed to load audio');
        }
      };
      loadAudio();
    }

    return () => {
      if (playbackObj) {
        playbackObj.unloadAsync().catch(() => {});
      }
    };
  }, [decryptedUri, isDownloaded, item.file_type]);

  const getFileIcon = useCallback((fileType) => {
    if (fileType?.startsWith('image/')) return 'image';
    if (fileType?.startsWith('video/')) return 'videocam';
    if (fileType?.startsWith('audio/')) return 'mic';
    if (fileType?.includes('pdf')) return 'picture-as-pdf';
    if (fileType?.includes('document') || fileType?.includes('msword') || fileType?.includes('text')) return 'description';
    return 'insert-drive-file';
  }, []);

  const formatDuration = useCallback((millis) => {
    if (!millis) return '0:00';
    const seconds = Math.floor((millis / 1000) % 60);
    const minutes = Math.floor(millis / (1000 * 60));
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, []);

  if (isLoading) {
    return (
      <View style={tw`flex-row items-center p-2 bg-white rounded-lg shadow-md`}>
        <ActivityIndicator size="small" color="#6200EA" />
        <Text style={tw`text-gray-600 ml-2`}>Loading...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={tw`p-2 bg-red-100 rounded-lg`}>
        <Text style={tw`text-red-600`}>{error}</Text>
      </View>
    );
  }

  return (
    <>
      <TouchableOpacity
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onLongPress={handleLongPress}
        disabled={item.file_type.startsWith('audio/') || downloading[messageId]}
        onPress={() => {
          if (isDownloaded && decryptedUri && (item.file_type.startsWith('image/') || item.file_type.startsWith('video/'))) {
            toggleFullScreen();
          } else if (isDownloaded && decryptedUri) {
            onOpen();
          } else {
            onDownload();
          }
        }}
        style={tw`flex-row items-center`}
        accessibilityLabel={isDownloaded ? `View ${item.file_name}` : `Download ${item.file_name}`}
      >
        <Animated.View style={[tw`flex-row items-center`, { transform: [{ scale: scaleAnim }] }]}>
          {item.file_type.startsWith('image/') && isDownloaded && decryptedUri ? (
            <Image
              source={{ uri: decryptedUri }}
              style={tw`w-[${screenWidth}px] h-[${screenHeight}px] rounded-lg`}
              contentFit="cover"
              cachePolicy="memory-disk"
              placeholder={PLACEHOLDER_IMAGE_ICON}
              accessibilityLabel={`Image: ${item.file_name}`}
              onError={(e) => {
                console.error('(NOBRIDGE) ERROR Loading image:', e);
                setError('Failed to load image');
              }}
            />
          ) : item.file_type.startsWith('video/') && isDownloaded && decryptedUri ? (
            <TouchableOpacity
              onPress={handleVideoPlayPause}
              style={tw`w-[${screenWidth}px] h-[${screenHeight}px] rounded-lg bg-gray-200 flex items-center justify-center`}
              accessibilityLabel={isPlaying ? `Pause video: ${item.file_name}` : `Play video: ${item.file_name}`}
            >
              <Video
                ref={videoRef}
                source={{ uri: decryptedUri }}
                style={tw`w-full h-full rounded-lg`}
                useNativeControls={false}
                resizeMode="contain"
                shouldPlay={isPlaying}
                isLooping={false}
                onPlaybackStatusUpdate={(status) => {
                  setPlaybackStatus(status);
                  if (status.didJustFinish) {
                    setIsPlaying(false);
                  }
                }}
                onError={(e) => {
                  console.error('(NOBRIDGE) ERROR Video playback error:', e);
                  setError('Failed to play video');
                }}
                accessibilityLabel={`Video: ${item.file_name}`}
              />
              {!isPlaying && (
                <View style={tw`absolute inset-0 flex items-center justify-center bg-black/30`}>
                  <Ionicons name="play" size={40} color="white" />
                  <Text style={tw`absolute text-white text-sm bg-black/50 px-2 py-1 rounded`}>Video</Text>
                </View>
              )}
            </TouchableOpacity>
          ) : item.file_type.startsWith('audio/') && isDownloaded && decryptedUri ? (
            <View style={tw`flex-row items-center p-2 bg-gray-100 rounded-lg w-[${screenWidth}px]`}>
              <TouchableOpacity
                onPress={handleAudioPlayPause}
                style={tw`mr-2`}
                accessibilityLabel={isPlaying ? `Pause audio: ${item.file_name}` : `Play audio: ${item.file_name}`}
              >
                <Ionicons name={isPlaying ? 'pause' : 'play'} size={24} color="#6200EA" />
              </TouchableOpacity>
              <View style={tw`flex-1`}>
                <Text style={tw`text-gray-800`} accessibilityLabel={`Audio: ${item.file_name}`}>
                  {wrappedFileName}
                </Text>
                {playbackStatus && (
                  <Text style={tw`text-gray-500 text-xs mt-1`}>
                    {formatDuration(playbackStatus.positionMillis)} / {formatDuration(playbackStatus.durationMillis)}
                  </Text>
                )}
              </View>
            </View>
          ) : (
            <View style={tw`flex-row items-center p-2 bg-gray-100 rounded-lg w-[${screenWidth}px]`}>
              <MaterialIcons name={getFileIcon(item.file_type)} size={24} color="#6200EA" style={tw`mr-2`} />
              <View style={tw`flex-1`}>
                <Text style={tw`text-gray-800`} accessibilityLabel={`File: ${item.file_name}`}>
                  {wrappedFileName}
                </Text>
                <Text style={tw`text-gray-500 text-xs mt-1`}>Size: {formatFileSize(item.file_size)}</Text>
              </View>
              {downloading[messageId] ? (
                <Progress.Circle
                  size={24}
                  progress={downloadProgress[messageId] / 100}
                  showsText={false}
                  color="#6200EA"
                  style={tw`ml-2`}
                />
              ) : !isDownloaded ? (
                <TouchableOpacity onPress={onDownload} style={tw`ml-2`} accessibilityLabel={`Download ${item.file_name}`}>
                  <Ionicons name="download" size={24} color="#6200EA" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={onOpen} style={tw`ml-2`} accessibilityLabel={`Open ${item.file_name}`}>
                  <Ionicons name="open" size={24} color="#6200EA" />
                </TouchableOpacity>
              )}
            </View>
          )}
        </Animated.View>
      </TouchableOpacity>

      {/* Full Screen Modal */}
      <Modal
        visible={isFullScreen}
        transparent={false}
        animationType="slide"
        onRequestClose={toggleFullScreen}
      >
        <View style={tw`flex-1 bg-black justify-center items-center`}>
          <TouchableOpacity
            style={tw`absolute top-4 right-4 z-50 bg-black/70 rounded-full p-3`}
            onPress={toggleFullScreen}
            accessibilityLabel="Close media preview"
          >
            <Ionicons name="close" size={30} color="white" />
          </TouchableOpacity>

          {item.file_type.startsWith('image/') && decryptedUri ? (
            <Image
              source={{ uri: decryptedUri }}
              style={tw`w-full h-full max-w-[95%] max-h-[85%]`}
              contentFit="contain"
              cachePolicy="memory-disk"
              placeholder={PLACEHOLDER_IMAGE_ICON}
              accessibilityLabel={`Full screen image: ${item.file_name}`}
              onError={(e) => {
                console.error('(NOBRIDGE) ERROR Loading full-screen image:', e);
                setError('Failed to load image');
              }}
            />
          ) : item.file_type.startsWith('video/') && isDownloaded && decryptedUri ? (
            <Video
              ref={videoRef}
              source={{ uri: decryptedUri }}
              style={tw`w-full h-full max-w-[95%] max-h-[85%]`}
              useNativeControls={true}
              resizeMode="contain"
              isLooping={false}
              shouldPlay={true}
              onPlaybackStatusUpdate={(status) => {
                setPlaybackStatus(status);
                if (status.didJustFinish) {
                  setIsPlaying(false);
                }
              }}
              onError={(e) => {
                console.error('(NOBRIDGE) ERROR Full-screen video error:', e);
                setError('Failed to play video');
              }}
              accessibilityLabel={`Full screen video: ${item.file_name}`}
            />
          ) : (
            <Text style={tw`text-white`}>Unable to display media</Text>
          )}
        </View>
      </Modal>
    </>
  );
});

export default MediaMessage;