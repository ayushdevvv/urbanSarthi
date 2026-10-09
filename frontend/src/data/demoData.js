// Synthetic UI fixtures for demos and API outage/empty-database fallbacks.
// These values are deliberately labelled synthetic; they are not live city feeds.
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const daysAgo = (days, hours = 0) => new Date(Date.now() - (days * 24 + hours) * 3_600_000).toISOString();

const aqiLocations = [
  ['Connaught Place',28.6315,77.2167,174],['India Gate',28.6129,77.2295,142],['ITO',28.6280,77.2410,211],
  ['Anand Vihar',28.6469,77.3160,286],['RK Puram',28.5633,77.1869,158],['Punjabi Bagh',28.6683,77.1198,232],
  ['Dwarka Sector 8',28.5650,77.0670,119],['Ashok Vihar',28.6954,77.1810,203],['Mandir Marg',28.6358,77.2005,137],
  ['Lodhi Road',28.5918,77.2273,104],['Chandni Chowk',28.6506,77.2303,196],['Patparganj',28.6230,77.2870,248],
  ['Okhla Phase II',28.5308,77.2713,188],['Najafgarh',28.6127,76.9798,121],['Vivek Vihar',28.6720,77.3150,258],
  ['Wazirpur',28.6998,77.1654,219],['Nehru Nagar',28.5679,77.2500,171],['Sonia Vihar',28.7105,77.2490,193],
  ['Greater Kailash',28.5480,77.2420,116],['Noida Sector 62',28.6280,77.3649,207],['Ghaziabad Indirapuram',28.6460,77.3700,229],
  ['Gurugram Sector 51',28.4320,77.0730,128],['Faridabad Sector 16A',28.4080,77.3070,154],['Vasant Kunj',28.5200,77.1580,99],
];
const categoryFor = (aqi) => aqi <= 50 ? 'Good' : aqi <= 100 ? 'Satisfactory' : aqi <= 200 ? 'Moderate' : aqi <= 300 ? 'Poor' : 'Very Poor';
export const DEMO_AQI_STATIONS = aqiLocations.map(([name, latitude, longitude, baseAqi], index) => {
  const aqi = Math.max(42, baseAqi + ((index % 5) - 2) * 5);
  return {
    id: 7000 + index, external_station_id: `DEMO-AQI-${String(index + 1).padStart(2, '0')}`,
    station_name: name, latitude, longitude, source: 'synthetic-demo', observed_at: minutesAgo((index * 7) % 95),
    aqi, pm25: Math.round(aqi * 0.41 * 10) / 10, pm10: Math.round(aqi * 0.72 * 10) / 10,
    no2: Math.round((14 + (index * 7) % 36) * 10) / 10, o3: Math.round((18 + (index * 11) % 48) * 10) / 10,
    co: Math.round((0.3 + (index % 8) * 0.11) * 100) / 100, category: categoryFor(aqi),
    raw_payload: { is_synthetic: true, note: 'UI fallback sample; not an official CPCB/CAAQMS observation.' },
  };
});

export const DEMO_TRANSIT_ROUTES = [
  ['Yellow Line','Samaypur Badli ↔ HUDA City Centre','metro','#D9B62D'],
  ['Blue Line','Dwarka Sector 21 ↔ Noida Electronic City','metro','#3979C3'],
  ['Violet Line','Kashmere Gate ↔ Raja Nahar Singh','metro','#8B63B4'],
  ['Pink Line','Majlis Park ↔ Shiv Vihar','metro','#D86D91'],
  ['Magenta Line','Janakpuri West ↔ Botanical Garden','metro','#AF4A9B'],
  ['Airport Express','New Delhi ↔ IGI Airport','metro','#B5A6A2'],
  ['Rapid 410','Connaught Place ↔ India Gate','bus','#E18A42'],
  ['Rapid 522','ITO ↔ Hauz Khas','bus','#5A9B80'],
  ['Rapid 615','Kashmere Gate ↔ Anand Vihar','bus','#477D99'],
  ['Rapid 728','Rajiv Chowk ↔ Dwarka Sector 8','bus','#B87551'],
  ['Rapid 740','AIIMS ↔ Nehru Place','bus','#8A9865'],
  ['Rapid 894','Lajpat Nagar ↔ Noida Sector 62','bus','#6B83C3'],
].map(([short_name,long_name,mode,route_color], index) => ({
  id: 8000 + index, external_id: `DEMO-ROUTE-${String(index+1).padStart(2,'0')}`,
  short_name, long_name, mode, agency_name: 'UrbanSaarthi demo network', route_color: route_color.replace('#',''), source: 'synthetic-demo',
}));

const stopRows = [
  ['New Delhi Railway Station',28.6420,77.2196],['Rajiv Chowk',28.6328,77.2197],['Patel Chowk',28.6233,77.2137],
  ['Central Secretariat',28.6147,77.2090],['Khan Market',28.6000,77.2270],['Mandi House',28.6259,77.2345],
  ['Supreme Court',28.6234,77.2496],['Yamuna Bank',28.6233,77.2677],['Akshardham',28.6233,77.2775],
  ['Kashmere Gate',28.6674,77.2282],['Vishwavidyalaya',28.6880,77.2216],['Hauz Khas',28.5430,77.2066],
  ['AIIMS',28.5672,77.2100],['Lajpat Nagar',28.5701,77.2363],['INA',28.5757,77.2074],
  ['Dhaula Kuan',28.5918,77.1613],['Rajendra Place',28.6425,77.1782],['Karol Bagh',28.6517,77.1900],
  ['ITO',28.6289,77.2405],['Connaught Place',28.6315,77.2167],['Anand Vihar',28.6469,77.3160],
  ['Dwarka Sector 21',28.5523,77.0583],['Dwarka Sector 8',28.5650,77.0670],['Noida Sector 62',28.6280,77.3649],
  ['Botanical Garden',28.5640,77.3340],['Janakpuri West',28.6295,77.0770],['Nehru Place',28.5491,77.2510],
  ['India Gate Bus Stop',28.6129,77.2295],['Nizamuddin',28.5884,77.2505],['Vasant Kunj',28.5200,77.1580],
];
export const DEMO_TRANSIT_STOPS = stopRows.map(([name,latitude,longitude], index) => ({
  id: 9000 + index, external_id: `DEMO-STOP-${String(index+1).padStart(2,'0')}`,
  name, latitude, longitude, wheelchair_boarding: index % 3 !== 0, parent_station: null, source: 'synthetic-demo',
}));

export const DEMO_TRANSIT_ALERTS = [
  { id: 9501, external_id:'DEMO-ALERT-01', title:'Demo notice · Blue Line crowding', description:'Synthetic service notice for the demo. No live operator feed is connected.', severity:'medium', status:'active', route_external_ids:['DEMO-ROUTE-02'], stop_external_ids:['DEMO-STOP-02'], source:'synthetic-demo' },
  { id: 9502, external_id:'DEMO-ALERT-02', title:'Demo notice · ITO bus diversion', description:'A sample disruption card to preview alert handling and visual hierarchy.', severity:'high', status:'active', route_external_ids:['DEMO-ROUTE-08'], stop_external_ids:['DEMO-STOP-19'], source:'synthetic-demo' },
  { id: 9503, external_id:'DEMO-ALERT-03', title:'Demo notice · Airport Express normal', description:'Sample informational status; not a live timetable or operator confirmation.', severity:'info', status:'active', route_external_ids:['DEMO-ROUTE-06'], stop_external_ids:['DEMO-STOP-01'], source:'synthetic-demo' },
];

export const DEMO_TRIPS = [
  { id:9801, public_id:'DEMO-TRIP-A81F', origin_label:'New Delhi Railway Station', destination_label:'India Gate', origin_latitude:28.6420, origin_longitude:77.2196, destination_latitude:28.6129, destination_longitude:77.2295, preference:'balanced', status:'completed', distance_meters:4850, duration_seconds:1020, created_at:daysAgo(0,3), completed_at:daysAgo(0,3), actual_metrics:{is_synthetic:true} },
  { id:9802, public_id:'DEMO-TRIP-B42D', origin_label:'Rajiv Chowk', destination_label:'Akshardham', origin_latitude:28.6328, origin_longitude:77.2197, destination_latitude:28.6233, destination_longitude:77.2775, preference:'fastest', status:'completed', distance_meters:8100, duration_seconds:1560, created_at:daysAgo(1,6), completed_at:daysAgo(1,6), actual_metrics:{is_synthetic:true} },
  { id:9803, public_id:'DEMO-TRIP-C11E', origin_label:'AIIMS', destination_label:'Hauz Khas', origin_latitude:28.5672, origin_longitude:77.2100, destination_latitude:28.5430, destination_longitude:77.2066, preference:'cleanest', status:'completed', distance_meters:3600, duration_seconds:900, created_at:daysAgo(2,2), completed_at:daysAgo(2,2), actual_metrics:{is_synthetic:true} },
  { id:9804, public_id:'DEMO-TRIP-D76A', origin_label:'Kashmere Gate', destination_label:'Connaught Place', origin_latitude:28.6674, origin_longitude:77.2282, destination_latitude:28.6315, destination_longitude:77.2167, preference:'balanced', status:'in_progress', distance_meters:5200, duration_seconds:1200, created_at:daysAgo(0,0), actual_metrics:{is_synthetic:true} },
  { id:9805, public_id:'DEMO-TRIP-E09B', origin_label:'Lajpat Nagar', destination_label:'Nehru Place', origin_latitude:28.5701, origin_longitude:77.2363, destination_latitude:28.5491, destination_longitude:77.2510, preference:'cleanest', status:'planned', distance_meters:4100, duration_seconds:1080, created_at:daysAgo(0,0), actual_metrics:{is_synthetic:true} },
  { id:9806, public_id:'DEMO-TRIP-F53C', origin_label:'Dhaula Kuan', destination_label:'Vasant Kunj', origin_latitude:28.5918, origin_longitude:77.1613, destination_latitude:28.5200, destination_longitude:77.1580, preference:'fastest', status:'cancelled', distance_meters:9100, duration_seconds:1380, created_at:daysAgo(8,1), actual_metrics:{is_synthetic:true} },
  { id:9807, public_id:'DEMO-TRIP-G38A', origin_label:'ITO', destination_label:'Patel Chowk', origin_latitude:28.6289, origin_longitude:77.2405, destination_latitude:28.6233, destination_longitude:77.2137, preference:'balanced', status:'completed', distance_meters:3300, duration_seconds:780, created_at:daysAgo(12,4), completed_at:daysAgo(12,4), actual_metrics:{is_synthetic:true} },
];
export const DEMO_MOBILITY_SUMMARY = {
  total_trips: DEMO_TRIPS.length, completed_trips: DEMO_TRIPS.filter((x) => x.status === 'completed').length,
  in_progress_trips: DEMO_TRIPS.filter((x) => x.status === 'in_progress').length,
  recorded_distance_km: Number((DEMO_TRIPS.filter((x) => x.status === 'completed').reduce((a,x)=>a+(x.distance_meters||0),0)/1000).toFixed(2)),
  recorded_travel_hours: Number((DEMO_TRIPS.filter((x) => x.status === 'completed').reduce((a,x)=>a+(x.duration_seconds||0),0)/3600).toFixed(2)), ticket_requests: 3,
  emissions_note:'Synthetic demo summary. Route CO₂ values are illustrative estimates, not audited emissions or verified savings.',
};
export const createDemoCitySummary = (days = 7) => {
  const withinRange = DEMO_TRIPS.filter((trip) => Date.now() - new Date(trip.created_at).getTime() <= days * 86_400_000);
  return {
    period_days: days, trip_requests: withinRange.length, completed_trips: withinRange.filter((trip)=>trip.status==='completed').length,
    cancelled_trips: withinRange.filter((trip)=>trip.status==='cancelled').length,
    recorded_route_distance_km: Number((withinRange.reduce((sum, trip)=>sum+(trip.distance_meters||0),0)/1000).toFixed(2)),
    note:'Synthetic demo summary generated locally when the API has no saved trip records. These are not operational city statistics.',
  };
};

export const DEMO_JUNCTIONS = Array.from({length:24}, (_, index) => {
  const base = [aqiLocations[index % aqiLocations.length][1], aqiLocations[index % aqiLocations.length][2]];
  const congestion = 24 + (index * 17) % 73;
  return {
    id: 10000 + index, external_id:`DEMO-JUNCTION-${String(index+1).padStart(2,'0')}`,
    name:`Demo junction · ${aqiLocations[index % aqiLocations.length][0]}`, latitude:base[0]+(((index%3)-1)*0.0015), longitude:base[1]+(((index%4)-1.5)*0.0013),
    status: index % 11 === 0 ? 'degraded' : 'online', lane_count:4, baseline_cycle_seconds:90, cluster_id:Math.floor(index/2)+1,
    vehicle_count:34+(index*19)%145, queue_length_m:Math.round((8+(index*7)%58)*10)/10, average_speed_kmph:Math.max(8,48-(index*3)%36), average_wait_seconds:18+(index*13)%95,
    lane_density:Math.round((0.22+((index*9)%68)/100)*100)/100, congestion_score:congestion, observed_at:minutesAgo((index*3)%25),
    configuration:{is_synthetic:true,coordinates_verified:false},
  };
});

export const DEMO_SIGNAL_PLANS = DEMO_JUNCTIONS.slice(0,8).map((junction,index)=>({
  id:11000+index, public_id:`DEMO-PLAN-${String(index+1).padStart(2,'0')}`, junction_id:junction.id,
  plan_type:index%3===0?'demo-adaptive-recommendation':index%3===1?'demo-peak-hour':'demo-emissions-aware',
  status:['simulated','draft','approved','simulated'][index%4], cycle_seconds:86+(index*7)%38,
  phases:[
    {name:'North–South',movement:'north_south',green_seconds:26+(index%7),yellow_seconds:3,all_red_seconds:1,demand_weight:1.2},
    {name:'East–West',movement:'east_west',green_seconds:22+(index%5),yellow_seconds:3,all_red_seconds:1,demand_weight:1},
    {name:'Protected turns',movement:'turns',green_seconds:12+(index%4),yellow_seconds:3,all_red_seconds:1,demand_weight:0.6},
  ], rationale:'Synthetic demonstration strategy based on sample arrival pressure. Review against measured local traffic before real-world use.',
  projected_outcomes:{is_synthetic:true,estimated_delay_reduction_pct:7+(index*3)%18,estimated_queue_reduction_pct:5+(index*4)%22}, model_version:'demo-scenario-v1', created_at:daysAgo(index%6,index), updated_at:minutesAgo(index*9),
}));

export const DEMO_DATA_SOURCES = [
  { id:12001, external_id:'synthetic-demo', name:'Synthetic demo observations', source_type:'other', provider:'Local demo fixture', status:'online', freshness_seconds:45, safe_config:{is_synthetic:true}, last_success_at:minutesAgo(2), last_error:null },
  { id:12002, external_id:'cpcb-aqi', name:'CPCB AQI station feed', source_type:'cpcb', provider:'External integration required', status:'not_configured', freshness_seconds:null, safe_config:{is_synthetic:false}, last_success_at:null, last_error:null },
  { id:12003, external_id:'gtfs-static', name:'GTFS static transit feed', source_type:'gtfs', provider:'Synthetic GTFS sample', status:'online', freshness_seconds:120, safe_config:{is_synthetic:true}, last_success_at:minutesAgo(5), last_error:null },
  { id:12004, external_id:'osrm-routing', name:'Road-network route provider', source_type:'osm', provider:'Heuristic fallback active', status:'degraded', freshness_seconds:null, safe_config:{is_synthetic:true}, last_success_at:null, last_error:'External OSRM endpoint not configured; fallback estimates are shown.' },
  { id:12005, external_id:'camera-edge', name:'Camera vision event ingest', source_type:'camera', provider:'Push endpoint', status:'not_configured', freshness_seconds:null, safe_config:{is_synthetic:false}, last_success_at:null, last_error:null },
  { id:12006, external_id:'atcs-signal', name:'Traffic signal controller', source_type:'atcs', provider:'Preview only', status:'not_configured', freshness_seconds:null, safe_config:{is_synthetic:false}, last_success_at:null, last_error:null },
  { id:12007, external_id:'sumo-twin', name:'SUMO digital twin', source_type:'sumo', provider:'Analytical what-if engine', status:'degraded', freshness_seconds:null, safe_config:{is_synthetic:true}, last_success_at:null, last_error:'A SUMO runtime is not launched by the demo backend.' },
];

const recentCongestion = DEMO_JUNCTIONS.filter((j)=>j.congestion_score>=70).map((j,index)=>({
  junction_id:j.id, name:j.name, vehicle_count:j.vehicle_count, queue_length_m:j.queue_length_m, congestion_score:j.congestion_score, observed_at:j.observed_at,
}));
export const DEMO_COMMAND_OVERVIEW = {
  generated_at:minutesAgo(1),
  traffic:{mean_congestion_score:Math.round(DEMO_JUNCTIONS.reduce((sum,j)=>sum+j.congestion_score,0)/DEMO_JUNCTIONS.length),forecasted_junction_count:18,junctions_high_congestion:recentCongestion.slice(0,8),data_quality:'Synthetic demo telemetry; not a live camera feed.'},
  network:{junctions_online:22,junctions_total:24,clusters_online:10,clusters_total:12,junctions_with_recent_traffic_data:24},
  air_quality:{mean_aqi:Math.round(DEMO_AQI_STATIONS.reduce((sum,s)=>sum+s.aqi,0)/DEMO_AQI_STATIONS.length),stations_with_recent_data:DEMO_AQI_STATIONS.length},
  alerts:{active_count:5,items:[
    {id:13001,title:'Demo · Elevated congestion near ITO',category:'traffic',severity:'high',status:'active',created_at:minutesAgo(12)},
    {id:13002,title:'Demo · AQI category elevated in Anand Vihar',category:'air_quality',severity:'medium',status:'active',created_at:minutesAgo(22)},
    {id:13003,title:'Demo · Bus corridor running slow',category:'transit',severity:'medium',status:'active',created_at:minutesAgo(31)},
    {id:13004,title:'Demo · Camera connection pending',category:'data_source',severity:'low',status:'active',created_at:minutesAgo(55)},
    {id:13005,title:'Demo · Peak-hour plan ready for review',category:'signals',severity:'info',status:'active',created_at:minutesAgo(70)},
  ]},
  demo_mode:true,
};

export const DEMO_TRANSIT_JOURNEYS = {
  status:'available', demo_mode:true, limitations:['Synthetic public-transport alternatives for the demo; not a live departure board or confirmed schedule.'],
  options:[
    {id:'DEMO-JOURNEY-1',label:'Blue Line · direct',mode:'metro',duration_seconds:1560,distance_meters:8100,transfers:0,provider:'synthetic-demo',data_quality:'synthetic-demo',warnings:['Illustrative timings only.']},
    {id:'DEMO-JOURNEY-2',label:'Metro + short walk',mode:'transit',duration_seconds:1920,distance_meters:7800,transfers:1,provider:'synthetic-demo',data_quality:'synthetic-demo',warnings:['Illustrative timings only.']},
    {id:'DEMO-JOURNEY-3',label:'Bus corridor',mode:'bus',duration_seconds:2280,distance_meters:9300,transfers:0,provider:'synthetic-demo',data_quality:'synthetic-demo',warnings:['Illustrative timings only.']},
  ],
};

function haversineKm(origin,destination) {
  const rad = Math.PI/180; const dLat=(destination[0]-origin[0])*rad; const dLon=(destination[1]-origin[1])*rad;
  const a=Math.sin(dLat/2)**2+Math.cos(origin[0]*rad)*Math.cos(destination[0]*rad)*Math.sin(dLon/2)**2;
  return 6371*2*Math.asin(Math.sqrt(Math.min(1,a)));
}
export function createDemoRoutePlan(payload) {
  const origin=[Number(payload.origin_latitude),Number(payload.origin_longitude)];
  const destination=[Number(payload.destination_latitude),Number(payload.destination_longitude)];
  if (![...origin,...destination].every(Number.isFinite)) throw new Error('Enter valid coordinates to preview a demo route.');
  const directKm=Math.max(0.35,haversineKm(origin,destination));
  const mode=payload.modes?.[0] || 'driving';
  const baseSpeed=mode==='cycling'?15:mode==='walking'?4.6:mode==='transit'?23:27;
  const factors=mode==='driving'?[1.15,1.25,1.34]:mode==='cycling'?[1.08,1.16,1.24]:mode==='walking'?[1.04,1.10,1.18]:[1.10,1.20,1.30];
  const labels=mode==='driving'?['Quickest road estimate','Balanced arterial route','Lower-emission alternative']:mode==='cycling'?['Direct cycle route','Quieter-street alternative','Low-exposure cycle route']:mode==='walking'?['Direct walking route','Park-side walking option','Low-exposure walking option']:['Metro-first journey','Metro + short walk','Bus corridor option'];
  const demoAqi=DEMO_AQI_STATIONS.reduce((sum,s)=>sum+s.aqi,0)/DEMO_AQI_STATIONS.length;
  let routes=factors.map((factor,index)=>{
    const distance=directKm*1000*factor;
    const trafficFactor=mode==='driving'?(index===0?1.22:index===1?1.08:0.98):1;
    const duration=Math.round(distance/1000/baseSpeed*3600*trafficFactor);
    const estimatedAqi=Math.max(55,Math.round(demoAqi-index*17+(mode==='driving'?12:mode==='transit'?-8: -20)));
    const co2=mode==='driving'?Math.round(distance/1000*(index===0?132:index===1?119:103)):mode==='transit'?Math.round(distance/1000*28):0;
    const offset=(index-1)*0.004;
    return {
      id:null,label:labels[index],mode,duration_seconds:duration,distance_meters:Math.round(distance),traffic_delay_seconds:mode==='driving'?Math.round(duration*(index===0?0.13:index===1?0.07:0.03)):0,
      pollution_score:Math.min(100,Math.round(estimatedAqi/4)),estimated_aqi:estimatedAqi,estimated_co2_grams:co2,transfers:mode==='transit'?(index===0?0:1):0,
      provider:'UrbanSaarthi synthetic demo engine',data_quality:'synthetic-demo',geometry:{type:'LineString',coordinates:[[origin[1],origin[0]],[((origin[1]+destination[1])/2)+offset,((origin[0]+destination[0])/2)-offset],[destination[1],destination[0]]]},
      itinerary:{note:'Synthetic illustration only. Not turn-by-turn navigation; values are not live traffic observations.',is_synthetic:true},
      warnings:['Synthetic demo estimate. Configure a road-routing provider for verified road-network geometry.'],
    };
  });
  const preference=payload.preference||'balanced';
  if(preference==='fastest') routes.sort((a,b)=>a.duration_seconds-b.duration_seconds);
  else if(preference==='cleanest') routes.sort((a,b)=>(a.estimated_aqi||999)-(b.estimated_aqi||999)||(a.estimated_co2_grams||0)-(b.estimated_co2_grams||0));
  else routes.sort((a,b)=>(a.duration_seconds/Math.max(...routes.map(r=>r.duration_seconds)))*0.65+(a.pollution_score/100)*0.35-(b.duration_seconds/Math.max(...routes.map(r=>r.duration_seconds))*0.65+(b.pollution_score/100)*0.35));
  routes=routes.map((route,index)=>({...route,preference_rank:`${preference}-#${index+1}`}));
  return {
    trip_id:null,public_trip_id:`DEMO-${Math.random().toString(36).slice(2,9).toUpperCase()}`,preference,routes,demo_mode:true,
    data_freshness:{traffic_last_observed_at:minutesAgo(4),aqi_last_observed_at:minutesAgo(18),routing_provider:'Synthetic frontend route engine',aqi_max_age_minutes:180},
    warnings:['Demo route options are generated locally because the backend is empty or unavailable. They are for UI preview only.'],
  };
}
