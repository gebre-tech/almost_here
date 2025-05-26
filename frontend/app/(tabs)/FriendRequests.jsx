// app/tabs/FriendRequests.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { API_URL, API_HOST } from '../utils/constants';

const FriendRequests = () => {
  const navigation = useNavigation();
  const [receivedRequests, setReceivedRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ws, setWs] = useState(null);

  const fetchReceivedRequests = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      const response = await axios.get(`${API_URL}/contacts/requests/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setReceivedRequests(response.data || []);
    } catch (err) {
      console.error('Error fetching received requests:', err);
    }
  }, []);

  const fetchSentRequests = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      const response = await axios.get(`${API_URL}/contacts/sent_requests/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSentRequests(response.data || []);
    } catch (err) {
      console.error('Error fetching sent requests:', err);
    }
  }, []);

  const fetchAllRequests = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchReceivedRequests(), fetchSentRequests()]);
    setLoading(false);
  }, [fetchReceivedRequests, fetchSentRequests]);

  const setupWebSocket = useCallback(async () => {
    const token = await AsyncStorage.getItem('token');
    if (!token) return;

    const websocket = new WebSocket(`ws://${API_HOST}/ws/contacts/?token=${token}`);

    websocket.onopen = () => console.log('WebSocket connected for FriendRequests');
    websocket.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'friend_request_received') {
        setReceivedRequests((prev) => {
          const exists = prev.some((req) => req.id === data.request.id);
          if (exists) return prev;
          return [...prev, data.request];
        });
      } else if (data.type === 'friend_request_accepted') {
        setReceivedRequests((prev) => prev.filter((req) => req.id !== data.requestId));
        setSentRequests((prev) => prev.filter((req) => req.id !== data.requestId));
        
      } else if (data.type === 'friend_request_rejected') {
        setReceivedRequests((prev) => prev.filter((req) => req.id !== data.requestId));
        setSentRequests((prev) => prev.filter((req) => req.id !== data.requestId));
      } else if (data.type === 'friend_request_sent') {
        setSentRequests((prev) => {
          const exists = prev.some((req) => req.id === data.request.id);
          if (exists) return prev;
          return [...prev, data.request];
        });
      }
    };
    websocket.onerror = (e) => console.error('WebSocket error:', e);
    websocket.onclose = () => console.log('WebSocket disconnected');

    setWs(websocket);
    return () => websocket.close();
  }, [navigation]);

  const handleAcceptRequest = async (requestId) => {
    try {
      const token = await AsyncStorage.getItem('token');
      await axios.post(
        `${API_URL}/contacts/accept/${requestId}/`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setReceivedRequests((prev) => prev.filter((req) => req.id !== requestId));
      if (ws) {
        ws.send(JSON.stringify({ type: 'friend_request_accepted', requestId }));
      }
    } catch (error) {
      console.error('Error accepting request:', error);
    }
  };

  const handleRejectRequest = async (requestId) => {
    try {
      const token = await AsyncStorage.getItem('token');
      await axios.post(
        `${API_URL}/contacts/reject/${requestId}/`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setReceivedRequests((prev) => prev.filter((req) => req.id !== requestId));
      if (ws) {
        ws.send(JSON.stringify({ type: 'friend_request_rejected', requestId }));
      }
    } catch (error) {
      console.error('Error rejecting request:', error);
    }
  };

  const clearNotifications = () => {
    setReceivedRequests([]);
    setSentRequests([]);
  };

  useEffect(() => {
    fetchAllRequests();
    setupWebSocket();
  }, [fetchAllRequests, setupWebSocket]);

  const renderReceivedRequest = ({ item }) => (
    <View style={styles.requestItem}>
      <Text style={styles.requestText}>{item.sender.username} wants to be your friend</Text>
      <View style={styles.requestButtons}>
        <TouchableOpacity style={styles.acceptButton} onPress={() => handleAcceptRequest(item.id)}>
          <Text style={styles.buttonText}>Accept</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.rejectButton} onPress={() => handleRejectRequest(item.id)}>
          <Text style={styles.buttonText}>Reject</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderSentRequest = ({ item }) => (
    <View style={styles.requestItem}>
      <Text style={styles.requestText}>Request sent to {item.receiver.username}</Text>
    </View>
  );

  if (loading) return <ActivityIndicator size="large" color="#007bff" />;

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.clearButton} onPress={clearNotifications}>
        <Text style={styles.clearButtonText}>Clear Notifications</Text>
      </TouchableOpacity>
      {receivedRequests.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Received Requests</Text>
          <FlatList
            data={receivedRequests}
            renderItem={renderReceivedRequest}
            keyExtractor={(item) => `received-${item.id}`}
          />
        </>
      )}
      {sentRequests.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Sent Requests</Text>
          <FlatList
            data={sentRequests}
            renderItem={renderSentRequest}
            keyExtractor={(item) => `sent-${item.id}`}
          />
        </>
      )}
      {receivedRequests.length === 0 && sentRequests.length === 0 && (
        <Text style={styles.emptyText}>No pending friend requests</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  requestItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, backgroundColor: '#fff', borderRadius: 8, marginBottom: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  requestText: { fontSize: 16, color: '#333' },
  requestButtons: { flexDirection: 'row' },
  acceptButton: { backgroundColor: '#28a745', padding: 10, borderRadius: 6, marginRight: 8 },
  rejectButton: { backgroundColor: '#dc3545', padding: 10, borderRadius: 6 },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  emptyText: { fontSize: 16, color: '#666', textAlign: 'center', marginTop: 20 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#333', marginVertical: 10 },
  clearButton: { backgroundColor: '#007bff', padding: 10, borderRadius: 8, alignItems: 'center', marginBottom: 20 },
  clearButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

export default FriendRequests;