import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './context/AppContext.jsx';
import PortalLanding from './pages/landing/PortalLanding.jsx';
import AuthPage from './pages/auth/AuthPage.jsx';
import AuthorityLayout from './components/layout/AuthorityLayout.jsx';
import CitizenLayout from './components/layout/CitizenLayout.jsx';
import CommandCenterPage from './pages/authority/CommandCenterPage.jsx';
import SignalPlansPage from './pages/authority/SignalPlansPage.jsx';
import AnalyticsPage from './pages/authority/AnalyticsPage.jsx';
import DataSourcesPage from './pages/authority/DataSourcesPage.jsx';
import SettingsPage from './pages/authority/SettingsPage.jsx';
import CitizenHomePage from './pages/citizen/CitizenHomePage.jsx';
import RoutePlannerPage from './pages/citizen/RoutePlannerPage.jsx';
import AirQualityPage from './pages/citizen/AirQualityPage.jsx';
import TransitPage from './pages/citizen/TransitPage.jsx';
import TripsPage from './pages/citizen/TripsPage.jsx';
import Toast from './components/shared/Toast.jsx';

export default function App() {
  const { dark } = useApp();
  return <div className={dark ? 'theme-root dark-theme' : 'theme-root'}>
    <Routes>
      <Route path="/" element={<PortalLanding />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/authority" element={<AuthorityLayout />}>
        <Route index element={<Navigate to="control" replace />} />
        <Route path="control" element={<CommandCenterPage />} />
        <Route path="signals" element={<SignalPlansPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="sources" element={<DataSourcesPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="/citizen" element={<CitizenLayout />}>
        <Route index element={<CitizenHomePage />} />
        <Route path="plan" element={<RoutePlannerPage />} />
        <Route path="air-quality" element={<AirQualityPage />} />
        <Route path="transit" element={<TransitPage />} />
        <Route path="trips" element={<TripsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    <Toast />
  </div>;
}
