import 'react-native-get-random-values';
import React, { useContext } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { ThemeProvider, ThemeContext } from '../context/ThemeContext';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Layout from './_layout';

const TestComponent = () => {
  const context = useContext(ThemeContext);
  console.log('index.jsx: TestComponent ThemeContext value:', context);
  return null;
};

const App = () => {
  console.log('index.jsx: Rendering App with ThemeProvider');
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <TestComponent />
          <NavigationContainer>
            <Layout />
          </NavigationContainer>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};

export default App;