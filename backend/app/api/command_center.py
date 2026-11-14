from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.db import get_db
from app.dependencies import require_roles
from app.models import AqiObservation, CityAlert, CityCluster, DataSource, Junction, TrafficForecast, TrafficObservation
from app.schemas import ClusterOut
from app.services.common import utc_now

router = APIRouter(prefix="/command-center", tags=["City command centre"])


@router.get("/overview")
def command_overview(db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin"))):
    now = utc_now()
    recent_cutoff = now - timedelta(minutes=30)
    hour_cutoff = now - timedelta(hours=1)
    junctions_total = db.scalar(select(func.count(Junction.id))) or 0
    clusters_total = db.scalar(select(func.count(CityCluster.id))) or 0
    online_clusters = db.scalar(select(func.count(CityCluster.id)).where(CityCluster.status == "online")) or 0
    online_junctions = db.scalar(select(func.count(Junction.id)).where(Junction.status == "online")) or 0
    recent = list(db.scalars(select(TrafficObservation).where(TrafficObservation.observed_at >= recent_cutoff).order_by(TrafficObservation.observed_at.desc()).limit(2000)))
    latest_by_junction: dict[int, TrafficObservation] = {}
    for observation in recent:
        if observation.junction_id and observation.junction_id not in latest_by_junction:
            latest_by_junction[observation.junction_id] = observation
    congestion_scores = [o.congestion_score for o in latest_by_junction.values() if o.congestion_score is not None]
    alerts = list(db.scalars(select(CityAlert).where(CityAlert.status == "active").order_by(CityAlert.severity.desc(), CityAlert.created_at.desc()).limit(100)))
    aqi_rows = list(db.scalars(select(AqiObservation).where(AqiObservation.observed_at >= hour_cutoff).order_by(AqiObservation.observed_at.desc()).limit(1000)))
    latest_aqi: dict[str, AqiObservation] = {}
    for row in aqi_rows:
        key = row.external_station_id or row.station_name
        if key not in latest_aqi:
            latest_aqi[key] = row
    source_statuses = list(db.scalars(select(DataSource.status, func.count(DataSource.id)).group_by(DataSource.status)))
    source_counts = {status: count for status, count in source_statuses}
    high_congestion = [
        {"junction_id": jid, "name": db.get(Junction, jid).name if db.get(Junction, jid) else None,
         "congestion_score": o.congestion_score, "queue_length_m": o.queue_length_m,
         "vehicle_count": o.vehicle_count, "observed_at": o.observed_at.isoformat()}
        for jid, o in latest_by_junction.items() if (o.congestion_score or 0) >= 70
    ]
    forecasts = list(db.scalars(select(TrafficForecast).where(TrafficForecast.generated_at >= hour_cutoff).order_by(TrafficForecast.generated_at.desc()).limit(500)))
    latest_forecast_by_junction = {}
    for f in forecasts:
        if f.junction_id not in latest_forecast_by_junction:
            latest_forecast_by_junction[f.junction_id] = f
    return {
        "generated_at": now.isoformat(),
        "network": {"clusters_total": clusters_total, "clusters_online": online_clusters,
                    "junctions_total": junctions_total, "junctions_online": online_junctions,
                    "junctions_with_recent_traffic_data": len(latest_by_junction)},
        "traffic": {"mean_congestion_score": round(sum(congestion_scores) / len(congestion_scores), 1) if congestion_scores else None,
                    "junctions_high_congestion": high_congestion[:30], "vehicle_count_latest_observations": sum(o.vehicle_count for o in latest_by_junction.values()),
                    "forecasted_junction_count": len(latest_forecast_by_junction)},
        "air_quality": {"stations_with_recent_data": len(latest_aqi), "mean_aqi": round(sum(r.aqi for r in latest_aqi.values() if r.aqi is not None) / len([r for r in latest_aqi.values() if r.aqi is not None]), 1) if any(r.aqi is not None for r in latest_aqi.values()) else None,
                         "last_observed_at": max((r.observed_at for r in latest_aqi.values()), default=None).isoformat() if latest_aqi else None},
        "alerts": {"active_count": len(alerts), "items": [{"id": a.id, "public_id": a.public_id, "title": a.title, "severity": a.severity, "category": a.category, "created_at": a.created_at.isoformat()} for a in alerts[:15]]},
        "data_sources": {"status_counts": source_counts, "configured_sources": sum(source_counts.values()),
                         "warning": "Only ingested/configured records are shown; no live CCTV, CPCB or ATCS connection is implied."},
    }


@router.get("/clusters", response_model=list[ClusterOut])
def list_clusters(db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin"))):
    return list(db.scalars(select(CityCluster).order_by(CityCluster.name)))


@router.get("/clusters/{cluster_id}")
def cluster_detail(cluster_id: int, db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin"))):
    cluster = db.get(CityCluster, cluster_id)
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")
    junctions = list(db.scalars(select(Junction).where(Junction.cluster_id == cluster_id).order_by(Junction.name)))
    junction_items = []
    for junction in junctions:
        latest = db.scalar(select(TrafficObservation).where(TrafficObservation.junction_id == junction.id).order_by(TrafficObservation.observed_at.desc()).limit(1))
        junction_items.append({"junction": {"id": junction.id, "external_id": junction.external_id, "name": junction.name, "status": junction.status, "latitude": junction.latitude, "longitude": junction.longitude},
                              "latest_traffic": {"observed_at": latest.observed_at.isoformat(), "vehicle_count": latest.vehicle_count, "queue_length_m": latest.queue_length_m, "congestion_score": latest.congestion_score} if latest else None})
    return {"cluster": ClusterOut.model_validate(cluster).model_dump(mode="json"), "junctions": junction_items}


@router.get("/health/data-sources")
def data_source_health(db: Session = Depends(get_db), user=Depends(require_roles("operator", "admin"))):
    rows = list(db.scalars(select(DataSource).order_by(DataSource.source_type, DataSource.name)))
    now = utc_now()
    result = []
    for row in rows:
        age = int((now - row.last_success_at.replace(tzinfo=row.last_success_at.tzinfo or now.tzinfo)).total_seconds()) if row.last_success_at else None
        freshness = "unknown" if age is None else ("fresh" if row.freshness_seconds is None or age <= row.freshness_seconds else "stale")
        result.append({"external_id": row.external_id, "name": row.name, "source_type": row.source_type,
                       "provider": row.provider, "status": row.status, "age_seconds": age,
                       "freshness": freshness, "last_error": row.last_error})
    return {"generated_at": now.isoformat(), "sources": result}
