import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProvider } from './context/AppContext.jsx';
import App from './App.jsx';
import './styles/authority.css';
import './styles/citizen.css';
import 'leaflet/dist/leaflet.css';
import './styles/global.css';
import './styles/premium-ui.css';
import './styles/polish.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider><App /></AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
