/**
 * Renderer entry point.
 *
 * The renderer only uses the preload API (window.sccfs) and never Node APIs (spec §2.2).
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(React.createElement(App));
}
