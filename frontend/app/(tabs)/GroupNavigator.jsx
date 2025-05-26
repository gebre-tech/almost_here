import { createStackNavigator } from '@react-navigation/stack';
import Groups from './groups';
import CreateGroupScreen from './CreateGroupScreen';
import GroupChatScreen from './GroupChatScreen';
import GroupInfo from './GroupInfo';
import React from 'react';
import FriendProfile from './FriendProfile';

const Stack = createStackNavigator();

const GroupsNavigator = () => {
  return (
    <Stack.Navigator
      initialRouteName="Groups"
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen
        name="Groups"
        component={Groups}
        options={{
          tabBarVisible: true,
        }}
      />
      <Stack.Screen
        name="CreateGroup"
        component={CreateGroupScreen}
        options={{
          tabBarVisible: false,
          headerShown: true,
        }}
      />
      <Stack.Screen
        name="GroupChatScreen"
        component={GroupChatScreen}
        options={{
          tabBarVisible: false,
        }}
      />
      <Stack.Screen
        name="GroupInfo"
        component={GroupInfo}
        options={{
          tabBarVisible: false,
        }}
      />
      <Stack.Screen
        name="FriendProfile"
        component={FriendProfile}
        options={{
          tabBarVisible: false,
        }}
      />
    </Stack.Navigator>
  );
};

export default GroupsNavigator;