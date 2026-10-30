import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './context/AppContext.jsx';
import { installSiteTranslation } from './context/translationRuntime.js';
import PortalLanding from './pages/landing/PortalLanding.jsx';
import AuthorityLayout from './components/layout/AuthorityLayout.jsx';
import CitizenLayout from './components/layout/CitizenLayout.jsx';
import CommandCenterPage from './pages/authority/CommandCenterPage.jsx';
import SignalPlansPage from './pages/authority/SignalPlansPage.jsx';
import AnalyticsPage from './pages/authority/AnalyticsPage.jsx';
import AirQualityOverviewPage from './pages/authority/AirQualityOverviewPage.jsx';
import CarbonImpactPage from './pages/authority/CarbonImpactPage.jsx';
import IotNetworkPage from './pages/authority/IotNetworkPage.jsx';
import DroneSurveyPage from './pages/authority/DroneSurveyPage.jsx';
import DataSourcesPage from './pages/authority/DataSourcesPage.jsx';
import SettingsPage from './pages/authority/SettingsPage.jsx';
import TrafficVisionPage from './pages/citizen/TrafficVisionPage.jsx';
import CitizenHomePage from './pages/citizen/CitizenHomePage.jsx';
import RoutePlannerPage from './pages/citizen/RoutePlannerPage.jsx';
import AirQualityPage from './pages/citizen/AirQualityPage.jsx';
import AqiVisionPage from './pages/citizen/AqiVisionPage.jsx';
import TransitPage from './pages/citizen/TransitPage.jsx';
import TripsPage from './pages/citizen/TripsPage.jsx';
import TrafficInfoPage from './pages/citizen/TrafficInfoPage.jsx';
import Toast from './components/shared/Toast.jsx';

export default function App() {
  const { dark, language } = useApp();
  useEffect(() => installSiteTranslation(language), [language]);
  return <div className={dark ? 'theme-root dark-theme' : 'theme-root'}>
    <Routes>
      <Route path="/" element={<PortalLanding />} />
      <Route path="/agent" element={<Navigate to="/citizen" replace />} />
      <Route path="/authority" element={<AuthorityLayout />}>
        <Route index element={<Navigate to="air-intelligence" replace />} />
        <Route path="control" element={<CommandCenterPage />} />
        <Route path="agent" element={<Navigate to="/authority/air-intelligence" replace />} />
        <Route path="air-intelligence" element={<AirQualityOverviewPage />} />
        <Route path="carbon" element={<CarbonImpactPage />} />
        <Route path="traffic" element={<TrafficInfoPage adminMode />} />
        <Route path="traffic-model" element={<TrafficInfoPage adminMode />} />
        <Route path="signals" element={<SignalPlansPage />} />
        <Route path="traffic-lab" element={<TrafficVisionPage authorityLab />} />
        <Route path="iot" element={<IotNetworkPage />} />
        <Route path="drones" element={<DroneSurveyPage />} />
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
        <Route path="aqi-vision" element={<AqiVisionPage />} />
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
