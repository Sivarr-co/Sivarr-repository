import { useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';

export function useAuth() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    SecureStore.getItemAsync('sivarr_token').then(token => {
      setIsLoggedIn(!!token);
      setLoading(false);
    });
  }, []);

  async function login(token: string) {
    await SecureStore.setItemAsync('sivarr_token', token);
    setIsLoggedIn(true);
  }

  async function logout() {
    await SecureStore.deleteItemAsync('sivarr_token');
    setIsLoggedIn(false);
  }

  return { isLoggedIn, loading, login, logout };
}
