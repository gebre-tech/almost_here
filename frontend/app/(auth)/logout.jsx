import React, { useContext } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { AuthContext } from "../../context/AuthContext";
import { MaterialCommunityIcons } from '@expo/vector-icons';

const LogoutScreen = ({ navigation }) => {
  const { logout, loading } = useContext(AuthContext);

  const handleLogout = async () => {
    await logout(navigation);
  };

  return (
    <View style={styles.container}>
      <MaterialCommunityIcons name="logout" size={48} color="#ff4444" style={styles.icon} />
      <Text style={styles.title}>Are you sure you want to log out?</Text>
      
      <TouchableOpacity 
        onPress={handleLogout} 
        style={[styles.button, loading && styles.buttonDisabled]}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <View style={styles.buttonContent}>
            <MaterialCommunityIcons name="exit-to-app" size={24} color="#fff" />
            <Text style={styles.buttonText}>Yes, Logout</Text>
          </View>
        )}
      </TouchableOpacity>

      <TouchableOpacity 
        style={styles.cancelButton}
        onPress={() => navigation.goBack()}
      >
        <MaterialCommunityIcons name="arrow-left" size={24} color="#007AFF" />
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    padding: 20,
  },
  icon: {
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
    marginBottom: 30,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#ff4444",
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '80%',
  },
  buttonDisabled: {
    backgroundColor: "#ff9999",
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
    marginLeft: 10,
  },
  cancelButton: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cancelText: {
    color: "#007AFF",
    fontSize: 16,
    marginLeft: 10,
  },
});

export default LogoutScreen;