import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Platform,
  Alert,
} from 'react-native';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import tw from 'twrnc';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { API_URL } from '../utils/constants'; // e.g., http://192.168.137.1:8000
import * as ImagePicker from 'expo-image-picker';
import { AuthContext } from '../../context/AuthContext';
import Modal from 'react-native-modal';
import { LongPressGestureHandler, State } from 'react-native-gesture-handler';
import debounce from 'lodash.debounce';

const FileSystem = Platform.OS !== 'web' ? require('expo-file-system') : null;

const GroupInfo = () => {
  const { groupId } = useRoute().params;
  const navigation = useNavigation();
  const { user } = React.useContext(AuthContext);
  const [group, setGroup] = useState(null);
  const [groupProfilePicture, setGroupProfilePicture] = useState(null); // New state for profile picture
  const [memberProfiles, setMemberProfiles] = useState({});
  const [groupDetails, setGroupDetails] = useState(null);
  const [isModalVisible, setModalVisible] = useState(false);
  const [isAddMembersModalVisible, setAddMembersModalVisible] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [contactProfiles, setContactProfiles] = useState({});
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [profilePictureVersion, setProfilePictureVersion] = useState(0);
  const ws = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  const fetchGroupProfilePicture = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      const response = await axios.get(`${API_URL}/groups/list/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const groupData = response.data || [];
      const group = groupData.find((g) => g.id === parseInt(groupId));
      if (group && group.profile_picture) {
        let picUrl = group.profile_picture;
        if (!picUrl.startsWith('http')) {
          picUrl = `${API_URL}${picUrl}`;
        }
        setGroupProfilePicture(`${picUrl}?v=${profilePictureVersion}`);
      } else {
        setGroupProfilePicture(null);
      }
    } catch (error) {
      console.error('Error fetching group profile picture:', error);
      setGroupProfilePicture(null);
      setImageError(true);
    }
  }, [groupId, profilePictureVersion]);

  const fetchGroup = useCallback(
    debounce(async () => {
      try {
        const token = await AsyncStorage.getItem('token');
        if (!token) throw new Error('No authentication token found');
        const response = await axios.get(`${API_URL}/groups/list/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const groupData = response.data.find((g) => g.id === parseInt(groupId));
        if (groupData) {
          setGroup(groupData);
          fetchMemberProfiles(groupData.members);
          fetchGroupProfilePicture();
          setImageError(false);
        } else {
          console.warn(`Group ${groupId} not found in groups list`);
          navigation.reset({
            index: 0,
            routes: [{ name: 'Groups' }],
          });
        }
      } catch (error) {
        handleError(error, 'Failed to fetch group');
      }
    }, 300),
    [groupId, navigation, fetchGroupProfilePicture]
  );

  const fetchMemberProfiles = async (members) => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');

      const profiles = {};
      for (const member of members) {
        try {
          const response = await axios.get(`${API_URL}/profiles/friend/${member.username}/`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const profileData = response.data;
          const now = new Date();
          const lastSeen = profileData.last_seen ? new Date(profileData.last_seen) : null;
          profileData.is_online = lastSeen && (now - lastSeen) < 5 * 60 * 1000;
          profiles[member.id] = profileData;
        } catch (error) {
          console.warn(`Failed to fetch profile for ${member.username}:`, error.message);
          profiles[member.id] = {
            first_name: member.first_name || 'Unknown',
            username: member.username || 'unknown',
            profile_picture: null,
            is_online: false,
          };
        }
      }
      setMemberProfiles(profiles);
    } catch (error) {
      handleError(error, 'Failed to fetch member profiles');
    }
  };

  const fetchGroupDetails = async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      const response = await axios.get(`${API_URL}/groups/details/${groupId}/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const details = response.data;
      setGroupDetails(details);
      setGroup((prev) => ({
        ...prev,
        name: details.name,
      }));
      fetchGroupProfilePicture();
      setImageError(false);
      setModalVisible(true);
    } catch (error) {
      handleError(error, 'Failed to fetch group details');
    }
  };

  const fetchContacts = useCallback(async () => {
    try {
      setLoadingContacts(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      const response = await axios.get(`${API_URL}/contacts/list_with_profiles/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const contactsData = response.data || [];
      const filteredContacts = contactsData.filter(
        (contact) => !group?.members.some((member) => member.id === contact.friend_id)
      );
      setContacts(filteredContacts);

      const profiles = {};
      for (const contact of filteredContacts) {
        try {
          const profileResponse = await axios.get(
            `${API_URL}/profiles/friend/${contact.friend.user.username}/`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const profileData = profileResponse.data;
          const now = new Date();
          const lastSeen = profileData.last_seen ? new Date(profileData.last_seen) : null;
          profileData.is_online = lastSeen && (now - lastSeen) < 5 * 60 * 1000;
          profiles[contact.friend_id] = profileData;
        } catch (error) {
          console.warn(`Failed to fetch profile for ${contact.friend.user.username}:`, error.message);
          profiles[contact.friend_id] = {
            first_name: contact.friend.user.first_name || 'Unknown',
            username: contact.friend.user.username || 'unknown',
            profile_picture: null,
            is_online: false,
          };
        }
      }
      setContactProfiles(profiles);
    } catch (error) {
      handleError(error, 'Failed to fetch contacts');
    } finally {
      setLoadingContacts(false);
    }
  }, [group]);

  const connectWebSocket = async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        console.error('No token found for WebSocket connection');
        return;
      }

      ws.current = new WebSocket(`ws://192.168.137.1:8000/ws/groups/${groupId}/?token=${token}`);
      ws.current.onopen = () => {
        console.log(`GroupInfo WebSocket connected for group ${groupId}`);
        reconnectAttempts.current = 0;
      };
      ws.current.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'group_message') {
            const message = data.message;
            if (!message.sender || message.sender.username === 'system') {
              const systemMessages = {
                'Ownership transferred': 'Ownership Transferred',
                'was added to the group': 'Member Added',
                'was removed from the group': 'Member Removed',
                'was granted admin rights': 'Admin Assigned',
                'admin rights were revoked': 'Admin Revoked',
                'Group profile picture updated': 'Profile Picture Updated',
                'left the group': 'Member Left',
                'Group created': 'Group Created',
              };
              for (const [phrase, title] of Object.entries(systemMessages)) {
                if (message.message.includes(phrase)) {
                  Toast.show({
                    type: 'info',
                    text1: title,
                    text2: message.message,
                    position: 'bottom',
                  });
                  if (phrase === 'was removed from the group' && message.message.includes(user?.first_name)) {
                    Toast.show({
                      type: 'info',
                      text1: 'Removed from Group',
                      text2: 'You have been removed from the group.',
                      position: 'bottom',
                    });
                    navigation.reset({
                      index: 0,
                      routes: [{ name: 'Groups' }],
                    });
                    return;
                  }
                  if (phrase === 'left the group' && message.message.includes(user?.first_name)) {
                    navigation.reset({
                      index: 0,
                      routes: [{ name: 'Groups' }],
                    });
                    return;
                  }
                  if (phrase === 'Group profile picture updated') {
                    setProfilePictureVersion((prev) => prev + 1);
                    fetchGroupProfilePicture();
                    setImageError(false);
                  }
                  break;
                }
              }
            }
          } else if (data.type === 'group_updated') {
            setGroup(data.group);
            fetchMemberProfiles(data.group.members);
            fetchGroupProfilePicture();
            if (!data.group.members.some((member) => member.id === user?.id)) {
              Toast.show({
                type: 'info',
                text1: 'Removed from Group',
                text2: 'You are no longer a member of this group.',
                position: 'bottom',
              });
              navigation.reset({
                index: 0,
                routes: [{ name: 'Groups' }],
              });
            }
          } else if (data.type === 'group_deleted') {
            Toast.show({
              type: 'info',
              text1: 'Group Deleted',
              text2: data.message,
              position: 'bottom',
            });
            navigation.reset({
              index: 0,
              routes: [{ name: 'Groups' }],
            });
          } else if (data.type === 'read_receipt' || data.type === 'group_message_deleted') {
            fetchGroup();
          }
        } catch (error) {
          console.error('WebSocket message parsing error:', error);
        }
      };
      ws.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        if (reconnectAttempts.current < maxReconnectAttempts) {
          setTimeout(() => {
            console.log(`Reconnecting WebSocket, attempt ${reconnectAttempts.current + 1}`);
            connectWebSocket();
            reconnectAttempts.current += 1;
          }, 2000 * Math.pow(2, reconnectAttempts.current));
        } else {
          Toast.show({
            type: 'error',
            text1: 'Connection Error',
            text2: 'Failed to reconnect to group updates.',
            position: 'bottom',
          });
        }
      };
      ws.current.onclose = (event) => {
        console.log(`GroupInfo WebSocket closed with code: ${event.code}`);
      };
    } catch (error) {
      console.error('WebSocket connection setup error:', error);
    }
  };

  const toggleMember = (memberId) => {
    setSelectedMembers((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId]
    );
  };

  const addMembersToGroup = async () => {
    if (selectedMembers.length === 0) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Select at least one member to add',
        position: 'bottom',
      });
      return;
    }

    const isAdmin = group?.admins.some((admin) => admin.id === user?.id);
    if (!isAdmin) {
      Toast.show({
        type: 'error',
        text1: 'Permission Denied',
        text2: 'Only admins can add members.',
        position: 'bottom',
      });
      return;
    }

    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');

      for (const userId of selectedMembers) {
        await axios.post(
          `${API_URL}/groups/add_member/${groupId}/${userId}/`,
          {},
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }

      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Members added successfully',
        position: 'bottom',
      });

      setSelectedMembers([]);
      setAddMembersModalVisible(false);
    } catch (error) {
      handleError(error, 'Failed to add members');
    }
  };

  const removeMember = async (userId) => {
    const isAdmin = group?.admins.some((admin) => admin.id === user?.id);
    if (!isAdmin) {
      Toast.show({
        type: 'error',
        text1: 'Permission Denied',
        text2: 'Only admins can remove members.',
        position: 'bottom',
      });
      return;
    }

    if (!group.members.some((member) => member.id === userId)) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'User is not a member of the group.',

text2: 'User is not a member of the group.',
position: 'bottom',
      });
      return;
    }

    if (group.creator.id === userId) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Cannot remove the group owner.',
        position: 'bottom',
      });
      return;
    }

    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      await axios.post(
        `${API_URL}/groups/remove_member/${groupId}/${userId}/`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Member removed successfully',
        position: 'bottom',
      });
    } catch (error) {
      handleError(error, 'Failed to remove member');
    }
  };

  const assignAdmin = async (userId) => {
    const isOwner = group?.creator.id === user?.id;
    const isAlreadyAdmin = group?.admins.some((admin) => admin.id === userId);
    const isMember = group?.members.some((member) => member.id === userId);

    if (!isOwner) {
      Toast.show({
        type: 'error',
        text1: 'Permission Denied',
        text2: 'Only the group owner can assign admin rights.',
        position: 'bottom',
      });
      return;
    }

    if (!isMember) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'User is not a member of the group.',
        position: 'bottom',
      });
      return;
    }

    if (isAlreadyAdmin) {
      Toast.show({
        type: 'info',
        text1: 'Already Admin',
        text2: 'This user is already an admin.',
        position: 'bottom',
      });
      return;
    }

    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      await axios.post(
        `${API_URL}/groups/assign_admin/${groupId}/${userId}/`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Admin rights assigned successfully',
        position: 'bottom',
      });
    } catch (error) {
      handleError(error, 'Failed to assign admin rights');
    }
  };

  const revokeAdmin = async (userId) => {
    const isOwner = group?.creator.id === user?.id;
    const isAdmin = group?.admins.some((admin) => admin.id === userId);
    const isMember = group?.members.some((member) => member.id === userId);

    if (!isOwner) {
      Toast.show({
        type: 'error',
        text1: 'Permission Denied',
        text2: 'Only the group owner can revoke admin rights.',
        position: 'bottom',
      });
      return;
    }

    if (!isMember) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'User is not a member of the group.',
        position: 'bottom',
      });
      return;
    }

    if (!isAdmin) {
      Toast.show({
        type: 'info',
        text1: 'Not an Admin',
        text2: 'This user is not an admin.',
        position: 'bottom',
      });
      return;
    }

    if (group.creator.id === userId) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Cannot revoke admin rights from the group owner.',
        position: 'bottom',
      });
      return;
    }

    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      await axios.post(
        `${API_URL}/groups/revoke_admin/${groupId}/${userId}/`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Admin rights revoked successfully',
        position: 'bottom',
      });
    } catch (error) {
      handleError(error, 'Failed to revoke admin rights');
    }
  };

  const transferOwnership = async (userId) => {
    const isOwner = group?.creator.id === user?.id;
    const isMember = group?.members.some((member) => member.id === userId);

    if (!isOwner) {
      Toast.show({
        type: 'error',
        text1: 'Permission Denied',
        text2: 'Only the group owner can transfer ownership.',
        position: 'bottom',
      });
      return;
    }

    if (!isMember) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'User is not a member of the group.',
        position: 'bottom',
      });
      return;
    }

    if (group.creator.id === userId) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'User is already the group owner.',
        position: 'bottom',
      });
      return;
    }

    Alert.alert(
      'Transfer Ownership',
      'Are you sure you want to transfer ownership of this group? You will remain an admin.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Transfer',
          style: 'destructive',
          onPress: async () => {
            try {
              const token = await AsyncStorage.getItem('token');
              if (!token) throw new Error('No authentication token found');
              await axios.post(
                `${API_URL}/groups/transfer_ownership/${groupId}/${userId}/`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
              );
              Toast.show({
                type: 'success',
                text1: 'Success',
                text2: 'Ownership transferred successfully',
                position: 'bottom',
              });
            } catch (error) {
              handleError(error, 'Failed to transfer ownership');
            }
          },
        },
      ]
    );
  };

  const deleteGroup = async () => {
    const isOwner = group?.creator.id === user?.id;
    if (!isOwner) {
      Toast.show({
        type: 'error',
        text1: 'Permission Denied',
        text2: 'Only the group owner can delete the group.',
        position: 'bottom',
      });
      return;
    }

    Alert.alert(
      'Delete Group',
      'Are you sure you want to delete this group? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const token = await AsyncStorage.getItem('token');
              if (!token) throw new Error('No authentication token found');
              await axios.delete(`${API_URL}/groups/delete/${groupId}/`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              Toast.show({
                type: 'success',
                text1: 'Success',
                text2: 'Group deleted successfully',
                position: 'bottom',
              });
              navigation.reset({
                index: 0,
                routes: [{ name: 'Groups' }],
              });
            } catch (error) {
              handleError(error, 'Failed to delete group');
            }
          },
        },
      ]
    );
  };

  const leaveGroup = async () => {
    const isOwner = group?.creator.id === user?.id;
    if (isOwner) {
      Toast.show({
        type: 'error',
        text1: 'Permission Denied',
        text2: 'The group owner cannot leave the group.',
        position: 'bottom',
      });
      return;
    }

    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');
      await axios.post(
        `${API_URL}/groups/leave/${groupId}/`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'You have left the group.',
        position: 'bottom',
      });
      navigation.reset({
        index: 0,
        routes: [{ name: 'Groups' }],
      });
    } catch (error) {
      handleError(error, 'Failed to leave group');
    }
  };

  const pickImage = async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (event) => {
        const file = event.target.files[0];
        if (file) await updateProfilePicture(file);
      };
      input.click();
    } else {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Toast.show({
          type: 'error',
          text1: 'Permission Denied',
          text2: 'Please grant permission to access the media library.',
          position: 'bottom',
        });
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaType.images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });

      if (!result.canceled) await updateProfilePicture(result.assets[0]);
    }
  };

  const updateProfilePicture = async (fileOrAsset) => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No authentication token found');

      const formData = new FormData();

      if (Platform.OS === 'web') {
        formData.append('profile_picture', fileOrAsset, fileOrAsset.name || 'group_profile');
      } else {
        const { uri, fileName, type } = fileOrAsset;
        const fileInfo = await FileSystem.getInfoAsync(uri);
        if (!fileInfo.exists) throw new Error('Image file does not exist');

        const newUri = `${FileSystem.cacheDirectory}${fileName || 'group_profile'}`;
        await FileSystem.copyAsync({ from: uri, to: newUri });

        formData.append('profile_picture', {
          uri: newUri,
          name: fileName || 'group_profile',
          type: type || 'image/*',
        });
      }

      const response = await axios.post(
        `${API_URL}/groups/update_profile_picture/${groupId}/`,
        formData,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' } }
      );

      const updatedGroup = response.data;
      setGroup(updatedGroup);
      setGroupDetails((prev) => ({
        ...prev,
        name: updatedGroup.name,
      }));
      setProfilePictureVersion((prev) => prev + 1);
      fetchGroupProfilePicture();
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Group profile picture updated',
        position: 'bottom',
      });
    } catch (error) {
      handleError(error, 'Failed to update profile picture');
    }
  };

  const handleError = (error, defaultMessage = 'An error occurred') => {
    const errorMessage =
      error.response?.data?.error ||
      error.response?.data?.detail ||
      error.message ||
      defaultMessage;
    console.error('Error:', errorMessage);
    Toast.show({
      type: 'error',
      text1: 'Error',
      text2: errorMessage,
      position: 'bottom',
    });
  };

  useEffect(() => {
    fetchGroup();
  }, [fetchGroup]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;

      fetchGroup();
      connectWebSocket();

      return () => {
        if (ws.current) {
          ws.current.close();
          console.log('GroupInfo WebSocket disconnected');
        }
      };
    }, [fetchGroup, user])
  );

  const getAvatarUrl = (profile, firstName, username) => {
    if (!firstName && !username) {
      return 'https://ui-avatars.com/api/?name=Unknown&background=random';
    }
    if (profile?.profile_picture) {
      return profile.profile_picture;
    }
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName || username || 'Unknown')}&background=random`;
  };

  const getGroupProfilePictureUrl = () => {
    if (groupProfilePicture && !imageError) {
      return groupProfilePicture;
    }
    return null;
  };

  const renderMember = ({ item }) => {
    const profile = memberProfiles[item.id] || {};
    const isAdmin = group?.admins.some((admin) => admin.id === user?.id);
    const isOwner = group?.creator.id === user?.id;
    const isMemberAdmin = group?.admins.some((admin) => admin.id === item.id);
    const isMemberOwner = group?.creator.id === item.id;
    const isCurrentUser = item.id === user?.id;

    return (
      <TouchableOpacity
        style={tw`flex-row items-center p-3 border-b border-gray-200 bg-white rounded-lg mx-2 my-1 shadow-sm`}
        onPress={() => {
          if (item.username) navigation.navigate('FriendProfile', { username: item.username });
          else
            Toast.show({
              type: 'error',
              text1: 'Error',
              text2: 'User profile unavailable',
              position: 'bottom',
            });
        }}
      >
        <Image
          source={{ uri: getAvatarUrl(profile, item.first_name, item.username) }}
          style={tw`w-10 h-10 rounded-full mr-3`}
          accessibilityLabel={`Profile picture for ${item.first_name || item.username || 'Unknown'}`}
          onError={() => console.warn(`Failed to load avatar for ${item.username || 'unknown user'}`)}
        />
        <View style={tw`flex-1`}>
          <Text style={tw`text-lg font-semibold text-gray-800`}>{item.first_name || item.username || 'Unknown'}</Text>
          {isMemberOwner ? (
            <Text style={tw`text-sm text-blue-500`}>Owner</Text>
          ) : isMemberAdmin ? (
            <Text style={tw`text-sm text-blue-500`}>Admin</Text>
          ) : null}
          {profile.last_seen && (
            <Text style={tw`text-sm text-gray-500`}>
              {profile.is_online
                ? 'Online'
                : `Last seen: ${new Date(profile.last_seen).toLocaleString()}`}
            </Text>
          )}
        </View>
        {(isAdmin || isOwner) && !isMemberOwner && (
          <View style={tw`flex-row`}>
            {isOwner && !isMemberAdmin && (
              <TouchableOpacity onPress={() => assignAdmin(item.id)} style={tw`p-2`}>
                <Ionicons name="shield" size={20} color="green" />
              </TouchableOpacity>
            )}
            {isOwner && isMemberAdmin && (
              <TouchableOpacity onPress={() => revokeAdmin(item.id)} style={tw`p-2`}>
                <Ionicons name="shield-outline" size={20} color="orange" />
              </TouchableOpacity>
            )}
            {isOwner && (
              <LongPressGestureHandler
                onHandlerStateChange={({ nativeEvent }) => {
                  if (nativeEvent.state === State.ACTIVE) {
                    Toast.show({
                      type: 'info',
                      text1: 'Action',
                      text2: 'Transfer Ownership',
                      position: 'bottom',
                    });
                  }
                }}
              >
                <TouchableOpacity onPress={() => transferOwnership(item.id)} style={tw`p-2`}>
                  <Ionicons name="key" size={20} color="purple" />
                </TouchableOpacity>
              </LongPressGestureHandler>
            )}
            <TouchableOpacity onPress={() => removeMember(item.id)} style={tw`p-2`}>
              <Ionicons name="person-remove" size={20} color="red" />
            </TouchableOpacity>
          </View>
        )}
        {isCurrentUser && !isOwner && (
          <TouchableOpacity onPress={leaveGroup} style={tw`p-2`}>
            <Ionicons name="exit" size={20} color="gray" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const renderContact = ({ item }) => {
    const profile = contactProfiles[item.friend_id] || {};
    return (
      <TouchableOpacity
        style={tw`flex-row items-center p-4 bg-white rounded-lg mx-4 my-1 shadow-sm border-b border-gray-100`}
        onPress={() => {
          if (item.friend.user.username) navigation.navigate('FriendProfile', { username: item.friend.user.username });
          else
            Toast.show({
              type: 'error',
              text1: 'Error',
              text2: 'User profile unavailable',
              position: 'bottom',
            });
        }}
      >
        <Image
          source={{
            uri: getAvatarUrl(profile, item.friend.user.first_name, item.friend.user.username),
          }}
          style={tw`w-12 h-12 rounded-full mr-3`}
          accessibilityLabel={`Profile picture for ${item.friend.user.first_name || item.friend.user.username || 'Unknown'}`}
          onError={() => console.warn(`Failed to load avatar for ${item.friend.user.username || 'unknown user'}`)}
        />
        <View style={tw`flex-1`}>
          <Text style={tw`text-lg font-semibold text-gray-800`}>
            {item.friend.user.first_name || item.friend.user.username || 'Unknown'}
          </Text>
          {profile.last_seen && (
            <Text style={tw`text-sm text-gray-500`}>
              {profile.is_online ? 'Online' : `Last seen: ${new Date(profile.last_seen).toLocaleString()}`}
            </Text>
          )}
        </View>
        <Ionicons
          name={selectedMembers.includes(item.friend_id) ? 'checkbox' : 'square-outline'}
          size={24}
          color={selectedMembers.includes(item.friend_id) ? '#007AFF' : '#9CA3AF'}
          onPress={() => toggleMember(item.friend_id)}
        />
      </TouchableOpacity>
    );
  };

  if (!group) {
    return <ActivityIndicator size="large" color="#007AFF" style={tw`flex-1 justify-center`} />;
  }

  return (
    <View style={tw`flex-1 bg-gray-100`}>
      <View style={tw`bg-[#1a73e8] p-4 pt-10 flex-row items-center justify-between`}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <View style={tw`flex-row items-center flex-1`}>
          <TouchableOpacity
            onPress={group.admins.some((admin) => admin.id === user?.id) ? pickImage : undefined}
            disabled={!group.admins.some((admin) => admin.id === user?.id)}
            style={tw`relative w-12 h-12 rounded-full flex items-center justify-center mr-4`}
          >
            {getGroupProfilePictureUrl() ? (
              <Image
                source={{ uri: getGroupProfilePictureUrl() }}
                style={tw`w-12 h-12 rounded-full`}
                accessibilityLabel={`Profile picture for group ${group.name}`}
                onError={() => {
                  console.warn('Failed to load group profile picture');
                  setImageError(true);
                }}
                onLoad={() => setImageError(false)}
              />
            ) : (
              <View
                style={tw`w-12 h-12 rounded-full bg-white flex items-center justify-center`}
                accessibilityLabel={`Placeholder for group ${group.name}`}
              >
                <Text style={tw`text-lg font-bold text-[#1a73e8]`}>{group.name[0]?.toUpperCase() || '?'}</Text>
              </View>
            )}
            {group.admins.some((admin) => admin.id === user?.id) && (
              <View style={tw`absolute bottom-0 right-0 bg-white rounded-full p-1 border border-gray-200`}>
                <Ionicons name="camera" size={16} color="#1a73e8" />
              </View>
            )}
          </TouchableOpacity>
          <View style={tw`flex-1 ml-2`}>
            <Text style={tw`text-xl font-bold text-white`}>{group.name}</Text>
            <Text style={tw`text-sm text-white opacity-70`}>{group.members.length} members</Text>
          </View>
        </View>
        <TouchableOpacity onPress={fetchGroupDetails} style={tw`p-2`}>
          <Ionicons name="information-circle" size={24} color="white" />
        </TouchableOpacity>
      </View>

      <Modal isVisible={isModalVisible} onBackdropPress={() => setModalVisible(false)}>
        <View style={tw`bg-white p-5 rounded-lg`}>
          <Text style={tw`text-xl font-bold mb-3 text-gray-900`}>Group Details</Text>
          {groupDetails && (
            <View>
              <Text style={tw`text-base text-gray-800 mb-2`}>Name: {groupDetails.name}</Text>
              <Text style={tw`text-base text-gray-800 mb-2`}>
                Created At: {new Date(groupDetails.created_at).toLocaleString()}
              </Text>
              <Text style={tw`text-base text-gray-800 mb-2`}>Total Members: {groupDetails.total_members}</Text>
              <Text style={tw`text-base text-gray-800 mb-2`}>Total Messages: {groupDetails.total_messages}</Text>
              <Text style={tw`text-base text-gray-800 mb-2`}>Owner:</Text>
              <View style={tw`flex-row items-center mb-2`}>
                <Image
                  source={{
                    uri: getAvatarUrl(
                      memberProfiles[groupDetails.creator.id],
                      groupDetails.creator.first_name,
                      groupDetails.creator.username
                    ),
                  }}
                  style={tw`w-10 h-10 rounded-full mr-3`}
                  accessibilityLabel={`Profile picture for ${groupDetails.creator.first_name || groupDetails.creator.username || 'Unknown'}`}
                  onError={() => console.warn('Failed to load creator avatar')}
                />
                <View>
                  <Text style={tw`text-base text-gray-800`}>
                    {groupDetails.creator.first_name || 'Unknown'} (@{groupDetails.creator.username || 'unknown'})
                  </Text>
                  <Text style={tw`text-sm text-gray-500`}>
                    {memberProfiles[groupDetails.creator.id]?.is_online ? 'Online' : 'Offline imaginative'}
                  </Text>
                </View>
              </View>
              <Text style={tw`text-base text-gray-800 mb-2`}>Admins:</Text>
              {groupDetails.admins.map((admin) => (
                <View key={admin.id} style={tw`flex-row items-center mb-2 ml-2`}>
                  <Image
                    source={{
                      uri: getAvatarUrl(
                        memberProfiles[admin.id],
                        admin.first_name,
                        admin.username
                      ),
                    }}
                    style={tw`w-8 h-8 rounded-full mr-2`}
                    accessibilityLabel={`Profile picture for ${admin.first_name || admin.username || 'Unknown'}`}
                    onError={() => console.warn('Failed to load admin avatar')}
                  />
                  <Text style={tw`text-base text-gray-800`}>
                    {admin.first_name || 'Unknown'} (@{admin.username || 'unknown'})
                    {admin.id === groupDetails.creator.id ? ' (Owner)' : ''}
                  </Text>
                </View>
              ))}
              {groupProfilePicture && !imageError ? (
                <View style={tw`mt-2`}>
                  <Text style={tw`text-base text-gray-800 mb-1`}>Profile Picture:</Text>
                  <Image
                    source={{ uri: groupProfilePicture }}
                    style={tw`w-20 h-20 rounded-lg`}
                    accessibilityLabel={`Profile picture for group ${groupDetails.name}`}
                    onError={() => {
                      console.warn('Failed to load group profile picture in modal');
                      setImageError(true);
                    }}
                    onLoad={() => setImageError(false)}
                  />
                </View>
              ) : (
                <View style={tw`mt-2`}>
                  <Text style={tw`text-base text-gray-800 mb-1`}>Profile Picture:</Text>
                  <View
                    style={tw`w-20 h-20 rounded-lg bg-white flex items-center justify-center`}
                    accessibilityLabel={`Placeholder for group ${groupDetails.name}`}
                  >
                    <Text style={tw`text-lg font-bold text-[#1a73e8]`}>{groupDetails.name[0]?.toUpperCase() || '?'}</Text>
                  </View>
                </View>
              )}
              {groupDetails.creator.id === user?.id && (
                <TouchableOpacity
                  onPress={deleteGroup}
                  style={tw`mt-5 p-2 bg-red-500 rounded-lg`}
                >
                  <Text style={tw`text-white text-center font-semibold`}>Delete Group</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          <TouchableOpacity
            onPress={() => setModalVisible(false)}
            style={tw`mt-5 p-2 bg-blue-500 rounded-lg`}
          >
            <Text style={tw`text-white text-center font-semibold`}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal
        isVisible={isAddMembersModalVisible}
        onBackdropPress={() => {
          setAddMembersModalVisible(false);
          setSelectedMembers([]);
        }}
      >
        <View style={tw`bg-white p-5 rounded-lg max-h-3/4`}>
          <Text style={tw`text-xl font-bold mb-3 text-gray-900`}>Add New Members</Text>
          {loadingContacts ? (
            <ActivityIndicator size="large" color="#007AFF" style={tw`my-4`} />
          ) : (
            <FlatList
              data={contacts}
              renderItem={renderContact}
              keyExtractor={(item) => item.friend_id.toString()}
              ListEmptyComponent={
                <Text style={tw`text-center mt-5 text-gray-500`}>No contacts available to add</Text>
              }
              contentContainerStyle={tw`pb-4`}
            />
          )}
          <TouchableOpacity
            onPress={addMembersToGroup}
            style={tw`mt-5 p-2 bg-blue-500 rounded-lg`}
            disabled={loadingContacts || selectedMembers.length === 0}
          >
            <Text style={tw`text-white text-center font-semibold`}>Add Members</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setAddMembersModalVisible(false);
              setSelectedMembers([]);
            }}
            style={tw`mt-2 p-2 bg-gray-300 rounded-lg`}
          >
            <Text style={tw`text-gray-800 text-center font-semibold`}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <View style={tw`p-4 bg-white mb-2 shadow-sm`}>
        <TouchableOpacity
          style={tw`flex-row items-center p-2 bg-gray-100 rounded-lg`}
          onPress={() => {
            if (group.admins.some((admin) => admin.id === user?.id)) {
              fetchContacts();
              setAddMembersModalVisible(true);
            } else {
              Toast.show({
                type: 'error',
                text1: 'Permission Denied',
                text2: 'Only admins can add members.',
                position: 'bottom',
              });
            }
          }}
        >
          <Ionicons name="person-add" size={24} color="#1a73e8" style={tw`mr-3`} />
          <Text style={tw`text-lg text-gray-800`}>Add Members</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={group.members}
        renderItem={renderMember}
        keyExtractor={(item) => item.id.toString()}
        extraData={group}
        contentContainerStyle={tw`pb-20`}
        ListEmptyComponent={<Text style={tw`text-center mt-5 text-gray-500`}>No members found</Text>}
      />
    </View>
  );
};

export default GroupInfo;