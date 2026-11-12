import React, { useMemo } from 'react';

function signalPhase(minute, scenario, timings) {
  if (timings) {
    const ns = Math.max(8, Number(timings.north_south_green_seconds || 42));
    const ew = Math.max(8, Number(timings.east_west_green_seconds || 42));
    const yellow = Math.max(3, Number(timings.yellow_seconds || 3));
    const allRed = Math.max(1, Number(timings.all_red_seconds || 1));
    const cycle = ns + yellow + allRed + ew + yellow + allRed;
    const t = ((Math.floor(minute * 60) % cycle) + cycle) % cycle;
    if (t < ns) return 'NS';
    if (t < ns + yellow) return 'NS_YELLOW';
    if (t < ns + yellow + allRed) return 'ALL_RED';
    if (t < ns + yellow + allRed + ew) return 'EW';
    if (t < ns + 2 * yellow + allRed + ew) return 'EW_YELLOW';
    return 'ALL_RED';
  }
  if (scenario === 'signal_priority') return minute % 20 < 15 ? 'NS' : 'EW';
  return Math.floor(minute / (scenario === 'demand_surge' ? 5 : 10)) % 2 === 0 ? 'NS' : 'EW';
}

function SignalHead({ x, y, label, active, rotate = 0 }) {
  const northSouth = label === 'N' || label === 'S';
  const go = northSouth ? active === 'NS' : active === 'EW';
  const caution = northSouth ? active === 'NS_YELLOW' : active === 'EW_YELLOW';
  return <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
    <rect x="-14" y="-33" width="28" height="66" rx="8" fill="#14211f" stroke="#58716a" strokeWidth="2"/>
    <circle cx="0" cy="-20" r="7" fill={!go ? '#e44343' : '#743434'} stroke={!go ? '#ff8980' : '#512525'} strokeWidth="1.3"/>
    <circle cx="0" cy="0" r="7" fill={caution ? '#f5c84f' : '#594923'} stroke={caution ? '#fff0a8' : '#a48b43'} strokeWidth="1.2"/>
    <circle cx="0" cy="20" r="7" fill={go ? '#38db83' : '#245b43'} stroke={go ? '#a1ffd0' : '#183f30'} strokeWidth="1.3"/>
    <rect x="-24" y="-51" width="48" height="13" rx="5" fill="#f8fbf3" stroke="#b9c6b8"/>
    <text x="0" y="-42" textAnchor="middle" fontSize="8.5" fontWeight="900" fill="#19372d">{label} · {go ? 'GO' : caution ? 'WAIT' : 'STOP'}</text>
  </g>;
}

function Car({ x, y, direction, index, moving }) {
  const rotation = direction === 'N' ? 90 : direction === 'S' ? -90 : direction === 'W' ? 180 : 0;
  const colors = ['#f3c85b', '#71b9ea', '#f6f8f3', '#e27e62', '#9aadd4', '#7dd0a4'];
  return <g className={moving ? `sim-car sim-car-${direction.toLowerCase()}` : ''} style={moving ? { animationDelay: `${(index % 5) * 0.14}s` } : undefined} transform={`translate(${x} ${y}) rotate(${rotation})`}>
    <rect x="-15" y="-8" width="30" height="16" rx="4" fill="#243631" opacity=".5" transform="translate(1.5 2)"/>
    <rect x="-15" y="-8" width="30" height="16" rx="4" fill={colors[index % colors.length]} stroke="#f6f8f2" strokeWidth="1"/>
    <rect x="-6" y="-5" width="12" height="10" rx="2" fill="#244a55" opacity=".9"/>
    <rect x="-12" y="-7" width="4" height="3" rx="1" fill="#fff2bd"/>
    <rect x="8" y="-7" width="4" height="3" rx="1" fill="#fff2bd"/>
  </g>;
}

function Person({ x, y, scale = 1 }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} strokeLinecap="round">
    <circle cx="0" cy="-7" r="3.2" fill="#e6b28b" stroke="#725645" strokeWidth=".8"/>
    <path d="M0 -3 L0 5 M0 0 L-4 3 M0 0 L4 3 M0 5 L-3 10 M0 5 L3 10" stroke="#35665b" strokeWidth="2.6" fill="none"/>
  </g>;
}

function NativeVehicle({ vehicle }) {
  const type = String(vehicle.type || 'car').toLowerCase();
  const specs = {
    car: { length: 22, width: 10, color: '#e7bf58' },
    bus: { length: 34, width: 13, color: '#77a9d4' },
    truck: { length: 30, width: 12, color: '#d88966' },
    motorbike: { length: 12, width: 6, color: '#e8e7dc' },
    bicycle: { length: 10, width: 5, color: '#79bd94' },
  };
  const spec = specs[type] || specs.car;
  const x = Math.max(0, Math.min(1000, Number(vehicle.map_x) || 0));
  const y = Math.max(0, Math.min(1000, Number(vehicle.map_y) || 0));
  // SUMO angles are clockwise from north; SVG vehicle length is horizontal at 90°.
  const rotation = Number(vehicle.angle || 0) - 90;
  return <g transform={`translate(${x} ${y}) rotate(${rotation})`}>
    <title>{`${vehicle.id} · ${type} · ${Number(vehicle.speed_kmph || 0).toFixed(1)} km/h`}</title>
    <rect x={-spec.length / 2 - 1} y={-spec.width / 2 - 1} width={spec.length + 2} height={spec.width + 2} rx={3.5} fill="#20382d" opacity=".32"/>
    <rect x={-spec.length / 2} y={-spec.width / 2} width={spec.length} height={spec.width} rx={3} fill={spec.color} stroke="#233c31" strokeWidth="1.4"/>
    <rect x={-spec.length * .19} y={-spec.width * .34} width={spec.length * .37} height={spec.width * .68} rx="1.7" fill="#315b62" opacity=".9"/>
    <path d={`M${-spec.length * .38} ${-spec.width * .28} h${spec.length * .12} M${spec.length * .26} ${-spec.width * .28} h${spec.length * .12}`} stroke="#fff5c9" strokeWidth="1.6" strokeLinecap="round"/>
  </g>;
}

function NativeSignal({ junction, active }) {
  const color = active === 'ALL_RED' ? 'red' : active.includes('YELLOW') ? 'amber' : 'green';
  return <g transform={`translate(${junction.x} ${junction.y})`}>
    <title>{`${junction.id} · ${active.replaceAll('_', ' ')}`}</title>
    <circle r="13" fill="#f7fbf4" stroke="#61766a" strokeWidth="2"/>
    <circle cx="-4" cy="0" r="3.3" fill={color === 'red' ? '#ed514d' : '#765d5a'} opacity={color === 'red' ? 1 : .45}/>
    <circle cx="4" cy="0" r="3.3" fill={color === 'amber' ? '#efc14d' : '#7a6a3d'} opacity={color === 'amber' ? 1 : .45}/>
    <circle cy="-6" r="2.4" fill={color === 'green' ? '#3ab878' : '#416f55'} opacity={color === 'green' ? 1 : .4}/>
  </g>;
}

function NativeSumoScene({ roads = [], frame, playing = false, areaName, signalTimings, networkGeometry }) {
  const active = signalPhase(Number(frame?.minute || 0), 'baseline', signalTimings);
  const mapRoads = networkGeometry?.roads || [];
  const junctions = networkGeometry?.junctions || [];
  const vehicles = frame?.vehicle_positions || [];
  const rendered = Number(frame?.vehicle_count_rendered ?? vehicles.length);
  const actual = Number(frame?.vehicle_count_actual ?? frame?.vehicles ?? 0);
  return <section className={`panel traffic-sim-scene native-sumo-scene ${playing ? 'is-playing' : ''}`} aria-label="Native SUMO simulation with Floating Car Data vehicle positions. Synthetic reference road network, not live city telemetry.">
    <div className="traffic-sim-scene-head">
      <div><span className="eyebrow">NATIVE SUMO · FLOATING CAR DATA</span><h3>{areaName} · Vehicle movement</h3><p>Cars are plotted at their sampled SUMO coordinates and headings. Road geometry comes from the loaded SUMO network; signal colours reflect the candidate timing program.</p></div>
      <div className="traffic-sim-live"><i/>{playing ? 'SIMULATION PLAYING' : 'SIMULATION PAUSED'} <b>MIN {Number(frame?.minute ?? 0).toFixed(1)}</b></div>
    </div>
    <div className="traffic-sim-scene-canvas native-sumo-canvas">
      <svg viewBox="0 0 1000 1000" role="img" aria-label={`SUMO FCD map at minute ${frame?.minute ?? 0}, ${actual} vehicles on network, signal phase ${active}`}>
        <defs>
          <pattern id="sumo-ground-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#d5e0d2" strokeWidth="1"/></pattern>
          <pattern id="sumo-road-mark" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M0 16H32" stroke="#e8e2b8" strokeWidth="2" strokeDasharray="8 9"/></pattern>
        </defs>
        <rect width="1000" height="1000" fill="#e7eee3"/>
        <rect width="1000" height="1000" fill="url(#sumo-ground-grid)"/>
        {Array.from({ length: 16 }, (_, i) => <rect key={`block-${i}`} x={72 + (i % 4) * 225} y={72 + Math.floor(i / 4) * 225} width="150" height="150" rx="15" fill={i % 3 === 0 ? '#dce7d5' : '#e1e9dc'} stroke="#d0dccb" strokeWidth="2"/>)}
        {mapRoads.map((road) => {
          const points = (road.points || []).map((point) => `${point.x},${point.y}`).join(' ');
          if (!points) return null;
          return <g key={road.id}>
            <polyline points={points} fill="none" stroke="#f4f6ef" strokeWidth="35" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points={points} fill="none" stroke="#87948a" strokeWidth="29" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points={points} fill="none" stroke="#e7dfad" strokeWidth="1.7" strokeDasharray="10 12" opacity=".9"/>
          </g>;
        })}
        {!mapRoads.length && <text x="500" y="500" textAnchor="middle" fill="#65776b" fontSize="25">SUMO road geometry is unavailable</text>}
        {junctions.map((junction) => <NativeSignal key={junction.id} junction={junction} active={active}/>)}
        {vehicles.map((vehicle) => <NativeVehicle key={vehicle.id} vehicle={vehicle}/>)}
        {mapRoads.length > 0 && vehicles.length === 0 && <g><rect x="330" y="465" width="340" height="70" rx="14" fill="#f7faf5" stroke="#c7d5c2"/><text x="500" y="493" textAnchor="middle" fill="#50675a" fontSize="18" fontWeight="800">No FCD vehicles in this sample</text><text x="500" y="518" textAnchor="middle" fill="#829083" fontSize="12">Move the timeline to inspect another point in the run</text></g>}
      </svg>
    </div>
    <div className="traffic-sim-scene-footer native-sumo-footer">
      <div className="traffic-sim-signal-summary"><span className={active === 'NS' ? 'go' : 'stop'}><i/>{active === 'NS' ? 'N/S GREEN' : active === 'NS_YELLOW' ? 'N/S AMBER' : 'N/S RED'}</span><span className={active === 'EW' ? 'go' : 'stop'}><i/>{active === 'EW' ? 'E/W GREEN' : active === 'EW_YELLOW' ? 'E/W AMBER' : 'E/W RED'}</span><small>Candidate signal program · simulated, not connected to field controllers</small></div>
      <div className="traffic-sim-road-key"><span><i className="light-road"/> {mapRoads.length} SUMO edges</span><span><i className="light-car"/> {rendered} / {actual} vehicles rendered</span><span><i className="light-person"/> {junctions.length} signalized junctions</span></div>
    </div>
  </section>;
}


function ModelForecastScene({ frame, areaName = 'Bundled reference network', networkGeometry, signalTimings }) {
  const mapRoads = networkGeometry?.roads || [];
  const junctions = networkGeometry?.junctions || [];
  const roadData = new Map((frame?.roads || []).map((road) => [String(road.road), road]));
  const colorFor = (level) => level === 'Heavy' ? '#c95c52' : level === 'Moderate' ? '#d4a044' : '#438d66';
  const active = signalPhase(Number(frame?.minute || 0), 'baseline', signalTimings);
  return <section className="panel traffic-sim-scene native-sumo-scene model-forecast-scene" aria-label="XGBoost network queue forecast on the bundled reference road network; no individual vehicle trajectories">
    <div className="traffic-sim-scene-head">
      <div><span className="eyebrow">XGBOOST · 30 / 60-MINUTE QUEUE FORECAST</span><h3>{areaName} · Network forecast</h3><p>Road colours show per-edge modelled queue levels. These are forecast estimates, not live camera data or individual moving vehicles. Install SUMO for microscopic vehicle trajectories.</p></div>
      <div className="traffic-sim-live"><i/>{`FORECAST · MIN ${Number(frame?.minute ?? 0)}`}</div>
    </div>
    <div className="traffic-sim-scene-canvas native-sumo-canvas model-forecast-canvas">
      <svg viewBox="0 0 1000 1000" role="img" aria-label={`XGBoost forecast road network at minute ${frame?.minute ?? 0}`}>
        <defs><pattern id="model-ground-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#d5e0d2" strokeWidth="1"/></pattern></defs>
        <rect width="1000" height="1000" fill="#e7eee3"/><rect width="1000" height="1000" fill="url(#model-ground-grid)"/>
        {Array.from({ length: 16 }, (_, i) => <rect key={`model-block-${i}`} x={72 + (i % 4) * 225} y={72 + Math.floor(i / 4) * 225} width="150" height="150" rx="15" fill={i % 3 === 0 ? '#dce7d5' : '#e1e9dc'} stroke="#d0dccb" strokeWidth="2"/>)}
        {mapRoads.map((road) => {
          const points = (road.points || []).map((point) => `${point.x},${point.y}`).join(' ');
          if (!points) return null;
          const data = roadData.get(String(road.id));
          const color = colorFor(data?.level);
          return <g key={road.id}><title>{`${road.id} · ${data?.level || 'No forecast'} · Queue ${data?.queue ?? '—'}`}</title>
            <polyline points={points} fill="none" stroke="#f4f6ef" strokeWidth="34" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points={points} fill="none" stroke={color} strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" opacity={data ? .94 : .32}/>
            <polyline points={points} fill="none" stroke="#fff" strokeWidth="1.5" strokeDasharray="8 12" opacity=".8"/>
          </g>;
        })}
        {junctions.map((junction) => <g key={junction.id} transform={`translate(${junction.x} ${junction.y})`}><circle r="12" fill="#f6faf3" stroke="#607769" strokeWidth="2"/><circle r="4" fill={active === 'ALL_RED' ? '#d75a52' : active.includes('YELLOW') ? '#dfa83e' : '#48a275'}/><title>{junction.id} · proposed cycle illustration</title></g>)}
        {!mapRoads.length && <text x="500" y="500" textAnchor="middle" fill="#65776b" fontSize="25">Reference road geometry unavailable</text>}
      </svg>
    </div>
    <div className="traffic-sim-scene-footer native-sumo-footer">
      <div className="traffic-sim-signal-summary"><span className={active === 'NS' ? 'go' : 'stop'}><i/>N/S {active === 'NS' ? 'GREEN' : active === 'NS_YELLOW' ? 'AMBER' : 'RED'}</span><span className={active === 'EW' ? 'go' : 'stop'}><i/>E/W {active === 'EW' ? 'GREEN' : active === 'EW_YELLOW' ? 'AMBER' : 'RED'}</span><small>Illustrative proposed phase · no field-controller link</small></div>
      <div className="traffic-sim-road-key"><span><i className="light-road"/> {mapRoads.length} reference edges</span><span><i style={{background:'#438d66'}}/> Free</span><span><i style={{background:'#d4a044'}}/> Moderate</span><span><i style={{background:'#c95c52'}}/> Heavy</span></div>
    </div>
  </section>;
}

export default function TrafficSimulationScene(props) {
  if (props.modelForecast) return <ModelForecastScene {...props}/>;
  if (props.nativeSumo) return <NativeSumoScene {...props}/>;
  const { roads = [], frame, scenario = 'baseline', playing = false, areaName = 'Selected area', signalTimings } = props;
  const active = signalPhase(Number(frame?.minute || 0), scenario, signalTimings);
  const directions = useMemo(() => {
    const source = roads || [];
    return [
      { key: 'N', road: source[0] || source[4], count: source[0] || source[4] },
      { key: 'S', road: source[1] || source[5], count: source[1] || source[5] },
      { key: 'W', road: source[2] || source[6], count: source[2] || source[6] },
      { key: 'E', road: source[3] || source[7], count: source[3] || source[7] },
    ].map((item) => ({ ...item, queue: Math.max(0, Number(item.count?.queue || 0)), vehicles: Math.max(0, Number(item.count?.entered_vehicles ?? item.count?.vehicles ?? 0)) }));
  }, [roads]);
  const queueCars = (key) => {
    const source = directions.find((item) => item.key === key);
    const volume = source?.vehicles || source?.queue || 0;
    return Math.max(0, Math.min(7, Math.ceil(volume / 4)));
  };
  const pedestrianCount = nativeSumo ? 0 : Math.min(18, 6 + Number(frame?.heavy_roads || 0) * 2);
  const people = useMemo(() => Array.from({ length: pedestrianCount }, (_, i) => i), [pedestrianCount]);
  const labels = {
    N: directions.find((item) => item.key === 'N')?.road?.road || 'North approach',
    S: directions.find((item) => item.key === 'S')?.road?.road || 'South approach',
    W: directions.find((item) => item.key === 'W')?.road?.road || 'West approach',
    E: directions.find((item) => item.key === 'E')?.road?.road || 'East approach',
  };
  const cars = [];
  const n = queueCars('N'), s = queueCars('S'), w = queueCars('W'), e = queueCars('E');
  for (let i = 0; i < n; i++) cars.push(<Car key={`n-${i}`} x={475 + (i % 2) * 24} y={36 + i * 22} direction="S" index={i} moving={playing && active === 'NS'}/>);
  for (let i = 0; i < s; i++) cars.push(<Car key={`s-${i}`} x={526 - (i % 2) * 24} y={474 - i * 22} direction="N" index={i + 1} moving={playing && active === 'NS'}/>);
  for (let i = 0; i < w; i++) cars.push(<Car key={`w-${i}`} x={28 + i * 27} y={229 + (i % 2) * 30} direction="E" index={i + 2} moving={playing && active === 'EW'}/>);
  for (let i = 0; i < e; i++) cars.push(<Car key={`e-${i}`} x={952 - i * 27} y={269 - (i % 2) * 30} direction="W" index={i + 3} moving={playing && active === 'EW'}/>);
  const phaseLabel = active === 'NS' ? 'N/S GREEN' : active === 'EW' ? 'E/W GREEN' : active === 'NS_YELLOW' ? 'N/S AMBER' : active === 'EW_YELLOW' ? 'E/W AMBER' : 'ALL RED';
  return <section className={`panel traffic-sim-scene ${playing ? 'is-playing' : ''}`} aria-label={`${nativeSumo ? 'SUMO simulation visualization' : 'Illustrative traffic model visualization'}; not live CCTV or a physical controller`}>
    <div className="traffic-sim-scene-head">
      <div><span className="eyebrow">{nativeSumo ? 'NATIVE SUMO · SYNTHETIC GRID NETWORK' : 'REFERENCE MODEL PLAYBACK'}</span><h3>{areaName} · {nativeSumo ? 'SUMO intersection view' : 'Modelled intersection'}</h3><p>{nativeSumo ? 'Vehicle counts, speed and road conditions come from SUMO edge intervals. This is a schematic four-way view: edge IDs are mapped to visual approaches, not geographic lanes or individual tracked vehicle coordinates.' : 'This reference playback is not a live camera feed or a signal-controller connection.'}</p></div>
      <div className="traffic-sim-live"><i/>{playing ? 'SIMULATION PLAYING' : 'SIMULATION PAUSED'} <b>MIN {frame?.minute ?? 0}</b></div>
    </div>
    <div className="traffic-sim-scene-canvas">
      <svg viewBox="0 0 980 520" role="img" aria-label={`Simulation road network at minute ${frame?.minute ?? 0}; active phase ${phaseLabel}. Not live signal-controller state.`}>
        <defs>
          <pattern id="urban-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M 28 0 L 0 0 0 28" fill="none" stroke="#a5b6a4" strokeWidth=".6" opacity=".36"/></pattern>
          <pattern id="road-grain" width="46" height="46" patternUnits="userSpaceOnUse"><circle cx="7" cy="8" r=".8" fill="#ffffff" opacity=".1"/><circle cx="31" cy="25" r=".8" fill="#000000" opacity=".08"/></pattern>
        </defs>
        <rect width="980" height="520" fill="#e3eadf"/>
        <rect width="980" height="520" fill="url(#urban-grid)"/>
        <g fill="#cbd7c8" stroke="#b6c5b4" strokeWidth="1.3">
          <rect x="22" y="25" width="303" height="115" rx="13"/><rect x="650" y="25" width="305" height="115" rx="13"/>
          <rect x="22" y="385" width="303" height="110" rx="13"/><rect x="650" y="385" width="305" height="110" rx="13"/>
          <rect x="46" y="48" width="66" height="61" rx="7" fill="#bdcbb9"/><rect x="130" y="48" width="80" height="61" rx="7" fill="#bdcbb9"/><rect x="229" y="48" width="72" height="61" rx="7" fill="#bdcbb9"/>
          <rect x="674" y="48" width="78" height="61" rx="7" fill="#bdcbb9"/><rect x="770" y="48" width="62" height="61" rx="7" fill="#bdcbb9"/><rect x="849" y="48" width="83" height="61" rx="7" fill="#bdcbb9"/>
          <rect x="46" y="406" width="80" height="62" rx="7" fill="#bdcbb9"/><rect x="143" y="406" width="65" height="62" rx="7" fill="#bdcbb9"/><rect x="225" y="406" width="77" height="62" rx="7" fill="#bdcbb9"/>
          <rect x="674" y="406" width="80" height="62" rx="7" fill="#bdcbb9"/><rect x="770" y="406" width="66" height="62" rx="7" fill="#bdcbb9"/><rect x="851" y="406" width="80" height="62" rx="7" fill="#bdcbb9"/>
        </g>
        <g fill="#7e8984" stroke="#e5ece3" strokeWidth="2">
          <rect x="0" y="164" width="980" height="194"/><rect x="396" y="0" width="188" height="520"/>
        </g>
        <rect x="0" y="164" width="980" height="194" fill="url(#road-grain)"/><rect x="396" y="0" width="188" height="520" fill="url(#road-grain)"/>
        <g stroke="#e6dfae" strokeWidth="2.5" strokeDasharray="19 16" opacity=".95"><path d="M0 235 H395 M585 235 H980 M0 286 H395 M585 286 H980"/><path d="M449 0 V163 M449 359 V520 M531 0 V163 M531 359 V520"/></g>
        <g stroke="#eaf1e9" strokeWidth="2" opacity=".8"><path d="M0 174 H396 M584 174 H980 M0 347 H396 M584 347 H980"/><path d="M406 0 V164 M574 0 V164 M406 358 V520 M574 358 V520"/></g>
        <g stroke="#f6f7e9" strokeWidth="4" opacity=".95">
          {Array.from({ length: 10 }, (_, i) => <path key={`top-z-${i}`} d={`M${410 + i * 17} 151 v17`}/>)}
          {Array.from({ length: 10 }, (_, i) => <path key={`bottom-z-${i}`} d={`M${410 + i * 17} 358 v17`}/>)}
          {Array.from({ length: 8 }, (_, i) => <path key={`left-z-${i}`} d={`M${376 + i * 3} ${186 + i * 20} h19`}/>)}
          {Array.from({ length: 8 }, (_, i) => <path key={`right-z-${i}`} d={`M${585 + i * 3} ${186 + i * 20} h19`}/>)}
        </g>
        <g fill="#e6c66a" opacity=".85"><rect x="398" y="166" width="14" height="190" rx="3"/><rect x="568" y="166" width="14" height="190" rx="3"/><rect x="0" y="164" width="980" height="10"/><rect x="0" y="348" width="980" height="10"/></g>
        <g fontSize="10" fontWeight="800" fill="#f4f7f1" letterSpacing="1.1"><text x="28" y="207">WEST APPROACH</text><text x="680" y="207">EAST APPROACH</text><text x="427" y="24" transform="rotate(90 427 24)">NORTH APPROACH</text><text x="553" y="501" transform="rotate(-90 553 501)">SOUTH APPROACH</text></g>
        <g fontSize="11" fontWeight="800" fill="#263a31">
          <rect x="19" y="363" width="260" height="27" rx="7" fill="#f4f7ef" stroke="#becbb9"/><text x="31" y="381">W · {labels.W}</text>
          <rect x="700" y="363" width="260" height="27" rx="7" fill="#f4f7ef" stroke="#becbb9"/><text x="712" y="381">E · {labels.E}</text>
          <rect x="595" y="8" width="350" height="27" rx="7" fill="#f4f7ef" stroke="#becbb9"/><text x="607" y="26">N · {labels.N}</text>
          <rect x="595" y="485" width="350" height="27" rx="7" fill="#f4f7ef" stroke="#becbb9"/><text x="607" y="503">S · {labels.S}</text>
        </g>
        {cars}
        <g><SignalHead x={370} y={155} label="W" active={active}/><SignalHead x={610} y={155} label="N" active={active}/><SignalHead x={370} y={367} label="S" active={active}/><SignalHead x={610} y={367} label="E" active={active}/></g>
        {!nativeSumo && <g fill="#263b31"><rect x="21" y="30" width="190" height="25" rx="8" fill="#f8fbf5" stroke="#becbb9"/><text x="32" y="47" fontSize="10" fontWeight="800">PEDESTRIAN WAITING AREAS</text></g>}
        {people.map((i) => {
          const groups = [[346,143],[620,143],[347,378],[624,378]]; const group = groups[i % groups.length]; const local = Math.floor(i / groups.length);
          return <Person key={`person-${i}`} x={group[0] + (local % 4) * 10} y={group[1] + Math.floor(local / 4) * 11} scale={.78}/>;
        })}
        {!nativeSumo && <g><rect x="22" y="458" width="210" height="35" rx="9" fill="#f8fbf5" stroke="#bdcbb9"/><text x="35" y="472" fontSize="9" fill="#5a6d61">PEDESTRIANS WAITING</text><text x="35" y="486" fontSize="14" fontWeight="900" fill="#243e32">{pedestrianCount} people</text></g>}
        <g><rect x="745" y="458" width="210" height="35" rx="9" fill="#f8fbf5" stroke="#bdcbb9"/><text x="758" y="472" fontSize="9" fill="#5a6d61">QUEUED VEHICLES</text><text x="758" y="486" fontSize="14" fontWeight="900" fill="#243e32">{Number(frame?.queue_total || 0).toLocaleString('en-IN')}</text></g>
      </svg>
    </div>
    <div className="traffic-sim-scene-footer">
      <div className="traffic-sim-signal-summary"><span className={active === 'NS' ? 'go' : 'stop'}><i/>{active === 'NS' ? 'N/S GREEN' : active === 'NS_YELLOW' ? 'N/S AMBER' : 'N/S RED'}</span><span className={active === 'EW' ? 'go' : 'stop'}><i/>{active === 'EW' ? 'E/W GREEN' : active === 'EW_YELLOW' ? 'E/W AMBER' : 'E/W RED'}</span><small>{nativeSumo ? `SUMO phase: ${phaseLabel} · simulated only` : 'Illustrative phase · no controller connection'}</small></div>
      <div className="traffic-sim-road-key"><span><i className="light-road"/> Road network</span><span><i className="light-car"/> {nativeSumo ? '5-min vehicle entries' : 'Vehicles'}</span><span><i className="light-person"/> Pedestrian zones</span></div>
    </div>
  </section>;
}
