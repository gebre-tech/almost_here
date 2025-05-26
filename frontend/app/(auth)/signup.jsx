import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import axios from 'axios';
import { API_URL } from '../utils/constants';
import { Buffer } from 'buffer';
import { x25519 } from '@noble/curves/ed25519';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';

async function generateKeyPair() {
  const privateKey = Buffer.from(x25519.utils.randomPrivateKey());
  const publicKey = Buffer.from(x25519.getPublicKey(privateKey));
  return { privateKey, publicKey };
}

const Signup = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  const nameRegex = /^[a-zA-Z\s-]{1,50}$/;
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

  const validateInputs = (email, username, firstName, lastName, password, confirmPassword) => {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedUsername = username.trim();
    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();

    if (!trimmedEmail) {
      return { isValid: false, message: 'Email is required.' };
    }
    if (!emailRegex.test(trimmedEmail)) {
      return { isValid: false, message: 'Please enter a valid email address.' };
    }
    if (!trimmedUsername) {
      return { isValid: false, message: 'Username is required.' };
    }
    if (!usernameRegex.test(trimmedUsername)) {
      return {
        isValid: false,
        message: 'Username must be 3-20 characters long and contain only letters, numbers, or underscores.',
      };
    }
    if (!trimmedFirstName) {
      return { isValid: false, message: 'First name is required.' };
    }
    if (!nameRegex.test(trimmedFirstName)) {
      return {
        isValid: false,
        message: 'First name must contain only letters, spaces, or hyphens and be 1-50 characters long.',
      };
    }
    if (!trimmedLastName) {
      return { isValid: false, message: 'Last name is required.' };
    }
    if (!nameRegex.test(trimmedLastName)) {
      return {
        isValid: false,
        message: 'Last name must contain only letters, spaces, or hyphens and be 1-50 characters long.',
      };
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
    if (!confirmPassword) {
      return { isValid: false, message: 'Confirm password is required.' };
    }
    if (password !== confirmPassword) {
      return { isValid: false, message: 'Passwords do not match.' };
    }
    return {
      isValid: true,
      trimmedEmail,
      trimmedUsername,
      trimmedFirstName,
      trimmedLastName,
    };
  };

  const handleSignup = async () => {
    const validation = validateInputs(email, username, firstName, lastName, password, confirmPassword);
    if (!validation.isValid) {
      setError(validation.message);
      Alert.alert('Error', validation.message);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { privateKey, publicKey } = await generateKeyPair();
      const publicKeyHex = publicKey.toString('hex');
      const privateKeyHex = privateKey.toString('hex');

      await Promise.all([
        AsyncStorage.setItem(`private_key_${validation.trimmedEmail}`, privateKeyHex),
        AsyncStorage.setItem(`public_key_${validation.trimmedEmail}`, publicKeyHex),
      ]);

      const [storedPrivateKey, storedPublicKey] = await Promise.all([
        AsyncStorage.getItem(`private_key_${validation.trimmedEmail}`),
        AsyncStorage.getItem(`public_key_${validation.trimmedEmail}`),
      ]);

      if (!storedPrivateKey || !storedPublicKey) {
        throw new Error('Failed to store keys in AsyncStorage');
      }

      console.log('Stored Private Key:', storedPrivateKey);
      console.log('Stored Public Key:', storedPublicKey);

      const response = await axios.post(`${API_URL}/auth/register/`, {
        username: validation.trimmedUsername,
        email: validation.trimmedEmail,
        first_name: validation.trimmedFirstName,
        last_name: validation.trimmedLastName,
        password,
        password2: confirmPassword,
        public_key: publicKeyHex,
      });

      if (response.status === 201) {
        Alert.alert('Success', 'Account created! Please log in.');
        navigation.navigate('Login');
      }
    } catch (error) {
      console.log('Signup error:', error);
      await Promise.all([
        AsyncStorage.removeItem(`private_key_${validation.trimmedEmail}`),
        AsyncStorage.removeItem(`public_key_${validation.trimmedEmail}`),
      ]);
      if (error.response?.data) {
        const errorData = error.response.data;
        if (typeof errorData === 'object') {
          const errorMessages = Object.values(errorData).flat().join('\n');
          setError(errorMessages);
          Alert.alert('Signup Failed', errorMessages);
        } else if (errorData.detail) {
          setError(errorData.detail);
          Alert.alert('Signup Failed', errorData.detail);
        }
      } else {
        setError('Signup failed. Please try again.');
        Alert.alert('Signup Failed', 'Signup failed. Please try again.');
      }
    } finally {
      setLoading(false);
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
        <Text style={styles.title}>Sign Up</Text>
        {error && <Text style={styles.error}>{error}</Text>}
        <TextInput
          style={styles.input}
          placeholder="Username *"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="First Name *"
          value={firstName}
          onChangeText={setFirstName}
        />
        <TextInput
          style={styles.input}
          placeholder="Last Name *"
          value={lastName}
          onChangeText={setLastName}
        />
        <TextInput
          style={styles.input}
          placeholder="Email *"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <View style={styles.passwordContainer}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Password *"
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
        <View style={styles.passwordContainer}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Confirm Password *"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={!showConfirmPassword}
          />
          <TouchableOpacity
            style={styles.eyeIcon}
            onPress={() => setShowConfirmPassword(!showConfirmPassword)}
          >
            <MaterialCommunityIcons
              name={showConfirmPassword ? 'eye-off' : 'eye'}
              size={24}
              color='#666'
            />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignup}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign Up</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Login')}>
          <Text style={styles.signupLink}>Already have an account? Log in</Text>
        </TouchableOpacity>
        <Text style={styles.note}>* Required fields</Text>
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  innerContainer: { flex: 1, justifyContent: 'center', padding: 20 },
  title: { fontSize: 32, fontWeight: 'bold', marginBottom: 20, textAlign: 'center', color: '#333' },
  input: { borderWidth: 1, padding: 15, marginBottom: 15, borderRadius: 8, borderColor: '#ddd', backgroundColor: '#fff' },
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
  error: { color: 'red', marginBottom: 15, textAlign: 'center' },
  button: { backgroundColor: '#007AFF', padding: 15, borderRadius: 8, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#99ccff' },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  signupLink: {
    marginTop: 20,
    color: '#FFFFFF',
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '600',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  note: {
    marginTop: 10,
    color: '#FFFFFF',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
});

export default Signup;