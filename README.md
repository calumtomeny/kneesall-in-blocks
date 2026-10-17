# LEGO Kneesall

A walkable WebGL model of Kneesall, Nottinghamshire, built out of LEGO-style bricks.

```bash
python3 tools/serve.py        # then open http://localhost:8765
```

On a phone or tablet, drag on the left half of the screen to walk and on the right half to look; buttons along the
bottom stand in for the keys (time, month, weather, sound, map, view, fly, up and down). Touch screens start with a
lower resolution, a smaller shadow map and no ambient occlusion, as phone graphics chips need it.

<kbd>L</kbd> (or <b>Share</b> on a phone) copies a link to the view: where you stand and which way you look, and the
time of day, weather and month if you changed them. The link is plain latitude and longitude, so a point copied from
an online map works as well (`?at=53.1705,-0.9485&look=90` stands you on the nearest open ground there, looking
east; `look=heading,pitch` in compass degrees, `fly=` metres up, `view=third`, `time=morning|midday|afternoon|golden|night|now`
or a clock time such as `time=07:45`,
`weather=fair|overcast|rain`, `month=1`…`12`).

## Data sources

| What | Source | Licence |
|---|---|---|
| Roads, names, church/restaurant/school/café, churchyard, hedges, woods, streams, poles, bus stops, gates and kissing gates, public footpaths and bridleways | OpenStreetMap (Overpass API) | ODbL — © OpenStreetMap contributors |
| Pavements (which side of each road) | OpenStreetMap `sidewalk` tags; Street View for the roads without them (`roads` in `data/survey.json`) | ODbL / — |
| Building outlines | Ordnance Survey OpenMap – Local (`SK_Building`, `SK_ImportantBuilding`) | OGL v3 — contains OS data © Crown copyright and database right |
| Terrain, building and roof shapes (stud by stud), trees (evergreen or deciduous), hedgerows | Environment Agency LIDAR Composite DTM, First Return and Last Return DSM, 1 m | OGL v3 — © Environment Agency |
| Drives, yards and car parks (tarmac or gravel) | Environment Agency National LIDAR Programme intensity, 2022, with the DTM and DSMs (`tools/hard_ground.py`) | OGL v3 — © Environment Agency |
| Roof materials (slate, brown tile, pantile, sheeting, felt) | Environment Agency National LIDAR Programme intensity, 2022 | OGL v3 — © Environment Agency |
| Old Hall, Old Hall Cottage, war memorial positions; the church's doors, windows and pinnacles | Historic England listings (via Wikipedia; the church's from the Southwell & Nottingham Church History Project) | — |
| Building shapes as clean parts (every building) | Fitted to the LIDAR by `tools/fit_buildings.py` | as above |
| Weather now (cloud, rain, snow, wind) | Open-Meteo forecast API, fetched live | CC BY 4.0 — Weather data by Open-Meteo.com |
| Crop in each field | Rural Payments Agency Crop Map of England (CROME) 2024, majority per hedge-bounded field (`tools/crome.py`) | OGL v3 — © Rural Payments Agency copyright and/or database right 2024 |
| Traffic on Newark Road: how many vehicles, of what kind, which way, by hour and day | Department for Transport road traffic statistics: count point 91065 (annual average daily flow 2025; manual counts by hour, direction and vehicle type on six days 2001–2021, some filed under the site's earlier number, 27375) and the national hour-by-weekday table TRA0307 (2025) (`tools/traffic.py`) | OGL v3 — contains DfT data |
| The 733 school bus: times, stops, school days | Bus Open Data Service timetables (GTFS, East Midlands, feed of 17 October 2026) | OGL v3 |
| Car colours | SMMT new car registrations by colour, 2025 | — |
| Hand-surveyed buildings and house fronts (doors, windows, porches, garages, chimneys), walls, gates, yards, road signs, street lights, road markings, Give Way lines, gates on paths, labels (`data/survey.json`) | Measured from the LIDAR; observed in Google Street View (imagery from 2009 to 2025, looked at in October 2026) and Google and Bing aerial photographs, and recorded by hand. Each entry says where it was seen | — |
| Where the sun and moon are, and the moon's phase | Worked out from the date and time (low-precision astronomical formulae, as in the suncalc library) | — |
| Crops and leaves through the year | A typical East Midlands farming and leaf calendar (`js/seasons.js`), not records of these fields | — |

Nothing is made up. Where no data says what something looks like, it gets a plain default: red brick walls and
white front doors on houses nobody has looked at, and regularly spaced windows on walls not seen from a road. The
churchyard's headstones are laid out in rows, as the real ones aren't mapped. Things that exist but whose
positions aren't known are left out: most street lamps and road signs (only those located in Street View are
drawn), and the parked cars, people and animals. The one exception is the traffic on Newark Road (the A616): the
vehicles themselves are made up, but not how many there are or what they are (see below).

### Traffic

Newark Road carries 5,669 motor vehicles on an average day (the Department for Transport's estimate for 2025 at
count point 91065, a kilometre west of the village): 79% cars and taxis, 17% vans, 3% lorries, and a few coaches
and motorbikes. The model sends them through in those proportions, the lorries split as the DfT's manual counts
there found them (two- and three-axle box lorries, four-axle rigids such as tippers and mixers, and articulated
lorries, whose trailers follow the road round the bends). How many come along each hour follows the DfT's
national pattern for that hour and day of the week (table TRA0307: busy at the rush hours on weekdays, later and
flatter at weekends, a car every few minutes in the small hours), and which way they go follows the counts at
Kneesall: in the morning rush two in three are heading for Newark, in the evening most come back. They drive on the
left at about 30 mph, queue behind each other and stop for you if you stand in the road. Car colours are in the
proportions of new cars registered in 2025 (SMMT). In working hours, now and again one of them is a cement mixer.

The only timetabled bus through Kneesall is Stagecoach's 733, a school service: on school days it leaves the
School Lane stop at 07:50 for Tuxford Academy (south-east along Newark Road) and comes back at 16:07, from the
Bus Open Data Service timetable. Where it is before and after isn't published, so it simply drives through on
Newark Road. The bus is a plain single-decker: which vehicle runs the service isn't known.

All of this runs on the model's clock: the real time with the time of day on "Now", otherwise from the chosen
time's hour (Morning is 8 am, and so on), running on as you watch. St Bartholomew's clock keeps the same time.

### The year

The village is shown in the current month (or `?month=1`…`12`; <kbd>Y</kbd> steps on a month, rebuilding the village
where you stand). Each field follows the usual farming calendar for its CROME crop: winter wheat and barley green
through the winter, ripe in July (barley first) and stubble after harvest; oilseed rape yellow in April and May;
spring beans, maize and beet on bare soil until they come up. These are typical East Midlands dates, not records of
these fields. Deciduous trees are bare from December to March (limbs from the trunk, and the twigs on them), fresh in April and turn in October and November;
the evergreens (see `tools/tree_kinds.py`) stay as they are. `js/seasons.js` holds the calendars.

### Weather

The weather is Kneesall's own, now: the page asks [Open-Meteo](https://open-meteo.com/) (free, no key; it is sent only
the village's coordinates) for the cloud cover, rain or snow and wind when it opens and every quarter of an hour.
Cloud cover sets how many clouds there are, how big and grey, how much the sun (and so the shadows) gets through and
how hazy the distance is; rain and snow fall round you and close the view in; the clouds drift with the wind.
<kbd>R</kbd> steps through live, fair, overcast and rain. Without a connection it stays fair. Weather data by
Open-Meteo.com, CC BY 4.0.

### Night

<kbd>T</kbd> steps through the times of day, Night (half past ten) among them, and "Now", which follows the real sun
and deepens through the twilight into night after sunset. The moon is where it really is, lit as much as it really
is (the same low-precision formulae as the sun), and its light falls from there; with no moon up the village is lit
only by the sky's glow. The street lights located in Street View come on two degrees after sunset and light the
road, pavement and walls round them, and the traffic drives with its headlights on. A link can also give a clock
time (`?time=21:30`), shown with the sun and moon where they are at that time today. House windows stay dark: nobody
knows which would be lit.

### Sound

Everything you hear is synthesised in the browser (no recordings), and follows what the model is doing: the engines
and tyres of the traffic on Newark Road, placed left or right, fading with distance and dropping in pitch as they
pass; wind and rain from the live weather; birdsong, busiest at the dawn chorus and in spring, hushed by rain and at
night, and more of it among trees; and your footsteps, crisp on roads and pavements and soft on grass. St
Bartholomew's clock is electric (1963) and nothing says it strikes, so it is silent. <kbd>N</kbd> turns the sound
off and on.

### Footpaths

The public footpaths and bridleways OpenStreetMap maps round the village (west from the church, north from School
Lane past the kissing gates, the track east and the path towards Eakring Road) are laid as paths you can walk, with
their gates. The map shows them as the Ordnance Survey's Landranger maps do, in red dashes (short for footpaths,
long for bridleways), and the place name says when you are on one.

### Roof materials

The laser in an aerial LIDAR survey records how strongly each roof reflects it. Slate and grey tiles return
weakly, brown concrete tiles moderately and clay pantiles strongly, so the median intensity over a roof picks
its colour (thresholds checked against aerial photographs of a dozen roofs). Low-pitched roofs are sheeting or
felt instead. See `roofMaterial` in `js/buildings.js`.

### Drives and yards

The same laser intensity finds the hard standing round the houses. Tarmac is dark in the near infrared the laser
uses, gravel middling and grass bright, so ground-level metres off the roads that return weakly are drives, yards and
car parks: grown out from clearly dark ground, kept where a patch reaches a road or a building and lies mostly close
to one, and called tarmac or gravel by how dark the patch is (`tools/hard_ground.py`; checked against aerial
photographs at the school, the Hay Barn Cafe, the yard off School Lane and along Ossington Road). Tarmac lies at
pavement height, gravel in tan plates. Concrete and light block paving return as brightly as grass, so they aren't
found; yards measured by hand (`grounds` in `data/survey.json`) are drawn over these.

### Fitted buildings

`tools/fit_buildings.py` measures every building the way a surveyor would: its footprint from the LIDAR (raised,
hard, smooth pixels grown out from the OS outline, so missing wings are found), split into the largest rectangles
that fit in a grid turned to the walls, each with a gable, hip, lean-to or flat roof fitted to the last-return
heights, its own roof material from the laser intensity, and chimneys where the first return stands proud of the
ridge. `--qa sheet.png` draws every fit over the LIDAR relief for checking by eye.

The intensity separates slate (dark) from tiles well, but brown concrete tiles and clay pantiles overlap in the
middle of the range, so those roofs were checked against aerial photographs and corrected in `survey.json`.

### Surveyed buildings

`data/survey.json` holds buildings measured by hand, which replace any Ordnance Survey outline they overlap.
OS OpenMap Local outlines are generalised: some miss whole wings or sit a metre or
two off. Each surveyed building is a set of rectangles in British National Grid metres (in a local grid rotated to
the building), each with eaves and ridge heights and a gable, lean-to or hipped roof, plus wall and roof
materials, chimney positions and the side the door faces (and, where seen, door and window positions along it, a
porch, `garages` doors, `blank` sides and `frameColour`/`doorColour`, as in `details` below; `frontAt`, a point on the front wall, picks it out
where a lower range has the longer wall on that side). Houses built after the LIDAR survey, such as
those in Fortune Close, are measured from aerial photographs instead: the satellite image leans tall things about
0.4 m north for every metre of height (measured on the church tower), so roof outlines are read on a grid shifted
by that much at eaves height, and the heights come from Street View. The file can also mark yards (`grounds`:
gravel, paving or tarmac, such as Fortune Close itself, which OpenStreetMap doesn't map) and resurface
mapped roads (`roads`: a gravel `surface`, or the `sidewalk` sides of an OSM way given by its `osm` id). To survey another building, `python3 tools/survey_grid.py E N BEARING U0 U1 W0 W1` prints the
last-return heights (or `--layer intensity`) in a rotated grid to read the parts from.

`details` record what was seen of a building without re-measuring it: wall and roof materials, a painted ground
storey, which side faces the road (and which other sides are `blank`), door and chimney positions as fractions along the front (left to right as seen
from the road), windows per floor (a count spaced evenly, a list of fractions, or null where hidden), storeys, a label, a door `porch` canopy (`gable` or `lean`), small front `gablets` (fractions
along the front), `garages` doors ([fraction, colour, 2 for a double]), `frontAt` (a point on the front wall, lat/lon, where another range has a longer wall facing the same way) and `solar` panels (`face`: compass direction of the roof slope, `span`: fractions along it). Each is matched to the building whose outline contains
its `at` point, and every entry says where it was seen.

`church` gives St Bartholomew's parts as the LIDAR measures them (tower, nave, aisles, chancel, porch and boiler
house: their outlines, eaves and tops); its doors, windows and pinnacles are the ones the Historic England listing
describes, spaced evenly along each wall.

`walls` are garden and boundary walls (height, brick or stone, coping, piers). A wall along a road gives the road's
OpenStreetMap way id (`osm`), the `side` of it and `from`/`to` points, and stands at the back of the modelled pavement;
any other wall is a list of points. The 1 m LIDAR does not show walls this low, so they come from Street View.
`gates` are gateways through those walls (`at`, the compass `face` out through them, the opening's `width`): stone
piers, steps up to the ground inside, the iron gate and its arch, as at the churchyard gate on Newark Road. Yards and
paving in `grounds` are kept clear of hedges, since the LIDAR's low growth there is walls, benches and what stood on them.
`signs` are the road signs seen in Street View where roads enter the village (the pictorial village sign, name
plates and speed limits) and at junctions and bends (Give Way, direction flags, the end of a goods-vehicle restriction, crossroads
warnings, bend chevrons, the Rajdhaani's roadside board), each placed by a road the same way (on the verge, `against` a wall at the back of the pavement, or
`offset` metres from the centre line) and turned to face compass direction `face`. `lamps` are street lights
located from Street View bearings (a grey `column` with an outreach arm, or a `swan`-neck), at the kerb edge of the
pavement or on the verge (`back`: at the back of the pavement), the arm reaching over the road. `giveWays` are the
junctions where Street View shows Give Way markings: a double dashed line across the minor road `osm` at the edge
of the road it joins, and the painted `triangle` where there is one. `markings` are the other lines and words
painted on the roads, from a Street View walk along every road: centre lines between two points on a road (`dashed`,
a `warning` line, or `double` white lines with the `broken` side named), `edge` lines (dashed across junctions and
drives), and `SLOW`, `30` roundels (on a red band at the Ollerton end) and deflection arrows in the lane they face. The
A616 has double white lines most of the way through the village; Ossington Road and its link to Newark Road have a
dashed centre line, which stops a little east of School Lane; the other roads have none. Paint sits on the road
surface as drawn, which on cambered ground stands well above the ground beneath the middle of the road.
`barriers` say what Street View shows of the gates OpenStreetMap maps on roads and paths (by node id): galvanised, timber
or weathered, how many leaves, and the compass direction they stand open towards. Gates nobody has looked at are a
closed plain timber gate; where OSM gives a `maxheight` there is a lattice height bar over the way.
`trees` are trees the LIDAR doesn't have (planted or grown since, or on ground cleared when it was flown), and
`notTrees` are LIDAR "trees" the aerial photograph shows to be roofs, chimneys or building edges.

## Regenerating `data/`

1. OpenStreetMap: download `data/osm-raw.json` with an Overpass query over
   `(53.163,-0.966,53.177,-0.930)`, then `python3 tools/osm_to_lego.py data/osm-raw.json data/kneesall.json`. (`--refresh` refreshes just the
   points of interest, gates and rights of way in an existing `data/kneesall.json`, leaving the layers later steps add)
2. OS OpenMap Local: download the `SK` shapefile zip from the OS Data Hub (`OpenMapLocal`, area `SK`)
   and unzip `SK_Building.*` and `SK_ImportantBuilding.*`.
3. LIDAR: fetch 1 km GeoTIFFs for E 469880–470880, N 363760–364760 from the Environment Agency WCS
   (`lidar-composite-digital-terrain-model-dtm-1m`, `lidar-composite-digital-surface-model-first-return-dsm-1m` and
   `lidar-composite-digital-surface-model-last-return-dsm-1m`, `format=image/tiff`), and the National LIDAR
   Programme intensity tile `https://environment.data.gov.uk/tiles/collections/survey/national_lidar_programme_intensity/2022/1/SK7060`
   (a zip; the copies used are in `data/lidar/`).
4. `python3 tools/os_lidar.py data/kneesall.json --os <dir with SK_Building.shp> --dtm dtm.tif --dsm dsm.tif --bbox 469880 363760 470880 364760`

5. `python3 tools/lidar_roofs.py data/kneesall.json --dtm dtm.tif --dsm dsm.tif --dsm-last dsm_last.tif --intensity intensity_SK7060.tif --bbox 469880 363760 470880 364760`
   (samples the surface over every building into `roofs.bin`, using the last return where trees overhang a roof;
   walls, extensions and roof slopes are built from it. Also adds each building's roof intensity and pitch, and the
   grid transform that `survey.json` needs)

6. `python3 tools/fit_buildings.py data/kneesall.json --dtm dtm.tif --dsm dsm.tif --dsm-last dsm_last.tif --intensity intensity_SK7060.tif --bbox 469880 363760 470880 364760`
   (measures every building as clean parts; see "Fitted buildings" above)

   Add `--survey data/survey.json` to also measure the garages and sheds it lists under `lidarBuildings`.

7. `python3 tools/crome.py data/kneesall.json` (CROME crop hexagons; fetched once into `data/crome-raw.json`)

8. `python3 tools/tree_kinds.py data/kneesall.json --dtm dtm.tif --dsm dsm.tif --dsm-last dsm_last.tif --bbox 469880 363760 470880 364760`
   (marks each tree evergreen or deciduous: the survey was flown with the leaves off, so the last return goes down
   through a deciduous crown but stops near the top of a yew, holly or conifer. Evergreens are drawn dark and dense,
   the narrow ones as conifers)

8b. `python3 tools/hard_ground.py data/kneesall.json --dtm dtm.tif --dsm dsm.tif --dsm-last dsm_last.tif --intensity intensity_SK7060.tif --bbox 469880 363760 470880 364760`
   (drives, yards and car parks; see "Drives and yards" above)

Steps 4–8b add to the JSON written by step 1, so run them in that order.

9. `python3 tools/traffic.py data/traffic.json --tra0307 tra0307-traffic-distribution-by-time-of-day.ods --gtfs itm_east_midlands_gtfs.zip`
   (the A616's traffic from the DfT road traffic API; TRA0307 from the DfT's road traffic statistics tables; the
   bus timetables from https://data.bus-data.dft.gov.uk/timetable/download/gtfs-file/east_midlands/, about 200 MB.
   Rerun it when the timetable year changes: the 733's dates in `data/traffic.json` run to July 2027)

## Code

- `js/main.js` – renderer, sky, sun and moon, night lighting, controls, links, collision, traffic (and the bus), minimap
- `js/osm.js` – turns the data into ground, roads, drives and yards, buildings, trees and hedges
- `js/geo.js` – geometry: polygons and lines to stud cells, distances along roads, road surfaces and paint
- `js/seasons.js`, `js/sound.js` – the crop and leaf calendars; the synthesised sounds
- `js/roofs.js` – turns the LIDAR heights over a footprint into a roof height per stud
- `js/buildings.js` – fits LEGO buildings onto real footprints (walls and roofs from `roofs.js`, or a gable/hipped/flat roof without LIDAR), and roof materials
- `js/survey.js` – builds buildings from measured parts (fitted or hand-surveyed), yards and drives from `data/survey.json`
- `tools/fit_buildings.py`, `tools/survey_grid.py`, `tools/streetview_bearings.py` – fit every building's parts from the LIDAR; print LIDAR grids for surveying; which buildings a Street View panorama sees
- `js/bricks.js` – voxel world → merged, bevelled brick geometry, and a plain version of each chunk (only the faces that show, merged into rectangles) drawn from a distance
- `js/parts.js`, `js/landmarks.js`, `js/actors.js` – houses, street furniture, church, the player's minifig, the cars, vans, lorries, buses and motorbikes
- `tools/osm_to_lego.py`, `tools/os_lidar.py`, `tools/lidar_roofs.py`, `tools/crome.py`, `tools/tree_kinds.py`, `tools/hard_ground.py`, `tools/traffic.py` – build `data/` (see "Regenerating `data/`")
- `tools/` also has the OSGB grid conversion, shapefile and GeoTIFF readers, and the dev server
