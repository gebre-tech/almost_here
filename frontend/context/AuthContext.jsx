import React, { createContext, useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import { API_URL } from "../app/utils/constants";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [keys, setKeys] = useState({ publicKey: '', privateKey: '' });
  const [accessToken, setAccessToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    try {
      const [token, refresh] = await Promise.all([
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("refresh"),
      ]);
      if (!token) {
        setLoading(false);
        return;
      }

      setAccessToken(token);
      setRefreshToken(refresh);

      const res = await axios.get(`${API_URL}/auth/profile/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUser(res.data);

      const email = res.data.email;
      const [privateKey, publicKey] = await Promise.all([
        AsyncStorage.getItem(`private_key_${email}`),
        AsyncStorage.getItem(`public_key_${email}`),
      ]);
      if (privateKey && publicKey) {
        setKeys({ publicKey, privateKey });
        console.log('Successfully get and set Private Key:', privateKey);
        console.log('Successfully get and set Public Key:', publicKey);
      } else {
        setError("Keys not found on this device. You may need to transfer your private key.");
      }
    } catch (error) {
      console.log("Auth check failed:", error);
      setUser(null);
      setKeys({ publicKey: '', privateKey: '' });
      setAccessToken(null);
      setRefreshToken(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post(`${API_URL}/auth/login/`, { email, password });
      await AsyncStorage.setItem("token", res.data.access);
      await AsyncStorage.setItem("refresh", res.data.refresh); // Store refresh token
      await AsyncStorage.setItem("user_email", res.data.user.email);
      await AsyncStorage.setItem("user_id", res.data.user.id.toString());
      setAccessToken(res.data.access);
      setRefreshToken(res.data.refresh);
      setUser(res.data.user);

      const [privateKey, publicKey] = await Promise.all([
        AsyncStorage.getItem(`private_key_${email}`),
        AsyncStorage.getItem(`public_key_${email}`),
      ]);
      console.log('Retrieved Private Key:', privateKey);
      console.log('Retrieved Public Key:', publicKey);

      if (privateKey && publicKey) {
        setKeys({ publicKey, privateKey });
        console.log('Successfully set Private Key:', privateKey);
        console.log('Successfully set Public Key:', publicKey);
      } else {
        setError("Keys not found on this device. You may need to transfer your private key.");
      }

      return true;
    } catch (error) {
      setError(error.response?.data?.detail || "Invalid credentials");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const refreshAccessToken = async () => {
    try {
          const refresh = await AsyncStorage.getItem("refresh");
          if (!refresh) {
              throw new Error("No refresh token available");
          }
          const res = await axios.post(`${API_URL}/auth/token/refresh/`, { refresh });
          const newAccessToken = res.data.access;
          await AsyncStorage.setItem("token", newAccessToken);
          setAccessToken(newAccessToken);
          console.log("Successfully refreshed access token");
          return newAccessToken;
      } catch (error) {
          console.error("Token refresh failed:", error);
          setError("Session expired. Please log in again.");
          setUser(null);
          setAccessToken(null);
          setRefreshToken(null);
          await AsyncStorage.multiRemove(["token", "refresh", "user_email", "user_id"]);
          return null;
      }
  };

  const logout = async () => {
    setLoading(true);
    try {
      const token = await AsyncStorage.getItem("token");
      if (token) {
        try {
          await axios.post(
            `${API_URL}/auth/logout/`,
            { refresh: await AsyncStorage.getItem("refresh") },
            { headers: { Authorization: `Bearer ${token}` } }
          );
        } catch (serverError) {
          console.log("Server logout failed, proceeding with client cleanup:", serverError);
        }
      }

      await AsyncStorage.multiRemove([
        "token",
        "refresh",
        "username",
        "email",
        "profileImage",
        "user_email",
        "user_id",
      ]);
      setUser(null);
      setKeys({ publicKey: '', privateKey: '' });
      setAccessToken(null);
      setRefreshToken(null);
      return true;
    } catch (error) {
      console.log("Logout error:", error);
      setError("Failed to log out completely");
      return false;
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, keys, accessToken, refreshToken: refreshAccessToken, login, logout, loading, error }}>
      {children}
    </AuthContext.Provider>
  );
};

export { AuthContext };