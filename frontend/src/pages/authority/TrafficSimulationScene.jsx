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


function IsometricBuilding({ x, y, width = 42, depth = 28, height = 24, tone = 0 }) {
  const roof = ['#eef2ed', '#e6ece7', '#f4f4ee'][tone % 3];
  const left = ['#bbc8c0', '#c5cec7', '#b5c4bb'][tone % 3];
  const right = ['#9ead9f', '#aab9ad', '#91a496'][tone % 3];
  return <g transform={`translate(${x} ${y})`}>
    <polygon points={`2,${depth/2+5} ${width/2+3},2 ${width+7},${depth/2+5} ${width/2+3},${depth+8}`} fill="#6f8574" opacity=".18"/>
    <polygon points={`0,${depth/2} ${width/2},0 ${width},${depth/2} ${width/2},${depth}`} fill={roof} stroke="#aab9ad" strokeWidth="1"/>
    <polygon points={`0,${depth/2} ${width/2},${depth} ${width/2},${depth+height} 0,${depth/2+height}`} fill={left} stroke="#91a294" strokeWidth=".8"/>
    <polygon points={`${width/2},${depth} ${width},${depth/2} ${width},${depth/2+height} ${width/2},${depth+height}`} fill={right} stroke="#829487" strokeWidth=".8"/>
    {Array.from({length: Math.max(2, Math.floor(height/9))}, (_, row) => <g key={row} opacity=".72">
      <path d={`M${5} ${depth/2+7+row*9} l${width/2-8} 8`} stroke="#edf4ef" strokeWidth="2"/>
      <path d={`M${width/2+6} ${depth-5+row*9} l${width/2-10} -7`} stroke="#e7eee8" strokeWidth="2"/>
    </g>)}
  </g>;
}

function CityBackdrop({ prefix = 'city' }) {
  const blocks = Array.from({ length: 16 }, (_, index) => ({
    index, x: 42 + (index % 4) * 230, y: 42 + Math.floor(index / 4) * 230,
    green: index % 5 === 0 || index % 7 === 0,
  }));
  return <g className="sim-city-backdrop">
    <rect width="1000" height="1000" fill="#dfe8dd"/>
    <path d="M0 120 Q210 40 390 150 T770 115 T1000 130 V0 H0Z" fill="#e8eee5" opacity=".7"/>
    {blocks.map(({index, x, y, green}) => <g key={`${prefix}-block-${index}`}>
      <rect x={x} y={y} width="178" height="178" rx="13" fill={green ? '#b9d2ad' : '#cbd8c9'} stroke="#b8c8b8" strokeWidth="2"/>
      {green ? <g>
        <path d={`M${x+16} ${y+88} Q${x+75} ${y+62} ${x+160} ${y+96}`} fill="none" stroke="#e8eee0" strokeWidth="13"/>
        {[0,1,2,3,4].map((t) => <g key={t} transform={`translate(${x+26+(t%3)*58} ${y+30+Math.floor(t/3)*78})`}><circle r="12" fill="#739d70"/><circle r="7" fill="#8fb887"/><rect x="-2" y="7" width="4" height="12" fill="#8b775e"/></g>)}
      </g> : <g>
        <path d={`M${x+12} ${y+82} H${x+166} M${x+86} ${y+12} V${y+166}`} stroke="#e5ece2" strokeWidth="9"/>
        <IsometricBuilding x={x+16} y={y+20} width={49+(index%3)*5} depth={27} height={22+(index%4)*6} tone={index}/>
        <IsometricBuilding x={x+91} y={y+26} width={45+(index%2)*8} depth={26} height={18+(index%3)*8} tone={index+1}/>
        <IsometricBuilding x={x+38} y={y+102} width={43+(index%3)*5} depth={25} height={17+(index%2)*9} tone={index+2}/>
        <g fill="#739b72"><circle cx={x+145} cy={y+119} r="9"/><circle cx={x+145} cy={y+146} r="8"/></g>
      </g>}
    </g>)}
  </g>;
}

function CityCrosswalk({ x, y }) {
  return <g opacity=".92" transform={`translate(${x} ${y})`}>
    {Array.from({length:7},(_,i)=><g key={i}>
      <rect x={-43+i*13} y="-43" width="7" height="27" rx="1" fill="#f5f4e9"/>
      <rect x={-43+i*13} y="16" width="7" height="27" rx="1" fill="#f5f4e9"/>
      <rect x="-43" y={-43+i*13} width="27" height="7" rx="1" fill="#f5f4e9"/>
      <rect x="16" y={-43+i*13} width="27" height="7" rx="1" fill="#f5f4e9"/>
    </g>)}
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
  // Vehicle headings are converted to the road-map display orientation.
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
  const active = signalPhase(Number(frame?.minute || 0), 'signal_priority', signalTimings);
  const mapRoads = networkGeometry?.roads || [];
  const junctions = networkGeometry?.junctions || [];
  const vehicles = frame?.vehicle_positions || [];
  const rendered = Number(frame?.vehicle_count_rendered ?? vehicles.length);
  const actual = Number(frame?.vehicle_count_actual ?? frame?.vehicles ?? 0);
  return <section className={`panel traffic-sim-scene native-sumo-scene ${playing ? 'is-playing' : ''}`} aria-label="Detailed road simulation with sampled vehicle positions on a reference network, not live city telemetry.">
    <div className="traffic-sim-scene-head">
      <div><span className="eyebrow">DETAILED ROAD SIMULATION</span><h3>{areaName} · Vehicle movement</h3><p>Vehicles are plotted at their sampled positions and headings. Road geometry comes from the reference network; signal colours reflect the candidate timing program.</p></div>
      <div className="traffic-sim-live"><i/>{playing ? 'SIMULATION PLAYING' : 'SIMULATION PAUSED'} <b>MIN {Number(frame?.minute ?? 0).toFixed(1)}</b></div>
    </div>
    <div className="traffic-sim-scene-canvas native-sumo-canvas">
      <svg viewBox="0 0 1000 1000" role="img" aria-label={`Road network map at minute ${frame?.minute ?? 0}, ${actual} vehicles on network, signal phase ${active}`}>
        <defs>
          <pattern id="sumo-ground-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#d5e0d2" strokeWidth="1"/></pattern>
          <pattern id="sumo-road-mark" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M0 16H32" stroke="#e8e2b8" strokeWidth="2" strokeDasharray="8 9"/></pattern>
        </defs>
        <CityBackdrop prefix="sumo-city"/>
        {mapRoads.map((road) => {
          const points = (road.points || []).map((point) => `${point.x},${point.y}`).join(' ');
          if (!points) return null;
          return <g key={road.id}>
            <polyline points={points} fill="none" stroke="#b8c5b9" strokeWidth="56" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points={points} fill="none" stroke="#e9eee6" strokeWidth="50" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points={points} fill="none" stroke="#3d4b49" strokeWidth="39" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points={points} fill="none" stroke="#e8e4c4" strokeWidth="1.8" strokeDasharray="11 13" opacity=".95"/>
            <polyline points={points} fill="none" stroke="#f5f5ed" strokeWidth="1.1" strokeDasharray="1 19" opacity=".8"/>
          </g>;
        })}
        {!mapRoads.length && <text x="500" y="500" textAnchor="middle" fill="#65776b" fontSize="25">Reference road geometry is unavailable</text>}
        {junctions.map((junction) => <g key={`crosswalk-${junction.id}`}><CityCrosswalk x={junction.x} y={junction.y}/><NativeSignal junction={junction} active={active}/></g>)}
        {vehicles.map((vehicle) => <NativeVehicle key={vehicle.id} vehicle={vehicle}/>)}
        {mapRoads.length > 0 && vehicles.length === 0 && <g><rect x="330" y="465" width="340" height="70" rx="14" fill="#f7faf5" stroke="#c7d5c2"/><text x="500" y="493" textAnchor="middle" fill="#50675a" fontSize="18" fontWeight="800">No FCD vehicles in this sample</text><text x="500" y="518" textAnchor="middle" fill="#829083" fontSize="12">Move the timeline to inspect another point in the run</text></g>}
      </svg>
    </div>
    <div className="traffic-sim-scene-footer native-sumo-footer">
      <div className="traffic-sim-signal-summary"><span className={active === 'NS' ? 'go' : 'stop'}><i/>{active === 'NS' ? 'N/S GREEN' : active === 'NS_YELLOW' ? 'N/S AMBER' : 'N/S RED'}</span><span className={active === 'EW' ? 'go' : 'stop'}><i/>{active === 'EW' ? 'E/W GREEN' : active === 'EW_YELLOW' ? 'E/W AMBER' : 'E/W RED'}</span><small>Candidate signal program · simulated, not connected to field controllers</small></div>
      <div className="traffic-sim-road-key"><span><i className="light-road"/> {mapRoads.length} road segments</span><span><i className="light-car"/> {rendered} / {actual} vehicles rendered</span><span><i className="light-person"/> {junctions.length} signalized junctions</span></div>
    </div>
  </section>;
}


function pointAlongRoad(points, progress) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const segments = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dx = Number(points[i].x) - Number(points[i - 1].x);
    const dy = Number(points[i].y) - Number(points[i - 1].y);
    const length = Math.hypot(dx, dy);
    if (length > 0) { segments.push({ from: points[i - 1], dx, dy, length }); total += length; }
  }
  if (!total) return null;
  let remaining = ((progress % 1) + 1) % 1 * total;
  for (const segment of segments) {
    if (remaining <= segment.length) {
      const ratio = remaining / segment.length;
      return { x: Number(segment.from.x) + segment.dx * ratio, y: Number(segment.from.y) + segment.dy * ratio, angle: Math.atan2(segment.dy, segment.dx) * 180 / Math.PI };
    }
    remaining -= segment.length;
  }
  const last = segments[segments.length - 1];
  return { x: Number(last.from.x) + last.dx, y: Number(last.from.y) + last.dy, angle: Math.atan2(last.dy, last.dx) * 180 / Math.PI };
}

function ModelForecastScene({ frame, areaName = 'Reference road network', networkGeometry, signalTimings, playing = false }) {
  const forecastRows = frame?.roads || [];
  const referenceRoads = useMemo(() => {
    const roads = [];
    const horizontalY = [220, 500, 780];
    const verticalX = [220, 500, 780];
    let index = 0;
    horizontalY.forEach((y, row) => {
      for (let col = 0; col < 3; col += 1) {
        const rowData = forecastRows[index] || {};
        roads.push({ id: String(rowData.road || `Corridor ${index + 1}`), points: [{ x: 40 + col * 280, y }, { x: 320 + col * 280, y }], label: rowData.road || `East–west ${row + 1}.${col + 1}` });
        index += 1;
      }
    });
    verticalX.forEach((x, col) => {
      for (let row = 0; row < 3; row += 1) {
        const rowData = forecastRows[index] || {};
        roads.push({ id: String(rowData.road || `Corridor ${index + 1}`), points: [{ x, y: 40 + row * 280 }, { x, y: 320 + row * 280 }], label: rowData.road || `North–south ${col + 1}.${row + 1}` });
        index += 1;
      }
    });
    return roads;
  }, [forecastRows]);
  const mapRoads = networkGeometry?.roads?.length ? networkGeometry.roads : referenceRoads;
  const junctions = networkGeometry?.junctions?.length ? networkGeometry.junctions : Array.from({ length: 9 }, (_, index) => ({ id: `J-${index + 1}`, x: 220 + (index % 3) * 280, y: 220 + Math.floor(index / 3) * 280 }));
  const roadData = new Map((frame?.roads || []).map((road) => [String(road.road), road]));
  const colorFor = (level) => level === 'Heavy' ? '#c95c52' : level === 'Moderate' ? '#d4a044' : '#438d66';
  const active = signalPhase(Number(frame?.minute || 0), 'signal_priority', signalTimings);
  const trafficMarkers = useMemo(() => mapRoads.slice(0, 42).flatMap((road, index) => {
    const measured = roadData.get(String(road.id)) || roadData.get(String(road.label));
    const queue = Math.max(0, Number(measured?.queue || 0));
    if (!measured || queue < 1) return [];
    const count = Math.min(3, Math.max(1, Math.ceil(queue / 20)));
    return Array.from({ length: count }, (_, vehicleIndex) => {
      const position = pointAlongRoad(road.points, Number(frame?.minute || 0) / 60 * 1.8 + index * .137 + vehicleIndex * .43);
      return position ? { id: `${road.id}-${vehicleIndex}`, ...position, road: road.id, level: measured.level } : null;
    }).filter(Boolean);
  }), [mapRoads, roadData, frame?.minute]);
  return <section className={`panel traffic-sim-scene native-sumo-scene model-forecast-scene ${playing ? 'is-playing' : ''}`} aria-label="60-minute reference road network forecast with illustrative traffic flow markers">
    <div className="traffic-sim-scene-head">
      <div><span className="eyebrow">60-MINUTE ROAD NETWORK</span><h3>{areaName} · Traffic flow</h3><p>Road colours and queue values update at each forecast step. Moving vehicle markers illustrate flow direction; they are not individual tracked vehicles or live CCTV positions.</p></div>
      <div className="traffic-sim-live"><i/>{playing ? 'PLAYING' : 'PAUSED'} · MIN {Number(frame?.minute ?? 0)}</div>
    </div>
    <div className="traffic-sim-scene-canvas native-sumo-canvas model-forecast-canvas">
      <svg viewBox="0 0 1000 1000" role="img" aria-label={`Forecast road network at minute ${frame?.minute ?? 0}`}>
        <defs><pattern id="model-ground-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#d5e0d2" strokeWidth="1"/></pattern></defs>
        <CityBackdrop prefix="model-city"/>
        {mapRoads.map((road) => {
          const points = (road.points || []).map((point) => `${point.x},${point.y}`).join(' ');
          if (!points) return null;
          const data = roadData.get(String(road.id));
          const color = colorFor(data?.level);
          return <g key={road.id}><title>{`${road.id} · ${data?.level || 'No forecast'} · Queue ${data?.queue ?? '—'}`}</title>
            <polyline points={points} fill="none" stroke="#b8c5b9" strokeWidth="56" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points={points} fill="none" stroke="#e9eee6" strokeWidth="50" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points={points} fill="none" stroke="#3d4b49" strokeWidth="39" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points={points} fill="none" stroke={color} strokeWidth="6" strokeDasharray="17 21" strokeLinecap="round" opacity={data ? .95 : .18}/>
            <polyline points={points} fill="none" stroke="#e8e4c4" strokeWidth="1.7" strokeDasharray="11 13" opacity=".95"/>
            <title>{road.label || road.id} · {data?.level || "No forecast"} · queue {data?.queue ?? "—"}</title>
          </g>;
        })}
        {junctions.map((junction) => <g key={junction.id}><CityCrosswalk x={junction.x} y={junction.y}/><g transform={`translate(${junction.x} ${junction.y})`}><circle r="12" fill="#f6faf3" stroke="#607769" strokeWidth="2"/><circle r="4" fill={active === 'ALL_RED' ? '#d75a52' : active.includes('YELLOW') ? '#dfa83e' : '#48a275'}/><title>{junction.id} · proposed signal phase</title></g></g>)}
        {trafficMarkers.map((vehicle) => <g key={vehicle.id} transform={`translate(${vehicle.x} ${vehicle.y}) rotate(${vehicle.angle})`} style={{ transition: playing ? 'transform .75s linear' : 'none' }}><title>{`${vehicle.road} · ${vehicle.level} forecast · representative flow marker`}</title><rect x="-10" y="-5" width="20" height="10" rx="3" fill={vehicle.level === 'Heavy' ? '#f0bd61' : vehicle.level === 'Moderate' ? '#82b7dc' : '#77c49a'} stroke="#284d3c" strokeWidth="1.4"/><rect x="-3.5" y="-3.2" width="7" height="6.4" rx="1.4" fill="#315a62"/><path d="M-7 -4 h2 M5 -4 h2" stroke="#fff8d6" strokeWidth="1.4" strokeLinecap="round"/></g>)}
        {!mapRoads.length && <text x="500" y="500" textAnchor="middle" fill="#65776b" fontSize="25">Reference road geometry unavailable</text>}
      </svg>
    </div>
    <div className="traffic-sim-scene-footer native-sumo-footer">
      <div className="traffic-sim-signal-summary"><span className={active === 'NS' ? 'go' : 'stop'}><i/>N/S {active === 'NS' ? 'GREEN' : active === 'NS_YELLOW' ? 'AMBER' : 'RED'}</span><span className={active === 'EW' ? 'go' : 'stop'}><i/>E/W {active === 'EW' ? 'GREEN' : active === 'EW_YELLOW' ? 'AMBER' : 'RED'}</span><small>Illustrative proposed phase · no field-controller link</small></div>
      <div className="traffic-sim-road-key"><span><i className="light-road"/> {mapRoads.length} road segments</span><span><i className="light-car"/> {trafficMarkers.length} flow markers</span><span><i style={{background:'#438d66'}}/> Free</span><span><i style={{background:'#d4a044'}}/> Moderate</span><span><i style={{background:'#c95c52'}}/> Heavy</span></div>
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
  return <section className={`panel traffic-sim-scene ${playing ? 'is-playing' : ''}`} aria-label={`${nativeSumo ? 'Detailed road simulation view' : 'Illustrative traffic model visualization'}; not live CCTV or a physical controller`}>
    <div className="traffic-sim-scene-head">
      <div><span className="eyebrow">{nativeSumo ? 'DETAILED ROAD SIMULATION · REFERENCE NETWORK' : 'REFERENCE MODEL PLAYBACK'}</span><h3>{areaName} · {nativeSumo ? 'Signalized intersection view' : 'Modelled intersection'}</h3><p>{nativeSumo ? 'Vehicle counts, speed and road conditions come from road-segment measurements. This is a schematic four-way view: edge IDs are mapped to visual approaches, not geographic lanes or individual tracked vehicle coordinates.' : 'This reference playback is not a live camera feed or a signal-controller connection.'}</p></div>
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
      <div className="traffic-sim-signal-summary"><span className={active === 'NS' ? 'go' : 'stop'}><i/>{active === 'NS' ? 'N/S GREEN' : active === 'NS_YELLOW' ? 'N/S AMBER' : 'N/S RED'}</span><span className={active === 'EW' ? 'go' : 'stop'}><i/>{active === 'EW' ? 'E/W GREEN' : active === 'EW_YELLOW' ? 'E/W AMBER' : 'E/W RED'}</span><small>{nativeSumo ? `Signal phase: ${phaseLabel} · simulated only` : 'Illustrative phase · no controller connection'}</small></div>
      <div className="traffic-sim-road-key"><span><i className="light-road"/> Road network</span><span><i className="light-car"/> {nativeSumo ? '5-min vehicle entries' : 'Vehicles'}</span><span><i className="light-person"/> Pedestrian zones</span></div>
    </div>
  </section>;
}
