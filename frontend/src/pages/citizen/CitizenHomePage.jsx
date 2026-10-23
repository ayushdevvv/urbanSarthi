import RoutePlannerPage from './RoutePlannerPage.jsx';

// The route planner is the citizen home experience, so users do not have to
// jump between a separate home page and a duplicate trip-planning page.
export default function CitizenHomePage() {
  return <RoutePlannerPage embedded />;
}
