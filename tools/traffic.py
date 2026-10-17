#!/usr/bin/env python3
"""Traffic on Newark Road (the A616) through Kneesall, from the Department for Transport, into data/traffic.json.

  python3 tools/traffic.py data/traffic.json --tra0307 tra0307-traffic-distribution-by-time-of-day.ods \
      --gtfs itm_east_midlands_gtfs.zip

- How many vehicles a day, and of what kind: the annual average daily flow at DfT count point 91065 (the A616 between
  Ollerton and Newark, counted 1 km west of the village), from the road traffic statistics API.
- Which way they go in each hour: the manual counts there (7am to 7pm, by direction), averaged over every count day.
- How the day's traffic falls across the hours and the days of the week: DfT table TRA0307 (all roads, Great Britain,
  latest year), an index where 100 is the average hour of the year.
- The buses that run through: the Bus Open Data Service timetables for the East Midlands (GTFS), every trip that calls
  at or passes the village, with the dates it runs.
"""
import argparse, csv, io, json, re, urllib.request, zipfile
import xml.etree.ElementTree as ET

API = 'https://roadtraffic.dft.gov.uk/api/'
COUNT_POINT = 91065
BBOX = (53.163, -0.966, 53.177, -0.930)   # lat0, lon0, lat1, lon1 (the model)
# DfT direction letters at the count point: south and east are towards Newark
TO_NEWARK = {'S': True, 'E': True, 'N': False, 'W': False}


def api(path):
    with urllib.request.urlopen(API + path, timeout=60) as r:
        return json.load(r)['data']


def ods_rows(path, sheet):
    T = '{urn:oasis:names:tc:opendocument:xmlns:table:1.0}'
    V = '{urn:oasis:names:tc:opendocument:xmlns:office:1.0}value'
    P = '{urn:oasis:names:tc:opendocument:xmlns:text:1.0}p'
    root = ET.fromstring(zipfile.ZipFile(path).read('content.xml'))
    for t in root.iter(T + 'table'):
        if t.get(T + 'name') != sheet: continue
        for r in t.iter(T + 'table-row'):
            cells = []
            for c in r:
                n = min(50, int(c.get(T + 'number-columns-repeated', '1')))
                cells += [c.get(V) or ' '.join(''.join(p.itertext()) for p in c.iter(P))] * n
            yield cells


def hour_index(path):
    rows = [r for r in ods_rows(path, 'TRA0307') if re.fullmatch(r'20\d\d', r[0] if r else '')]
    year = max(r[0] for r in rows)
    days = {d: [0.0] * 24 for d in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')}
    for r in rows:
        if r[0] != year: continue
        h = int(r[1][:2])
        for i, d in enumerate(days): days[d][h] = float(r[4 + i])
    return int(year), days


def buses(path):
    z = zipfile.ZipFile(path)
    rd = lambda n: csv.DictReader(io.TextIOWrapper(z.open(n), 'utf-8-sig'))
    inside = lambda la, lo: BBOX[0] < la < BBOX[2] and BBOX[1] < lo < BBOX[3]
    stops = {s['stop_id']: s for s in rd('stops.txt') if s['stop_lat'] and inside(float(s['stop_lat']), float(s['stop_lon']))}
    # route shapes that cross the model (a bus can pass through without stopping)
    shapes = {}
    for s in rd('shapes.txt'):
        if inside(float(s['shape_pt_lat']), float(s['shape_pt_lon'])):
            shapes.setdefault(s['shape_id'], []).append((int(s['shape_pt_sequence']), float(s['shape_pt_lat']), float(s['shape_pt_lon'])))
    calls = {}
    for st in rd('stop_times.txt'):
        if st['stop_id'] in stops: calls.setdefault(st['trip_id'], []).append(st)
    trips = [t for t in rd('trips.txt') if t['trip_id'] in calls or t['shape_id'] in shapes]
    want = {t['trip_id'] for t in trips}
    times = {}   # every call of those trips, to time the ones that pass without stopping
    for st in rd('stop_times.txt'):
        if st['trip_id'] in want: times.setdefault(st['trip_id'], []).append(st)
    routes = {r['route_id']: r for r in rd('routes.txt')}
    agencies = {a['agency_id']: a['agency_name'] for a in rd('agency.txt')}
    services = {t['service_id'] for t in trips}
    week = {c['service_id']: c for c in rd('calendar.txt') if c['service_id'] in services}
    dates = {}
    for d in rd('calendar_dates.txt'):
        if d['service_id'] in services: dates.setdefault(d['service_id'], {})[d['date']] = d['exception_type'] == '1'
    feed = next(rd('feed_info.txt'))
    out = []
    for t in trips:
        r = routes[t['route_id']]
        sts = sorted(times[t['trip_id']], key=lambda s: int(s['stop_sequence']))
        here = [s for s in sts if s['stop_id'] in stops]
        pts = sorted(shapes.get(t['shape_id'], []))
        trip = {'route': r['route_short_name'], 'operator': agencies.get(r['agency_id'], ''), 'headsign': t['trip_headsign'],
                'path': [[la, lo] for _, la, lo in pts[:1] + pts[-1:]],
                'calls': [{'stop': stops[s['stop_id']]['stop_name'], 'at': [float(stops[s['stop_id']]['stop_lat']), float(stops[s['stop_id']]['stop_lon'])],
                           'arrive': s['arrival_time'], 'depart': s['departure_time'],
                           'first': s is sts[0], 'last': s is sts[-1]} for s in here]}
        c = week.get(t['service_id'])
        if c: trip['days'] = ''.join('1' if c[d] == '1' else '0' for d in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')); trip['from'], trip['to'] = c['start_date'], c['end_date']
        ex = dates.get(t['service_id'], {})
        trip['on'] = sorted(d for d, on in ex.items() if on)
        trip['off'] = sorted(d for d, on in ex.items() if not on)
        out.append(trip)
    return {'feed': feed['feed_version'], 'validTo': feed['feed_end_date'], 'trips': out}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--tra0307', required=True)
    ap.add_argument('--gtfs', required=True)
    a = ap.parse_args()
    aadf = max(api(f'average-annual-daily-flow?filter%5Bcount_point_id%5D={COUNT_POINT}&page%5Bsize%5D=100'), key=lambda r: r['year'])
    raw = api(f'raw-counts?filter%5Bcount_point_id%5D={COUNT_POINT}&page%5Bsize%5D=500')
    raw += api('raw-counts?filter%5Bcount_point_id%5D=27375&page%5Bsize%5D=500')   # the same place, under its old number
    to_newark, total, hgv = [0] * 24, [0] * 24, {}
    days = set()
    for r in raw:
        days.add(r['count_date'][:10])
        total[r['hour']] += r['all_motor_vehicles']
        if TO_NEWARK[r['direction_of_travel']]: to_newark[r['hour']] += r['all_motor_vehicles']
        for k in ('hgvs_2_rigid_axle', 'hgvs_3_rigid_axle', 'hgvs_4_or_more_rigid_axle', 'hgvs_3_or_4_articulated_axle', 'hgvs_5_articulated_axle', 'hgvs_6_articulated_axle'):
            hgv[k] = hgv.get(k, 0) + (r[k] or 0)
    year, index = hour_index(a.tra0307)
    nh = sum(hgv.values())
    out = {
        'about': 'Traffic on the A616 through Kneesall. Contains Department for Transport road traffic statistics (Open Government Licence v3): '
                 f'annual average daily flow {aadf["year"]} at count point {COUNT_POINT}; direction by hour from its manual counts on {len(days)} days '
                 f'({min(days)} to {max(days)}); hour and day of week from table TRA0307 ({year}, all roads in Great Britain, 100 = the average hour). '
                 'Buses from the Bus Open Data Service timetables (Open Government Licence v3).',
        'countPoint': COUNT_POINT, 'year': aadf['year'],
        'perDay': {'all': aadf['all_motor_vehicles'], 'cars': aadf['cars_and_taxis'], 'vans': aadf['lgvs'], 'lorries': aadf['all_hgvs'],
                   'buses': aadf['buses_and_coaches'], 'motorbikes': aadf['two_wheeled_motor_vehicles'], 'bicycles': aadf['pedal_cycles']},
        # lorries by kind: two-axle rigid (a box van), three-axle rigid, four-axle rigid (tippers and mixers), articulated
        'lorries': {'rigid2': round(hgv['hgvs_2_rigid_axle'] / nh, 3), 'rigid3': round(hgv['hgvs_3_rigid_axle'] / nh, 3),
                    'rigid4': round(hgv['hgvs_4_or_more_rigid_axle'] / nh, 3),
                    'artic': round((hgv['hgvs_3_or_4_articulated_axle'] + hgv['hgvs_5_articulated_axle'] + hgv['hgvs_6_articulated_axle']) / nh, 3)},
        'hourIndex': index, 'indexYear': year,
        # share of each hour's traffic heading towards Newark (south-east); null where not counted
        'towardsNewark': [round(to_newark[h] / total[h], 3) if total[h] else None for h in range(24)],
        'buses': buses(a.gtfs),
    }
    with open(a.out, 'w') as f: json.dump(out, f, indent=1)
    print(a.out, out['perDay'], out['lorries'], len(out['buses']['trips']), 'bus trips')


if __name__ == '__main__':
    main()
