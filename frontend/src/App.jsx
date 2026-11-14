import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './context/AppContext.jsx';
import { installSiteTranslation } from './context/translationRuntime.js';
import PortalLanding from './pages/landing/PortalLanding.jsx';
import AuthorityLayout from './components/layout/AuthorityLayout.jsx';
import CitizenLayout from './components/layout/CitizenLayout.jsx';
import CommandCenterPage from './pages/authority/CommandCenterPage.jsx';
import AnalyticsPage from './pages/authority/AnalyticsPage.jsx';
import AirQualityOverviewPage from './pages/authority/AirQualityOverviewPage.jsx';
import CarbonImpactPage from './pages/authority/CarbonImpactPage.jsx';
import IotNetworkPage from './pages/authority/IotNetworkPage.jsx';
import DataSourcesPage from './pages/authority/DataSourcesPage.jsx';
import SettingsPage from './pages/authority/SettingsPage.jsx';
import TrafficVisionPage from './pages/citizen/TrafficVisionPage.jsx';
import TrafficAgentPage from './pages/authority/TrafficAgentPage.jsx';
import CitizenHomePage from './pages/citizen/CitizenHomePage.jsx';
import RoutePlannerPage from './pages/citizen/RoutePlannerPage.jsx';
import AirQualityPage from './pages/citizen/AirQualityPage.jsx';
import TransitPage from './pages/citizen/TransitPage.jsx';
import TripsPage from './pages/citizen/TripsPage.jsx';
import TrafficInfoPage from './pages/citizen/TrafficInfoPage.jsx';
import Toast from './components/shared/Toast.jsx';

function RouteScrollReset() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.querySelector('.main, .citizen-content')?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname]);
  return null;
}

export default function App() {
  const { dark, language } = useApp();
  useEffect(() => installSiteTranslation(language), [language]);
  return <div className={dark ? 'theme-root dark-theme' : 'theme-root'}>
    <RouteScrollReset />
    <Routes>
      <Route path="/" element={<PortalLanding />} />
      <Route path="/agent" element={<Navigate to="/citizen" replace />} />
      <Route path="/authority" element={<AuthorityLayout />}>
        <Route index element={<Navigate to="control" replace />} />
        <Route path="control" element={<CommandCenterPage />} />
        <Route path="agent" element={<Navigate to="/authority/traffic-agent" replace />} />
        <Route path="air-intelligence" element={<AirQualityOverviewPage />} />
        <Route path="aqi-forecast" element={<AirQualityOverviewPage forecastFocus />} />
        <Route path="traffic-simulation" element={<TrafficInfoPage adminMode />} />
        <Route path="carbon" element={<CarbonImpactPage />} />
        <Route path="traffic" element={<Navigate to="/authority/traffic-lab" replace />} />
        <Route path="traffic-model" element={<Navigate to="/authority/traffic-simulation" replace />} />
        <Route path="traffic-analysis" element={<Navigate to="/authority/traffic-lab" replace />} />
        <Route path="signal-plans" element={<Navigate to="/authority/traffic-agent" replace />} />
        <Route path="aqi-prediction" element={<Navigate to="/authority/air-intelligence" replace />} />
        <Route path="signals" element={<Navigate to="/authority/traffic-agent" replace />} />
        <Route path="traffic-lab" element={<TrafficVisionPage authorityLab />} />
        <Route path="traffic-agent" element={<TrafficAgentPage />} />
        <Route path="iot" element={<IotNetworkPage />} />
        <Route path="aqi" element={<Navigate to="/authority/air-intelligence" replace />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="sources" element={<DataSourcesPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="/citizen" element={<CitizenLayout />}>
        <Route index element={<CitizenHomePage />} />
        <Route path="plan" element={<Navigate to="/citizen" replace />} />
        <Route path="agent" element={<Navigate to="/citizen" replace />} />
        <Route path="air-quality" element={<AirQualityPage />} />
        <Route path="aqi-forecast" element={<AirQualityPage forecastFocus />} />
        <Route path="aqi-vision" element={<Navigate to="/citizen/air-quality" replace />} />
        <Route path="transit" element={<TransitPage />} />
        <Route path="traffic" element={<TrafficInfoPage />} />
        <Route path="traffic-vision" element={<Navigate to="/authority/traffic-lab" replace />} />
        <Route path="trips" element={<TripsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    <Toast />
  </div>;
}
