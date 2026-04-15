/**
 * Root application component.
 * Provides a basic login page shell.
 */
import React from 'react';
import { Login } from './pages/Login';

export function App(): React.JSX.Element {
  return React.createElement(Login);
}
