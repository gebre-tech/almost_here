// app/(tabs)/chatStack.jsx
import React from "react";
import { createStackNavigator } from "@react-navigation/stack";
import { Ionicons } from "@expo/vector-icons";
import ChatList from "./ChatList";
import ChatScreen from "./chatScreen";
import FriendProfile from "./FriendProfile";
import Contacts from "./Contacts";
import { LinearGradient } from 'expo-linear-gradient';
const Stack = createStackNavigator();

export default function ChatStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { 
          backgroundColor: "#fff", 
          elevation: 0, 
          shadowOpacity: 0,
          borderBottomWidth: 0 
        },
        headerTintColor: "#333",
        headerTitleStyle: { 
          fontSize: 18, 
          fontWeight: "600" 
        },
        headerBackTitleVisible: false,
        headerBackImage: ({ tintColor }) => (
          <Ionicons name="arrow-back" size={24} color={tintColor} style={{ marginLeft: 10 }} />
        ),
      }}
    >
      <Stack.Screen 
        name="ChatList" 
        component={ChatList} 
        options={{ 
          headerShown: true,
          title: "Innbox Chat",
        }} 
      />
      <Stack.Screen
        name="ChatScreen"
        component={ChatScreen}
        options={{
          tabarvisible: false,
          headerShown: false,
        }}
      />
      <Stack.Screen 
        name="Contacts" 
        component={Contacts} 
        options={{ 
          tabarvisible: false,
          title: "Contacts",
         // headerShown:false,
          headerLeftContainerStyle: { paddingLeft: 10 },
          headerBackground: () => (
            <LinearGradient
              colors={['#007AFF', '#0055A4']} // Adjust colors to match your app’s existing header style
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ flex: 1 }}
            />
          ),
          headerTitleStyle: { color: 'white', fontWeight: 'bold', fontSize: 18 }, // Ensuring clear readability
        }} 
      />
      <Stack.Screen 
        name="FriendProfile" 
        component={FriendProfile} 
        options={({ route }) => ({ 
          tabarvisible: false,
          title: route.params?.username || "Profile",
          headerLeftContainerStyle: { paddingLeft: 10 },
          headerShown: false,
        })} 
      />
    </Stack.Navigator>
  );
}