import * as Crypto from 'expo-crypto';
import { Buffer } from 'buffer';
import aesjs from 'aes-js';
import { x25519 } from '@noble/curves/ed25519';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../utils/constants';

export const checkAESSupport = () => {
  const aesExists = !!Crypto.CryptoEncryptionAlgorithm?.AES256CBC;
  return aesExists;
};

export async function fetchReceiverPublicKey(receiverId, token, retries = 3, delay = 1000) {
  while (retries > 0) {
    try {
      const response = await fetch(`${API_URL}/auth/user/${receiverId}/public_key/`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (response.ok && data.public_key && /^[0-9a-f]{64}$/i.test(data.public_key)) {
        console.log(`(NOBRIDGE) Successfully fetched receiver public key for ID: ${receiverId}`);
        return data.public_key;
      }
      throw new Error(`Invalid public key response: ${JSON.stringify(data)}`);
    } catch (error) {
      retries -= 1;
      console.error(`(NOBRIDGE) ERROR Fetch receiver public key (attempts left: ${retries}):`, error);
      if (retries === 0) return null;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return null;
}

export class NoiseNN {
  constructor(senderId, receiverId, token, email) {
    this.senderId = senderId;
    this.receiverId = receiverId;
    this.token = token;
    this.email = email;
    this.baseKeyPair = null;
    this.remoteBasePublicKey = null;
    this.baseSharedSecret = null;
    this.handshakeFinished = false;
  }

  async initialize(retries = 3) {
    while (retries > 0) {
      try {
        const [privateKeyHex, publicKeyHex] = await Promise.all([
          AsyncStorage.getItem(`private_key_${this.email}`),
          AsyncStorage.getItem(`public_key_${this.email}`),
        ]);

        if (!privateKeyHex || !publicKeyHex || !this.isValidKeyPair(privateKeyHex, publicKeyHex)) {
          console.log('(NOBRIDGE) Generating new key pair due to invalid or missing keys');
          const newKeyPair = await this.generateKeyPair();
          await Promise.all([
            AsyncStorage.setItem(`private_key_${this.email}`, newKeyPair.privateKey.toString('hex')),
            AsyncStorage.setItem(`public_key_${this.email}`, newKeyPair.publicKey.toString('hex')),
          ]);
          await this.syncPublicKeyWithServer(newKeyPair.publicKey.toString('hex'));
          this.baseKeyPair = newKeyPair;
        } else {
          this.baseKeyPair = {
            privateKey: Buffer.from(privateKeyHex, 'hex'),
            publicKey: Buffer.from(publicKeyHex, 'hex'),
          };
        }

        const receiverPublicKeyHex = await fetchReceiverPublicKey(this.receiverId, this.token);
        if (!receiverPublicKeyHex || !this.isValidPublicKey(receiverPublicKeyHex)) {
          throw new Error('Failed to fetch valid receiver public key');
        }

        await AsyncStorage.setItem(`receiver_public_key_${this.receiverId}`, receiverPublicKeyHex);
        this.remoteBasePublicKey = Buffer.from(receiverPublicKeyHex, 'hex');
        const rawSharedSecret = x25519.scalarMult(this.baseKeyPair.privateKey, this.remoteBasePublicKey);
        this.baseSharedSecret = Buffer.from(rawSharedSecret.slice(0, 32));
        this.handshakeFinished = true;
        console.log(`(NOBRIDGE) NoiseNN handshake completed for sender: ${this.senderId}, receiver: ${this.receiverId}`);
        return;
      } catch (error) {
        retries -= 1;
        console.error(`(NOBRIDGE) ERROR NoiseNN initialization failed (attempts left: ${retries}):`, error);
        if (retries === 0) {
          throw new Error(`NoiseNN initialization failed after retries: ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  async generateKeyPair() {
    const privateKey = Buffer.from(x25519.utils.randomPrivateKey());
    const publicKey = Buffer.from(x25519.getPublicKey(privateKey));
    return { privateKey, publicKey };
  }

  isValidPublicKey(publicKeyHex) {
    try {
      const publicKey = Buffer.from(publicKeyHex, 'hex');
      return publicKey.length === 32 && /^[0-9a-f]{64}$/i.test(publicKeyHex);
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Invalid public key format:', error);
      return false;
    }
  }

  isValidKeyPair(privateKeyHex, publicKeyHex) {
    try {
      const privateKey = Buffer.from(privateKeyHex, 'hex');
      const publicKey = Buffer.from(publicKeyHex, 'hex');
      const computedPublicKey = Buffer.from(x25519.getPublicKey(privateKey));
      return privateKey.length === 32 && publicKey.length === 32 && computedPublicKey.equals(publicKey);
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Invalid key pair:', error);
      return false;
    }
  }

  async syncPublicKeyWithServer(publicKeyHex) {
    try {
      const response = await fetch(`${API_URL}/auth/user/update_public_key/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
        },
        body: JSON.stringify({ public_key: publicKeyHex }),
      });
      if (!response.ok) {
        console.error('(NOBRIDGE) ERROR Failed to sync public key:', await response.json());
      } else {
        console.log('(NOBRIDGE) Successfully synced public key with server');
      }
    } catch (error) {
      console.error('(NOBRIDGE) ERROR Sync public key error:', error);
    }
  }

  async generateMessageKey(remoteEphemeralPublicKey = null, retries = 2) {
    while (retries > 0) {
      try {
        if (!this.handshakeFinished) {
          throw new Error('Handshake not completed');
        }

        const ephemeralKeyPair = remoteEphemeralPublicKey ? null : await this.generateKeyPair();
        const ephPubKey = remoteEphemeralPublicKey
          ? Buffer.from(remoteEphemeralPublicKey, 'hex')
          : ephemeralKeyPair.publicKey;

        if (!ephPubKey || ephPubKey.length !== 32) {
          throw  new Error('Invalid ephemeral public key');
        }

        const ephSharedSecret = remoteEphemeralPublicKey
          ? x25519.scalarMult(this.baseKeyPair.privateKey, ephPubKey)
          : x25519.scalarMult(ephemeralKeyPair.privateKey, this.remoteBasePublicKey);

        const combinedSecret = Buffer.concat([this.baseSharedSecret, Buffer.from(ephSharedSecret)]);
        const key = Buffer.from(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, combinedSecret)).slice(0, 32);

        console.log(`(NOBRIDGE) Generated message key for ${remoteEphemeralPublicKey ? 'decryption' : 'encryption'}`);
        return {
          key,
          publicKey: remoteEphemeralPublicKey ? null : ephemeralKeyPair.publicKey,
        };
      } catch (error) {
        retries -= 1;
        console.error(`(NOBRIDGE) ERROR Generating message key (attempts left: ${retries}):`, error);
        if (retries === 0) {
          throw new Error(`Failed to generate message key: ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    throw new Error('Failed to generate message key after retries');
  }
}