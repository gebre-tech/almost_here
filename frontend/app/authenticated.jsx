import React, { useContext, useEffect } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AuthContext } from "../context/AuthContext";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation } from "@react-navigation/native";
import Login from "./(auth)/login";
import Home from "./(tabs)/BottomTabs";
import Signup from "./(auth)/signup";
import BottomTabs from "./(tabs)/BottomTabs";
import RootNavigator from "./(tabs)/RootNavigator";

const Stack = createNativeStackNavigator();

const Authenticated = () => {
  const { user, loading } = useContext(AuthContext);
  const navigation = useNavigation();

;

  if (loading) return null;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <Stack.Screen name="Home" component={RootNavigator} />
      ) : (
        <>
          <Stack.Screen name="Login" component={Login} />
          <Stack.Screen name="Signup" component={Signup} />
        </>
      )}
    </Stack.Navigator>
  );
};

export default Authenticated;