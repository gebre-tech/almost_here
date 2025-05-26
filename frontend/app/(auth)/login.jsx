import React, { useState, useContext } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, Alert } from 'react-native';
import { AuthContext } from '../../context/AuthContext';
import axios from 'axios';
import { API_URL } from '../utils/constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const Login = ({ navigation }) => {
  const { login, loading, error, keys } = useContext(AuthContext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [forgotModalVisible, setForgotModalVisible] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  // Email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // Password validation: min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

  const validateInputs = (email, password) => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      return { isValid: false, message: 'Email is required.' };
    }
    if (!emailRegex.test(trimmedEmail)) {
      return { isValid: false, message: 'Please enter a valid email address.' };
    }
    if (!password) {
      return { isValid: false, message: 'Password is required.' };
    }
    if (!passwordRegex.test(password)) {
      return {
        isValid: false,
        message: 'Password must be at least 8 characters long and include at least one uppercase letter, one lowercase letter, one number, and one special character.',
      };
    }
    return { isValid: true, trimmedEmail };
  };

  const validateForgotEmail = (email) => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      return { isValid: false, message: 'Email is required.' };
    }
    if (!emailRegex.test(trimmedEmail)) {
      return { isValid: false, message: 'Please enter a valid email address.' };
    }
    return { isValid: true, trimmedEmail };
  };

  const handleLogin = async () => {
    const validation = validateInputs(email, password);
    if (!validation.isValid) {
      Alert.alert('Error', validation.message);
      return;
    }

    const success = await login(validation.trimmedEmail, password);
    if (success) {
      const [privateKey, publicKey] = await Promise.all([
        AsyncStorage.getItem(`private_key_${validation.trimmedEmail}`),
        AsyncStorage.getItem(`public_key_${validation.trimmedEmail}`),
      ]);

      if (!publicKey || !privateKey) {
        Alert.alert('Warning', 'Keys not found on this device. You may need to transfer your private key.');
      } else {
        console.log('Retrieved Public Key:', publicKey);
        console.log('Retrieved Private Key:', privateKey);
      }

      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    }
  };

  const handleForgotPassword = async () => {
    const validation = validateForgotEmail(forgotEmail);
    if (!validation.isValid) {
      Alert.alert('Error', validation.message);
      return;
    }

    setForgotLoading(true);
    try {
      const response = await axios.post(`${API_URL}/auth/forgot-password/`, { email: validation.trimmedEmail });
      Alert.alert('Success', response.data.message);
      setForgotModalVisible(false);
      setForgotEmail('');
    } catch (error) {
      const errorMessage = error.response?.data?.error || 'Failed to send reset email.';
      Alert.alert('Error', errorMessage);
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={['#008000', '#FFD700', '#FF0000']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <View style={styles.innerContainer}>
        <Text style={styles.title}>Welcome Back</Text>
        {error && <Text style={styles.error}>{error}</Text>}
        <TextInput
          style={styles.input}
          placeholder='Email'
          value={email}
          onChangeText={setEmail}
          keyboardType='email-address'
          autoCapitalize='none'
        />
        <View style={styles.passwordContainer}>
          <TextInput
            style={styles.passwordInput}
            placeholder='Password'
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
          />
          <TouchableOpacity
            style={styles.eyeIcon}
            onPress={() => setShowPassword(!showPassword)}
          >
            <MaterialCommunityIcons
              name={showPassword ? 'eye-off' : 'eye'}
              size={24}
              color='#666'
            />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color='#fff' />
          ) : (
            <Text style={styles.buttonText}>Login</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setForgotModalVisible(true)}>
          <Text style={styles.link}>Forgot Password?</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
          <Text style={styles.link}>Create an account</Text>
        </TouchableOpacity>

        <Modal visible={forgotModalVisible} animationType='slide' transparent>
          <View style={styles.modalContainer}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Reset Password</Text>
              <TextInput
                style={styles.input}
                placeholder='Enter your email'
                value={forgotEmail}
                onChangeText={setForgotEmail}
                keyboardType='email-address'
                autoCapitalize='none'
              />
              <TouchableOpacity
                style={[styles.button, forgotLoading && styles.buttonDisabled]}
                onPress={handleForgotPassword}
                disabled={forgotLoading}
              >
                {forgotLoading ? (
                  <ActivityIndicator color='#fff' />
                ) : (
                  <Text style={styles.buttonText}>Send Reset Email</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setForgotModalVisible(false)}>
                <Text style={styles.link}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  innerContainer: { flex: 1, justifyContent: 'center', padding: 20 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#333', marginBottom: 30, textAlign: 'center' },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 15, marginBottom: 15, borderWidth: 1, borderColor: '#ddd' },
  passwordContainer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#fff', 
    borderRadius: 8, 
    marginBottom: 15, 
    borderWidth: 1, 
    borderColor: '#ddd' 
  },
  passwordInput: { 
    flex: 1, 
    padding: 15 
  },
  eyeIcon: { 
    padding: 10 
  },
  button: { backgroundColor: '#007AFF', padding: 15, borderRadius: 8, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#99ccff' },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  error: { color: '#ff4d4d', marginBottom: 15, textAlign: 'center' },
  link: {
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: 20,
    fontSize: 18,
    fontWeight: '600',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  modalContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { backgroundColor: '#fff', padding: 20, borderRadius: 10, width: '80%', alignItems: 'center' },
  modalTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, color: '#333' },
});

export default Login;