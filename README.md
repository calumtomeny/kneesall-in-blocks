# LEGO Kneesall

A walkable WebGL model of Kneesall, Nottinghamshire, built out of LEGO-style bricks.

```bash
python3 tools/serve.py        # then open http://localhost:8765
```

## Data sources

| What | Source | Licence |
|---|---|---|
| Roads, names, church/restaurant/school/café, churchyard, hedges, woods, streams, poles, bus stops | OpenStreetMap (Overpass API) | ODbL — © OpenStreetMap contributors |
| Pavements (which side of each road) | OpenStreetMap `sidewalk` tags; Street View for the roads without them (`roads` in `data/survey.json`) | ODbL / — |
| Building outlines | Ordnance Survey OpenMap – Local (`SK_Building`, `SK_ImportantBuilding`) | OGL v3 — contains OS data © Crown copyright and database right |
| Terrain, building and roof shapes (stud by stud), trees, hedgerows | Environment Agency LIDAR Composite DTM, First Return and Last Return DSM, 1 m | OGL v3 — © Environment Agency |
| Roof materials (slate, brown tile, pantile, sheeting, felt) | Environment Agency National LIDAR Programme intensity, 2022 | OGL v3 — © Environment Agency |
| Old Hall, Old Hall Cottage, war memorial positions | Historic England listings (via Wikipedia) | — |
| Building shapes as clean parts (every building) | Fitted to the LIDAR by `tools/fit_buildings.py` | as above |
| Crop in each field | Rural Payments Agency Crop Map of England (CROME) 2024, majority per hedge-bounded field (`tools/crome.py`) | OGL v3 — © Rural Payments Agency copyright and/or database right 2024 |
| Hand-surveyed buildings, walls, doors, windows, chimneys, labels (`data/survey.json`) | Measured from the LIDAR; observed in Street View and aerial photographs (Oct 2026) and recorded by hand | — |

Nothing is made up. Where no data says what something looks like, it gets a plain default: red brick walls and
white front doors on houses nobody has looked at, and regularly spaced windows on walls not seen from a road. The
churchyard's headstones are laid out in rows, as the real ones aren't mapped. Things that exist but whose
positions aren't known are left out: most street lamps and road signs (only those located in Street View are
drawn), and the cars, people and animals.

### Roof materials

The laser in an aerial LIDAR survey records how strongly each roof reflects it. Slate and grey tiles return
weakly, brown concrete tiles moderately and clay pantiles strongly, so the median intensity over a roof picks
its colour (thresholds checked against aerial photographs of a dozen roofs). Low-pitched roofs are sheeting or
felt instead. See `roofMaterial` in `js/buildings.js`.

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
materials, chimney positions and the side the door faces. The file can also mark yards (`grounds`) and resurface
mapped roads (`roads`: a gravel `surface`, or the `sidewalk` sides of an OSM way given by its `osm` id). To survey another building, `python3 tools/survey_grid.py E N BEARING U0 U1 W0 W1` prints the
last-return heights (or `--layer intensity`) in a rotated grid to read the parts from.

`details` record what was seen of a building without re-measuring it: wall and roof materials, a painted ground
storey, which side faces the road (and which other sides are `blank`), door and chimney positions as fractions along the front (left to right as seen
from the road), windows per floor (a count spaced evenly, a list of fractions, or null where hidden), storeys, a label, a door `porch` canopy (`gable` or `lean`), small front `gablets` (fractions
along the front), `garages` doors ([fraction, colour, 2 for a double]) and `solar` panels (`face`: compass direction of the roof slope, `span`: fractions along it). Each is matched to the building whose outline contains
its `at` point, and every entry says where it was seen.

`walls` are garden and boundary walls (height, brick or stone, coping, piers). A wall along a road gives the road's
OpenStreetMap way id (`osm`), the `side` of it and `from`/`to` points, and stands at the back of the modelled pavement;
any other wall is a list of points. The 1 m LIDAR does not show walls this low, so they come from Street View.
`signs` are the road signs seen in Street View where roads enter the village (the pictorial village sign, name
plates and speed limits) and at junctions (Give Way, direction flags, the end of a goods-vehicle restriction, a crossroads
warning), each placed by a road the same way (on the verge, `against` a wall at the back of the pavement, or
`offset` metres from the centre line) and turned to face compass direction `face`. `lamps` are street lights
located from Street View bearings (a grey `column` with an outreach arm, or a `swan`-neck), at the kerb edge of the
pavement or on the verge (`back`: at the back of the pavement), the arm reaching over the road.

## Regenerating `data/`

1. OpenStreetMap: download `data/osm-raw.json` with an Overpass query over
   `(53.163,-0.966,53.177,-0.930)`, then `python3 tools/osm_to_lego.py data/osm-raw.json data/kneesall.json`.
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

Steps 4–7 add to the JSON written by step 1, so run them in that order.

## Code

- `js/main.js` – renderer, sky, controls, collision, traffic, minimap
- `js/osm.js` – turns the data into ground, roads, buildings, trees and hedges
- `js/roofs.js` – turns the LIDAR heights over a footprint into a roof height per stud
- `js/buildings.js` – fits LEGO buildings onto real footprints (walls and roofs from `roofs.js`, or a gable/hipped/flat roof without LIDAR), and roof materials
- `js/survey.js` – builds buildings from measured parts (fitted or hand-surveyed), yards and drives from `data/survey.json`
- `tools/fit_buildings.py`, `tools/survey_grid.py`, `tools/streetview_bearings.py` – fit every building's parts from the LIDAR; print LIDAR grids for surveying; which buildings a Street View panorama sees
- `js/bricks.js` – voxel world → merged, bevelled brick geometry
- `js/parts.js`, `js/landmarks.js`, `js/actors.js` – houses, street furniture, church, the player's minifig
- `tools/` – data converters (OSGB grid conversion, shapefile and GeoTIFF readers), dev server
