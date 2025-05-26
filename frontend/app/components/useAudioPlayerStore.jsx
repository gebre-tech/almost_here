import { create } from 'zustand';
import { Audio } from 'expo-av';

const useAudioPlayerStore = create((set, get) => ({
  currentAudio: null, // { uri, fileName, messageId, timestamp }
  sound: null,
  isPlaying: false,
  progress: 0,
  duration: 0,
  setCurrentAudio: async (audio) => {
    // Check for audio permissions
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== 'granted') {
      console.error('Audio permissions not granted');
      return;
    }

    const { sound: currentSound } = get();
    if (currentSound) {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
    }

    set({
      currentAudio: audio,
      sound: null,
      isPlaying: false,
      progress: 0,
      duration: 0,
    });

    if (audio) {
      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri: audio.uri },
          { shouldPlay: false, progressUpdateIntervalMillis: 100 },
          (status) => {
            if (status.isLoaded) {
              set({
                progress: status.positionMillis / (status.durationMillis || 1),
                duration: status.durationMillis / 1000 || 0,
                isPlaying: status.isPlaying,
              });
            }
          }
        );
        set({ sound });
      } catch (error) {
        console.error('Failed to load audio:', error);
        set({ currentAudio: null, sound: null, isPlaying: false, progress: 0, duration: 0 });
      }
    }
  },
  togglePlayback: async () => {
    const { sound, isPlaying } = get();
    if (!sound) return;

    try {
      if (isPlaying) {
        await sound.pauseAsync();
        set({ isPlaying: false });
      } else {
        await sound.playAsync();
        set({ isPlaying: true });
      }
    } catch (error) {
      console.error('Playback error:', error);
    }
  },
  stopPlayback: async () => {
    const { sound } = get();
    if (sound) {
      await sound.stopAsync();
      await sound.unloadAsync();
    }
    set({ currentAudio: null, sound: null, isPlaying: false, progress: 0, duration: 0 });
  },
  seekTo: async (position) => {
    const { sound, duration } = get();
    if (sound && duration) {
      const positionMillis = position * duration * 1000;
      await sound.setPositionAsync(positionMillis);
    }
  },
}));

export default useAudioPlayerStore;